/**
 * Database connection and migration runner.
 *
 * Postgres, over plain `pg`. That single detail is why this file changed: the
 * app used to use `node:sqlite` against a file on disk, and a file on disk does
 * not exist on a platform whose filesystem is rebuilt for every request.
 *
 * Deliberately the standard driver rather than a host-specific one. `pg` talks
 * to any Postgres — Neon, Supabase, RDS, a container on a laptop — so the
 * connection string is the only thing that has to change to move this
 * somewhere else, and nothing in the build depends on a particular provider
 * being reachable at build time.
 *
 * Two deliberate choices keep the rest of the codebase almost untouched:
 *
 *  1. The helpers still take SQLite-style `?` placeholders and translate them
 *     to Postgres `$1..$n` here. Sixty-odd statements across six repositories
 *     did not need rewriting for a difference that is purely notational, and a
 *     rewrite of every one of them is a rewrite of every one of them: a chance
 *     to transpose a column in a query nobody reads again for months.
 *
 *  2. Everything is async now, because Postgres is. That part could not be
 *     hidden and was not worth hiding — the call sites say `await` and mean it.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/log.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the migration files are.
 *
 * Next to this module in a checkout. On Netlify the function is one esbuild
 * bundle, so `import.meta.url` points at the bundle, not at server/db, and the
 * SQL files arrive through `included_files` at their repo-relative path under
 * the task root instead. Try the checkout location first, then the bundle's
 * root; fail with the list of places looked, not with a bare ENOENT.
 */
function migrationsDir(): string {
  const candidates = [
    path.join(here, 'migrations'),
    path.join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'server', 'db', 'migrations'),
    path.join(process.cwd(), 'server', 'db', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`migrations directory not found; looked in ${candidates.join(', ')}`);
}

/**
 * One pool for the process.
 *
 * Created lazily rather than at import: `getDatabase()` throws when no
 * connection string is configured, and a throw at module scope takes down
 * anything that so much as imports a type from here — including the parts of
 * the test suite that never touch the database.
 */
let pool: pg.Pool | null = null;

/** Whatever the host calls it. Netlify sets the first; everywhere else the second. */
export function connectionString(): string {
  return process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
}

function getPool(): pg.Pool {
  if (pool) return pool;
  const url = connectionString();
  if (!url) {
    throw new Error(
      'No database configured. Set NETLIFY_DATABASE_URL (or DATABASE_URL) to a Postgres ' +
        'connection string.',
    );
  }
  pool = new pg.Pool({
    connectionString: url,
    // A function instance handles a request or two and is then discarded, so a
    // large pool is just idle connections the database has to hold open.
    max: Number(process.env.EVIA_DB_POOL ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Plain text to anything on this machine — the dev listener in
    // `scripts/dev-db.mjs` does not speak SSL — and TLS to everything else.
    ssl: /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

/**
 * `?` to `$1..$n`.
 *
 * Positional either way, so the parameter arrays are unchanged. Safe against
 * the statements in this codebase because none of them contains a literal
 * question mark inside a string — checked before this was written, and worth
 * re-checking if one ever ends up in a LIKE pattern.
 */
export function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** `Buffer` for BYTEA columns — `pg` sends it as binary without any help. */
export type Param = string | number | boolean | null | Buffer;

/** A queryable: the pool, or a client that is inside a transaction. */
interface Queryable {
  query: (text: string, params?: Param[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export async function rows<T>(sql: string, ...params: Param[]): Promise<T[]> {
  const result = await getPool().query(toPg(sql), params);
  return result.rows as T[];
}

export async function row<T>(sql: string, ...params: Param[]): Promise<T | undefined> {
  const result = await getPool().query(toPg(sql), params);
  return result.rows[0] as T | undefined;
}

/** INSERT/UPDATE/DELETE. Returns how many rows it touched. */
export async function run(sql: string, ...params: Param[]): Promise<number> {
  const result = await getPool().query(toPg(sql), params);
  return result.rowCount ?? 0;
}

/** Raw DDL and multi-statement scripts. No parameters, no translation. */
export async function exec(sql: string): Promise<void> {
  await getPool().query(sql);
}

/**
 * Runs `fn` inside a real transaction, rolling back on any throw.
 *
 * The callback is handed the client the transaction is open on, and everything
 * that must be part of it has to go through that client. This is stricter than
 * the version it replaces: with SQLite there was a single global connection, so
 * `BEGIN` caught every statement made anywhere inside the callback. A pool has
 * many connections, and work sent to the pool while a transaction is open on
 * one client runs outside it — silently, and only visible as a half-written row
 * after a failure. Passing the client makes that impossible to get wrong by
 * accident.
 */
export async function transaction<T>(
  fn: (tx: {
    rows: <R>(sql: string, ...params: Param[]) => Promise<R[]>;
    row: <R>(sql: string, ...params: Param[]) => Promise<R | undefined>;
    run: (sql: string, ...params: Param[]) => Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  const scoped = {
    rows: async <R,>(sql: string, ...params: Param[]) =>
      (await (client as unknown as Queryable).query(toPg(sql), params)).rows as R[],
    row: async <R,>(sql: string, ...params: Param[]) =>
      (await (client as unknown as Queryable).query(toPg(sql), params)).rows[0] as R | undefined,
    run: async (sql: string, ...params: Param[]) =>
      (await (client as unknown as Queryable).query(toPg(sql), params)).rowCount ?? 0,
  };

  try {
    await (client as unknown as Queryable).query('BEGIN');
    const out = await fn(scoped);
    await (client as unknown as Queryable).query('COMMIT');
    return out;
  } catch (err) {
    await (client as unknown as Queryable).query('ROLLBACK').catch(() => {
      /* the connection may already be gone; the original error is the useful one */
    });
    throw err;
  } finally {
    (client as { release: () => void }).release();
  }
}

/**
 * Applies numbered SQL files once, in order, recording each in `_migrations`.
 *
 * Guarded by an advisory lock, which the SQLite version did not need. On a
 * serverless platform several function instances can cold-start at the same
 * moment and every one of them will try to migrate; without the lock they race,
 * and the loser fails on a table that already exists. The lock makes the second
 * one wait and then find the work already recorded as done.
 */
const MIGRATION_LOCK = 8_675_309;

/**
 * A connection for the migrator, with a short retry.
 *
 * The local PGlite listener serves one connection at a time, and when the API
 * is restarted by the file watcher its old connection is torn down a beat
 * after the new process asks for one - the first attempt is reset. In
 * production the same retry covers a pool warming up behind a proxy. Five
 * tries over about three seconds, then the real error.
 */
async function connectWithRetry(): Promise<pg.PoolClient> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await getPool().connect();
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string }).code;
      if (code !== 'ECONNRESET' && code !== 'ECONNREFUSED' && code !== 'EPIPE') throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 400));
    }
  }
  throw lastError;
}

export async function migrate(): Promise<void> {
  const client = await connectWithRetry();
  const q = (text: string, params?: Param[]) =>
    (client as unknown as Queryable).query(text, params);

  try {
    await q(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await q(`CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);

    const done = await q('SELECT name FROM _migrations');
    const applied = new Set((done.rows as Array<{ name: string }>).map((r) => r.name));

    const dir = migrationsDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await q('BEGIN');
      try {
        await q(sql);
        await q('INSERT INTO _migrations (name, applied_at) VALUES ($1, $2)', [
          file,
          new Date().toISOString(),
        ]);
        await q('COMMIT');
        log.info('db', `applied migration ${file}`);
      } catch (err) {
        await q('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await q(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => {});
    (client as { release: () => void }).release();
  }
}
