/**
 * A local Postgres, with nothing to install.
 *
 * The API moved to Postgres so it could live on Netlify, and that took the
 * ability to run it on a laptop away from anyone without a database server:
 * `getPool()` throws on boot when no connection string is set, so `npm run
 * dev` opened a Vite page whose sign-in reported the server as offline.
 *
 * This is the missing piece. PGlite is Postgres compiled to WebAssembly and
 * run in-process; pglite-socket puts a wire-protocol TCP listener in front of
 * it, so the unmodified `pg` driver connects to it exactly as it would to a
 * real server, and every migration runs verbatim. Data persists under
 * `data/pglite/` between runs, so the demo account and its scan history
 * survive a restart the same way they would on a real database.
 *
 * Dev only. `scripts/dev.mjs` starts this first and hands the API a
 * `DATABASE_URL` pointing here, unless one is already set — a configured
 * database always wins, so pointing at Netlify DB locally still works.
 *
 * `localhost` in the URL is deliberate: the pool turns SSL on for any host that
 * is not localhost, and this listener speaks plain text.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDirectory } from './lib/prepare-directory.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDirectory = path.join(root, 'data');

export const DEV_DB_PORT = Number(process.env.ELOHIM_DEV_DB_PORT ?? 5433);
export const DEV_DB_URL = `postgres://postgres:postgres@localhost:${DEV_DB_PORT}/postgres`;

await prepareDirectory(dataDirectory);
const db = await PGlite.create({ dataDir: path.join(dataDirectory, 'pglite') });
const server = new PGLiteSocketServer({ db, port: DEV_DB_PORT, host: '127.0.0.1' });

// An EventTarget, not an EventEmitter, whatever the README's examples say.
server.addEventListener('error', (event) => {
  const err = event instanceof ErrorEvent ? event.error : event;
  console.error(`dev-db: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

await server.start();
// The launcher waits for exactly this line before it starts the API.
console.log(`ready ${DEV_DB_URL}`);

async function shutdown() {
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// The launcher kills us with the stdin pipe on Windows, where signals are not
// delivered to a child reliably.
process.stdin.on('end', shutdown);
process.stdin.resume();
