/**
 * Dev launcher: runs the database, the API and the Vite server in one process
 * tree.
 *
 * Invoked directly with node.exe (not npm) because npm.cmd exits silently when
 * spawned from tooling on this machine — see the machine notes in README.
 *
 * Server edits restart the API. The local Supabase stack stays running so
 * development data survives API restarts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

const children = new Set();

function run(label, args, colour, { env = process.env, onLine } = {}) {
  const child = spawn(node, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const tag = `\x1b[${colour}m[${label}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        out.write(tag + line + '\n');
        onLine?.(line);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.label = label;
  child.on('exit', (code) => {
    children.delete(child);
    process.stdout.write(tag + `exited with code ${code}\n`);
    // A child we stopped on purpose is not a reason to stop everything.
    if (child.recycling) return;
    shutdown(code ?? 0);
  });
  children.add(child);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.recycling = true;
    child.once('exit', () => resolve());
    // Closing stdin is the one shutdown signal a child sees on every platform.
    child.stdin?.end();
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1500).unref();
  });
}

function shutdown(code) {
  for (const c of children) {
    c.recycling = true;
    c.stdin?.end();
    c.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** Persistent local Supabase stack; never inherits a hosted application target. */
let api = null;
let localEnv;

async function boot() {
  if (!localEnv) {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('supabase', ['start', '--workdir', root], { stdio: 'pipe' });
      const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', root, '--output', 'json'], { encoding: 'utf8', stdio: 'pipe' }));
      const url = new URL(status.API_URL);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('non-local API');
      localEnv = { ...process.env, SUPABASE_URL: url.origin,
        SUPABASE_ANON_KEY: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
        APP_ENV: '', NODE_ENV: 'development' };
      if (!localEnv.SUPABASE_ANON_KEY || !localEnv.SUPABASE_SERVICE_ROLE_KEY) throw new Error('missing local API keys');
    } catch {
      console.error('[dev] Local Supabase could not start. Install the Supabase CLI and run Docker/Podman. No hosted fallback was used.');
      process.exit(1);
    }
  }
  api = run('api', [path.join(root, 'server', 'index.ts')], '36', { env: localEnv });
}

let restarting = null;
async function restart(reason) {
  if (restarting) return;
  restarting = (async () => {
    process.stdout.write(`\x1b[36m[dev]\x1b[0m restarting the API (${reason})\n`);
    await stop(api);
    await boot();
  })().finally(() => {
    restarting = null;
  });
  await restarting;
}

/**
 * Server edits restart the API. Debounced, because an editor writes a file
 * in two or three steps and server files can be written in
 * bursts; one restart per burst is the intent.
 */
let pending = null;
function watch(dir) {
  fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!file || !/\.(ts|sql|mjs|json)$/.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => void restart(file), 350);
  });
}

await boot();
watch(path.join(root, 'server'));
watch(path.join(root, 'shared'));

run('web', [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), root], '35');
