/** Run every test against disposable Postgres, independent of configured databases. */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const configuredPort = process.env.EVIA_TEST_DB_PORT ?? '5434';
const port = Number(configuredPort);
let db, server, child, childDone, killTimer;
let stopping = false;

// Database URLs must never appear in diagnostic or forwarded test output.
const redact = (text) => String(text).replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[database URL redacted]');
const report = (text) => console.log(`[test:local] ${text}`);

function requestStop(signal) {
  if (stopping) return;
  stopping = true;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  report(`Received ${signal}; stopping tests and disposing the database.`);
  stopChild(signal);
}

function stopChild(signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  killTimer ??= setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 2_000);
  killTimer.unref();
}

const onInterrupt = () => requestStop('SIGINT');
const onTerminate = () => requestStop('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);

async function checkPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, host, () => probe.close(resolve));
  });
}

try {
  if (!/^\d+$/.test(configuredPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('EVIA_TEST_DB_PORT must be an integer between 1 and 65535.');
  }
  // Fail before starting the database or tests when another process owns it.
  // server.start() also checks the port, covering a race after this probe.
  await checkPort();
  if (!stopping) {
    db = await PGlite.create({ dataDir: 'memory://' });
    server = new PGLiteSocketServer({ db, host, port, maxConnections: 2 });
    // One app pool connection plus the test's short-lived schema-admin client.
    if (!stopping) await server.start();
  }
  if (!stopping) {
    report(`Fresh in-memory database ready on ${host}:${port}; running the full suite.`);
    const databaseUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
    child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], {
      cwd: root,
      env: {
        ...process.env,
        // Always override both sources: neither .env nor inherited production
        // database configuration may select the database used by this command.
        NETLIFY_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        EVIA_DB_POOL: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      const lines = createInterface({ input: stream });
      lines.on('line', (line) => output.write(redact(line) + '\n'));
    }
    childDone = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    const code = await childDone;
    if (!stopping) process.exitCode = code;
  }
} catch (error) {
  process.exitCode = stopping ? process.exitCode : 1;
  const code = error?.code;
  const message = code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop its listener or set EVIA_TEST_DB_PORT to another free port; tests were not started.`
    : code === 'EPERM' || code === 'EACCES'
      ? `Cannot bind ${host}:${port} (${code}). Allow a local listener and retry; tests were not started.`
      : redact(error instanceof Error ? error.message : error);
  console.error(`[test:local] ${message}`);
} finally {
  stopChild();
  await childDone?.catch(() => {});
  clearTimeout(killTimer);
  try {
    await server?.stop();
  } finally {
    await db?.close();
    if (db) report('Temporary database stopped and discarded.');
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}
