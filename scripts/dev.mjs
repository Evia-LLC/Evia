/**
 * Dev launcher: runs the database, the API and the Vite server in one process
 * tree.
 *
 * Invoked directly with node.exe (not npm) because npm.cmd exits silently when
 * spawned from tooling on this machine — see the machine notes in README.
 *
 * The API is restarted on server edits by this launcher rather than by
 * `node --watch`, and the database child is recycled with it. PGlite's socket
 * listener serves one connection, and on Windows a killed API leaves that
 * connection half-open long enough for the replacement to be reset on its
 * first query — every second edit came up "read ECONNRESET" and stayed down.
 * Restarting both is a second of work and it is always clean.
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

/**
 * The database first, because the API cannot boot without one.
 *
 * A configured connection string — Netlify DB, a container, anything — is
 * used as-is. Otherwise `dev-db.mjs` starts an in-process Postgres and prints
 * the URL to reach it on, and the API is started only once that line has
 * arrived: starting it earlier races the listener and loses.
 */
const configured = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;

let db = null;
let api = null;

function startDb() {
  return new Promise((resolve) => {
    let started = false;
    db = run('db', [path.join(root, 'scripts', 'dev-db.mjs')], '33', {
      onLine: (line) => {
        const match = /^ready (postgres:\/\/\S+)/.exec(line);
        if (!match || started) return;
        started = true;
        resolve(match[1]);
      },
    });
  });
}

function startApi(url) {
  const env = { ...process.env };
  if (url) {
    env.DATABASE_URL = url;
    // PGlite is a single-connection database. A pool of three against it
    // means the second and third connections are reset mid-query; with one,
    // `pg` queues the work instead and every query lands.
    env.EVIA_DB_POOL ??= '1';
  }
  api = run('api', [path.join(root, 'server', 'index.ts')], '36', { env });
}

async function boot() {
  if (configured) {
    startApi(null);
    return;
  }
  const url = await startDb();
  startApi(url);
}

let restarting = null;
async function restart(reason) {
  if (restarting) return;
  restarting = (async () => {
    process.stdout.write(`\x1b[36m[dev]\x1b[0m restarting the API (${reason})\n`);
    await stop(api);
    if (!configured) await stop(db);
    await boot();
  })().finally(() => {
    restarting = null;
  });
  await restarting;
}

/**
 * Server edits restart the API. Debounced, because an editor writes a file
 * in two or three steps and the migrations folder is written by hand in
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
