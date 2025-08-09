#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const token = process.env.TODOIST_API_TOKEN;
if (!token) {
  console.error('Missing TODOIST_API_TOKEN in environment.');
  process.exit(1);
}

function connect() {
  const server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, TODOIST_API_TOKEN: token },
    stdio: ['pipe', 'pipe', 'inherit']
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
        reject(new Error(`Timeout waiting for ${method}`));
      }, 15000);
      pending.set(id, (payload) => { clearTimeout(timeout); resolve(payload); });
    });
  }
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let obj;
    try { obj = JSON.parse(s); } catch { return; }
    if (obj && typeof obj.id !== 'undefined' && pending.has(obj.id)) {
      const resolver = pending.get(obj.id);
      pending.delete(obj.id);
      resolver(obj);
    }
  });
  return { server, send };
}

function extractText(result) {
  const arr = result?.content || [];
  const text = arr.find((c) => c.type === 'text')?.text || '';
  return text;
}

async function main() {
  const { server, send } = connect();
  try {
    // Create project
    const projName = 'Trip to Egypt';
    const createProj = await send('tools/call', { name: 'todoist_create_project', arguments: { name: projName } });
    console.log(extractText(createProj.result));

    // Create tasks in project by name
    const createHotel = await send('tools/call', { name: 'todoist_create_task', arguments: { project_name: projName, content: 'Book Hotel', due_string: 'today' } });
    console.log(extractText(createHotel.result));

    const createFlight = await send('tools/call', { name: 'todoist_create_task', arguments: { project_name: projName, content: 'Book Flight', due_string: 'tomorrow' } });
    console.log(extractText(createFlight.result));
  } catch (e) {
    console.error('Error:', e.message || String(e));
  } finally {
    // shutdown
    setTimeout(() => { try { server.kill('SIGTERM'); } catch {} }, 250);
  }
}

main();

