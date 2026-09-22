/**
 * A one-shot bridge to the Meshy MCP server.
 *
 * The MCP tools themselves only reach an agent after a client restart, and the
 * generation work needs to happen now. This speaks the same protocol the client
 * would: spawn the server over stdio, initialize, call one tool, print what came
 * back, exit.
 *
 *   node scripts/meshy.mjs <tool_name> '<json args>'
 *   node scripts/meshy.mjs --list
 *
 * The API key is read from .mcp.json so there is exactly one copy of it on disk
 * and this file can be committed without carrying a secret.
 *
 * Every generation tool here spends real credits. Nothing in this script calls
 * anything on its own — it runs the one tool it was given and stops.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(path.join(root, '.mcp.json'), 'utf8'));
const server = config.mcpServers.meshy;

const [, , toolName, rawArgs] = process.argv;
if (!toolName) {
  console.error('usage: node scripts/meshy.mjs <tool_name|--list> [json args]');
  process.exit(2);
}

const child = spawn(server.command, server.args, {
  cwd: root,
  env: { ...process.env, ...server.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let buffer = '';
const pending = new Map();

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  // The server writes one JSON-RPC message per line.
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line.startsWith('{')) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

// The server logs its startup to stderr; only surface it if something breaks.
let stderr = '';
child.stderr.on('data', (c) => {
  stderr += c.toString();
});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    // Generation calls block server-side while the task is submitted; a task
    // that is still *running* returns quickly with an id to poll, so a request
    // that takes this long has genuinely hung.
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timed out: ${method} ${params?.name ?? ''}`));
    }, 300_000);
  });
}

function fail(message) {
  console.error(message);
  if (stderr.trim()) console.error('\n--- server stderr ---\n' + stderr.trim());
  child.kill();
  process.exit(1);
}

try {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'evia-bridge', version: '1.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  if (toolName === '--list') {
    const listed = await call('tools/list', {});
    for (const tool of listed.result.tools) {
      console.log(`\n### ${tool.name}`);
      console.log((tool.description ?? '').split('\n').slice(0, 3).join('\n'));
      console.log('args: ' + JSON.stringify(tool.inputSchema?.properties ?? {}));
      if (tool.inputSchema?.required) console.log('required: ' + tool.inputSchema.required.join(', '));
    }
  } else {
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    const response = await call('tools/call', { name: toolName, arguments: args });
    if (response.error) fail('tool error: ' + JSON.stringify(response.error, null, 2));
    for (const block of response.result?.content ?? []) {
      console.log(block.text ?? JSON.stringify(block));
    }
    if (response.result?.isError) fail('tool reported an error');
  }
} catch (err) {
  fail(String(err));
}

child.kill();
process.exit(0);
