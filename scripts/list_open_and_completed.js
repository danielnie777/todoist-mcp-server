#!/usr/bin/env node
// Lists open tasks via MCP server, and completed tasks via Todoist API v1 (fallback to REST v2) for quick visibility.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const token = process.env.TODOIST_API_TOKEN;
if (!token) {
  console.error('Missing TODOIST_API_TOKEN in environment.');
  process.exit(1);
}

function mcpConnect() {
  const server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, TODOIST_API_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rl = readline.createInterface({ input: server.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let nextId = 1;
  function send(method, params) {
    const id = nextId++;
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 12000);
      pending.set(id, (payload) => { clearTimeout(timeout); resolve(payload); });
    });
  }
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.id !== 'undefined' && pending.has(obj.id)) {
        const resolver = pending.get(obj.id);
        pending.delete(obj.id);
        resolver(obj);
      }
    } catch {}
  });
  return { server, send };
}

async function fetchAllCompleted() {
  const headers = { Authorization: `Bearer ${token}` };
  const baseUrl = 'https://api.todoist.com/api/v1/tasks/completed';
  const all = [];
  let cursor = undefined;
  for (let i = 0; i < 50; i++) { // hard cap pages
    const url = new URL(baseUrl);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    all.push(...items);
    cursor = data?.next_cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

async function main() {
  const { server, send } = mcpConnect();
  try {
    const tools = await send('tools/list', {});
    if (!tools?.result?.tools) throw new Error('MCP tools/list failed');

    const openResp = await send('tools/call', { name: 'todoist_get_tasks', arguments: {} });
    const openText = openResp.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    console.log('Open tasks (all):\n');
    console.log(openText || '(none)');

    console.log('\nCompleted tasks (all):\n');
    const completed = await fetchAllCompleted();
    if (!completed.length) {
      console.log('(none)');
    } else {
      for (const t of completed) {
        const title = t.content || t.task?.content || t.title || '(untitled)';
        const id = t.id || t.task_id || t.task?.id || '';
        const completedAt = t.completed_at || t.completedAt || t.task?.completed_at || '';
        console.log(`- ${title}${id ? ` (id: ${id})` : ''}${completedAt ? `\n  Completed: ${completedAt}` : ''}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message || String(e));
  } finally {
    server.kill('SIGTERM');
    setTimeout(() => server.kill('SIGKILL'), 1000);
  }
}

main();

