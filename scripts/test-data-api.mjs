/** One owned, disposable Supabase stack per run. Never uses inherited targets. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `evia-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(path.join(tmpdir(), 'evia-data-api-'));
let child;
let started = false;

function command(binary, args, options = {}) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

try {
  const runtime = ['docker', 'podman'].find((binary) => {
    try { command(binary, ['info']); return true; } catch { return false; }
  });
  if (!runtime) throw new Error('A running Docker or Podman engine is required; integration tests were not started.');
  command('supabase', ['--version']);
  const ports = new Set();
  while (ports.size < 3) ports.add(await freePort());
  const [apiPort, dbPort, shadowPort] = [...ports];
  await mkdir(path.join(directory, 'supabase'));
  await cp(path.join(root, 'supabase/migrations'), path.join(directory, 'supabase/migrations'), { recursive: true });
  let config = await readFile(path.join(root, 'supabase/config.toml'), 'utf8');
  config = config.replace('evia-local', project).replace('54321', String(apiPort))
    .replace('54322', String(dbPort)).replace('54320', String(shadowPort));
  await writeFile(path.join(directory, 'supabase/config.toml'), config);
  console.log('[test:data-api] Starting an isolated local Supabase stack.');
  started = true;
  command('supabase', ['start', '--workdir', directory,
    '--exclude', 'studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta'], { timeout: 300_000 });
  const status = JSON.parse(command('supabase', ['status', '--workdir', directory, '--output', 'json']));
  const api = new URL(status.API_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(api.hostname) || Number(api.port) !== apiPort) {
    throw new Error('The stack returned an unexpected API target.');
  }
  const env = { ...process.env, NODE_ENV: 'test', APP_ENV: '', DEMO_MODE: '0',
    SUPABASE_URL: api.origin, SUPABASE_ANON_KEY: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    ELOHIM_DATA_API_LANE: '1', ELOHIM_TEST_CONTAINER: `supabase_db_${project}`,
    ELOHIM_TEST_CONTAINER_RUNTIME: runtime, DATABASE_URL: '', NETLIFY_DATABASE_URL: '' };
  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Local API credentials were not returned.');
  child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'], {
    cwd: root, env, stdio: 'inherit',
  });
  const stop = () => child?.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1));
  });
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
} catch (error) {
  // CLI output can include credentials; never echo stdout/stderr or its command failure text.
  console.error('[test:data-api] ' + (error?.status !== undefined
    ? 'Local Supabase setup failed. Check the container runtime and CLI; no hosted fallback was used.'
    : error.message));
  process.exitCode = 1;
} finally {
  if (started) {
    try { command('supabase', ['stop', '--workdir', directory, '--no-backup'], { timeout: 60_000 }); }
    catch { console.error('[test:data-api] Could not stop the owned stack; project: ' + project); }
  }
  // directory was created by this process, never an inherited/user-supplied path.
  await rm(directory, { recursive: true, force: true });
}
