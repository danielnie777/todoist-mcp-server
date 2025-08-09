#!/usr/bin/env node
/*
 Minimal MCP stdio smoke test:
 - Spawns the built server at dist/index.js
 - Sends tools/list and a sample tools/call for todoist_get_tasks
 - Optionally performs a full CRUD flow using temporary tasks when FULL=1

 Usage:
   TODOIST_API_TOKEN=your_token node scripts/smoke_mcp.js
   FULL=1 TODOIST_API_TOKEN=your_token node scripts/smoke_mcp.js
*/

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const token = process.env.TODOIST_API_TOKEN;
if (!token) {
  console.error('Missing TODOIST_API_TOKEN in environment.');
  process.exit(1);
}

const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, TODOIST_API_TOKEN: token },
  stdio: ['pipe', 'pipe', 'pipe']
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Collect stderr for visibility but do not fail on it
server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  // Uncomment for verbose logs
  // process.stderr.write(chunk);
});

const rl = readline.createInterface({ input: server.stdout, crlfDelay: Infinity });

const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  server.stdin.write(msg);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);
    pending.set(id, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return; // ignore non-JSON lines
  }
  if (obj && typeof obj.id !== 'undefined' && pending.has(obj.id)) {
    const resolver = pending.get(obj.id);
    pending.delete(obj.id);
    resolver(obj);
  }
});

async function main() {
  try {
    const toolsResp = await send('tools/list', {});
    const tools = toolsResp.result?.tools ?? [];
    console.log('Tools:', tools.map((t) => t.name).join(', '));

    const getTasksResp = await send('tools/call', {
      name: 'todoist_get_tasks',
      arguments: { limit: 3 }
    });

    const content = getTasksResp.result?.content ?? [];
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    console.log('\nSample tasks (up to 3):\n');
    console.log(text || '(no tasks returned)');

    if (process.env.FULL === '1') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const nameA = `MCP Test A ${stamp}`;
      const nameB = `MCP Test B ${stamp}`;

      // Create A
      const createA = await send('tools/call', {
        name: 'todoist_create_task',
        arguments: { content: nameA, description: 'temporary', due_string: 'today', priority: 3 }
      });
      const createAText = createA.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      console.log('\nCreate A ->', createAText.split('\n')[0]);

      // Update A
      const updateA = await send('tools/call', {
        name: 'todoist_update_task',
        arguments: { task_name: nameA, content: `${nameA} (updated)`, priority: 4 }
      });
      const updateAText = updateA.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      console.log('Update A ->', updateAText.split('\n')[0]);

      // Delete A
      const deleteA = await send('tools/call', {
        name: 'todoist_delete_task',
        arguments: { task_name: nameA }
      });
      const deleteAText = deleteA.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      console.log('Delete A ->', deleteAText);

      // Create B
      const createB = await send('tools/call', {
        name: 'todoist_create_task',
        arguments: { content: nameB, description: 'temporary', due_string: 'today', priority: 2 }
      });
      const createBText = createB.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      console.log('\nCreate B ->', createBText.split('\n')[0]);

      // Complete B
      const completeB = await send('tools/call', {
        name: 'todoist_complete_task',
        arguments: { task_name: nameB }
      });
      const completeBText = completeB.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      console.log('Complete B ->', completeBText);
    }
  } catch (err) {
    console.error('Smoke test failed:', err.message || String(err));
  } finally {
    // Best-effort shutdown
    server.kill('SIGTERM');
    setTimeout(() => server.kill('SIGKILL'), 2000);
  }
}

main();

