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

/** Default pool size: a function instance handles a request or two at a time. */
export const DB_POOL_DEFAULT = 3;
/** At least one connection, or the pool is useless. */
export const DB_POOL_MIN = 1;
/**
 * Hard ceiling per process. Even a persistent server needs far fewer than
 * this against hosted Postgres; anything larger is a misconfiguration that
 * would exhaust the provider's connection limit instead.
 */
export const DB_POOL_MAX = 50;

/**
 * Validates the pool size.
 *
 * A bare `Number(...)` accepts empty strings as 0, trailing junk as NaN and
 * any magnitude, and the old code passed whatever came out straight to `pg`.
 * Only plain integers inside the bound are accepted. The error names the
 * variable, never its value, so a pasted secret can never leak through it.
 */
export function parsePoolMax(raw: string | undefined): number {
  if (raw === undefined) return DB_POOL_DEFAULT;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(
      `ELOHIM_DB_POOL must be an integer between ${DB_POOL_MIN} and ${DB_POOL_MAX}.`,
    );
  }
  const size = Number(text);
  if (!Number.isSafeInteger(size) || size < DB_POOL_MIN || size > DB_POOL_MAX) {
    throw new Error(
      `ELOHIM_DB_POOL must be an integer between ${DB_POOL_MIN} and ${DB_POOL_MAX}.`,
    );
  }
  return size;
}

/** Pool size from the environment, validated. */
export function resolvePoolMax(): number {
  return parsePoolMax(process.env.ELOHIM_DB_POOL);
}

/**
 * True for hostnames that are unambiguously this machine.
 *
 * The old check was a regex over the raw connection string, so it missed
 * `postgresql://`, IPv6 forms it did not spell out, and the rest of 127/8.
 * Parsing the URL first means the hostname is compared, not guessed at.
 */
export function isLoopbackHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  // URL.hostname already strips the brackets from IPv6 literals; tolerate
  // them anyway so direct callers cannot slip past with `[::1]`.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost') return true;
  // IPv6 loopback, compressed or fully expanded.
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // 127/8 is loopback (RFC 1122) — all of it, not just 127.0.0.1.
  if (/^127(\.\d{1,3}){3}$/.test(host)) {
    return host
      .split('.')
      .every((octet) => octet.length <= 3 && Number(octet) <= 255);
  }
  // IPv4-mapped IPv6 loopback, e.g. ::ffff:127.0.0.1.
  if (host.startsWith('::ffff:'))
    return isLoopbackHostname(host.slice('::ffff:'.length));
  return false;
}

/** `sslmode` values that encrypt at best and verify never. */
const SSL_MODE_UNVERIFIED = new Set(['disable', 'allow', 'prefer']);
/** Falsy spellings for boolean URL options. */
const FALSE_VALUES = new Set([
  '0',
  'false',
  'f',
  'off',
  'no',
  'n',
  'disable',
  'disabled',
]);

/**
 * Parses the connection string as a URL, accepting both `postgres://` and
 * `postgresql://` schemes, IPv6 literals and explicit ports.
 */
function parsedConnectionUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Database connection string is not a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `Database connection string must use the postgres:// scheme (got '${parsed.protocol}').`,
    );
  }
  return parsed;
}

/**
 * Rejects URL query options that would disable certificate verification.
 *
 * `pg` honours some of these itself, so leaving them in place would let the
 * string silently downgrade the verification the pool is built with — or
 * mislead an operator into thinking `sslmode` in the URL is the policy.
 * Anything that weakens verification throws here, before the driver ever
 * sees the string. Benign values (`sslmode=require`, `verify-ca`,
 * `verify-full`) pass through untouched. Errors never repeat the URL, which
 * carries credentials.
 */
function rejectInsecureUrlOptions(parsed: URL): void {
  const entries: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    entries.push([key.toLowerCase(), value.toLowerCase().trim()]);
  });
  for (const [key, value] of entries) {
    if (key === 'sslmode' && SSL_MODE_UNVERIFIED.has(value)) {
      throw new Error(
        'Database connection string sets sslmode to a value that disables certificate ' +
          'verification; remove it — remote connections always verify.',
      );
    }
    if (key === 'ssl' && FALSE_VALUES.has(value)) {
      throw new Error(
        'Database connection string disables SSL via the URL; remove it — ' +
          'remote connections always verify.',
      );
    }
    if (
      (key === 'rejectunauthorized' || key === 'reject_unauthorized') &&
      FALSE_VALUES.has(value)
    ) {
      throw new Error(
        'Database connection string disables certificate verification via the URL; ' +
          'remove it — remote connections always verify.',
      );
    }
  }
}

/**
 * Explicit CA for Postgres TLS.
 *
 * `ELOHIM_DB_CA` is either a file path (read once, at pool creation) or
 * inline PEM contents. Operator dashboards often collapse newlines into
 * literal `\n` sequences when a certificate is pasted, so those are expanded.
 * Unset means the system roots, which already verify the public providers.
 * Errors name the variable, never its contents.
 */
export function resolveCaCert(): string | undefined {
  const raw = process.env.ELOHIM_DB_CA;
  if (raw === undefined || raw.trim() === '') return undefined;
  const text = raw.trim();
  let candidate: string | null = null;
  try {
    if (fs.existsSync(text) && fs.statSync(text).isFile()) {
      candidate = fs.readFileSync(text, 'utf8');
    }
  } catch {
    throw new Error(
      'ELOHIM_DB_CA points at a certificate file that cannot be read.',
    );
  }
  const pem = (candidate ?? text).replace(/\\n/g, '\n').trim();
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      'ELOHIM_DB_CA is set but is neither a readable certificate file nor PEM contents.',
    );
  }
  return pem;
}

/**
 * TLS policy for one connection string.
 *
 * Plain text to loopback development databases only — the PGlite listeners
 * in `scripts/dev-db.mjs` and `scripts/test-local.mjs` do not speak SSL —
 * and verified TLS to everything else. Exported so the policy is testable
 * without opening a connection.
 */
export function resolveSslConfig(url: string): pg.PoolConfig['ssl'] {
  const parsed = parsedConnectionUrl(url);
  rejectInsecureUrlOptions(parsed);
  if (isLoopbackHostname(parsed.hostname)) return undefined;
  const ca = resolveCaCert();
  return ca === undefined
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: true, ca };
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
    max: resolvePoolMax(),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Verified TLS to anything that is not this machine; plaintext only for
    // loopback development databases. URL options that disable verification
    // throw inside resolveSslConfig instead of silently downgrading.
    ssl: resolveSslConfig(url),
  });
  return pool;
}

/**
 * Closes the shared pool and forgets it, so the next query builds a fresh
 * one from the current environment. Used by graceful shutdown and by tests
 * that need a clean pool after changing connection settings.
 */
export async function closePool(): Promise<void> {
  const closing = pool;
  pool = null;
  if (closing) await closing.end();
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
