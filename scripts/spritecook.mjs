/**
 * SpriteCook bridge.
 *
 * Same job as `scripts/meshy.mjs` — let this session call an MCP server before
 * the editor has been restarted to pick up `.mcp.json` — but a much shorter
 * road, because SpriteCook is a *hosted* server rather than a local process.
 * There is no child to spawn and no stdio framing to reassemble: it is
 * JSON-RPC over HTTP POST, so this is a fetch and a header.
 *
 * The two wrinkles that are not obvious from the docs:
 *
 *  1. Streamable-HTTP servers may answer either `application/json` or
 *     `text/event-stream`, chosen per request, so both have to be parsed.
 *  2. `initialize` hands back an `Mcp-Session-Id` header which every later
 *     call must echo, and the spec requires a `notifications/initialized`
 *     before the session will accept tool calls.
 *
 * Usage:
 *   node scripts/spritecook.mjs --list
 *   node scripts/spritecook.mjs <tool_name> '<json args>'
 *
 * Windows note: the shell eats backslashes in arguments, so write any local
 * path with forward slashes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(path.join(root, '.mcp.json'), 'utf8'));
const server = config.mcpServers?.spritecook;

if (!server) {
  console.error('No "spritecook" entry in .mcp.json — add the URL and API key first.');
  process.exit(2);
}

const [, , toolName, rawArgs] = process.argv;
if (!toolName) {
  console.error('usage: node scripts/spritecook.mjs <tool_name|--list> [json args]');
  process.exit(2);
}

let sessionId = null;
let nextId = 1;

/** One JSON-RPC round trip. Returns null for notifications, which get no reply. */
async function rpc(method, params, isNotification = false) {
  const body = isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: nextId++, method, params };

  const response = await fetch(server.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Both, because the server picks the response type per request.
      Accept: 'application/json, text/event-stream',
      ...(server.headers ?? {}),
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });

  const handed = response.headers.get('mcp-session-id');
  if (handed) sessionId = handed;

  if (isNotification) return null;

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${detail.slice(0, 400)}`);
  }

  const text = await response.text();
  const type = response.headers.get('content-type') ?? '';

  if (type.includes('text/event-stream')) {
    // Take the last `data:` frame carrying a reply to this id.
    let result = null;
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const message = JSON.parse(payload);
        if (message.id === body.id) result = message;
      } catch {
        /* keep-alive frames and partials are not our problem */
      }
    }
    if (!result) throw new Error(`No reply to ${method} in the event stream`);
    return result;
  }

  return JSON.parse(text);
}

function unwrap(message, label) {
  if (message.error) {
    throw new Error(`${label} failed: ${message.error.message ?? JSON.stringify(message.error)}`);
  }
  return message.result;
}

const init = unwrap(
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'evia-bridge', version: '1.0.0' },
  }),
  'initialize',
);
await rpc('notifications/initialized', {}, true);

if (toolName === '--schema') {
  // Full JSON schema for named tools. The public docs list no tool signatures
  // at all, so this is the only way to get a call right the first time — and a
  // wrong call on a paid endpoint can still cost credits.
  const wanted = new Set((rawArgs ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const tools = unwrap(await rpc('tools/list', {}), 'tools/list').tools ?? [];
  for (const tool of tools) {
    if (wanted.size && !wanted.has(tool.name)) continue;
    console.log(`
### ${tool.name}
${tool.description ?? ''}`);
    console.log(JSON.stringify(tool.inputSchema, null, 2));
  }
} else if (toolName === '--list') {
  const tools = unwrap(await rpc('tools/list', {}), 'tools/list').tools ?? [];
  console.log(`server: ${init.serverInfo?.name ?? '?'} ${init.serverInfo?.version ?? ''}`);
  console.log(`${tools.length} tools\n`);
  for (const tool of tools) {
    const props = tool.inputSchema?.properties ?? {};
    const required = new Set(tool.inputSchema?.required ?? []);
    const args = Object.entries(props)
      .map(([k, v]) => `${k}${required.has(k) ? '*' : ''}: ${v.type ?? '?'}`)
      .join(', ');
    console.log(`${tool.name}(${args})`);
    if (tool.description) console.log(`    ${tool.description.split('\n')[0]}`);
  }
} else {
  /*
   * `@path` reads the argument JSON from a file.
   *
   * An imported image arrives as base64, and a 1MB PNG is ~1.4MB of it —
   * hundreds of times past what a Windows command line will carry. Anything
   * involving image bytes has to come off disk.
   */
  const args = !rawArgs
    ? {}
    : rawArgs.startsWith('@')
      ? JSON.parse(readFileSync(path.resolve(root, rawArgs.slice(1)), 'utf8'))
      : JSON.parse(rawArgs);
  const result = unwrap(await rpc('tools/call', { name: toolName, arguments: args }), toolName);
  console.log(JSON.stringify(result, null, 2));
}
