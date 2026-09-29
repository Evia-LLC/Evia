/**
 * P0-T03 — disposable real-Postgres integration lane.
 *
 * Runs `test/integration` against a dedicated ephemeral Postgres target.
 * Unlike `test:local` (in-memory PGlite), this lane proves multi-connection
 * behavior — transactions, advisory locks, contention — on a real engine.
 *
 * Safety rules (fail fast, never substitute):
 * - The target comes ONLY from ELOHIM_TEST_PG_URL. Inherited application
 *   URLs (NETLIFY_DATABASE_URL / DATABASE_URL) are never used as fallback;
 *   pointing the dedicated var at one of them is rejected.
 * - The target must be disposable: loopback host AND a database name
 *   containing "test". Anything else fails before any test runs.
 * - The engine must not be PGlite: SELECT version() is checked and printed;
 *   a PGlite wire-compatible imposter fails the lane.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import pg from "pg";

const redact = (text) =>
  String(text).replace(
    /postgres(?:ql)?:\/\/[^\s'"<>]+/gi,
    "[database URL redacted]",
  );
const report = (text) => console.log(`[test:pg] ${text}`);
const fail = (message) => {
  console.error(`[test:pg] ${message}`);
  process.exit(1);
};

const target = process.env.ELOHIM_TEST_PG_URL ?? "";
if (!target) {
  fail(
    "Set ELOHIM_TEST_PG_URL to a disposable Postgres connection string " +
      '(loopback host, database name containing "test"). ' +
      "This lane never falls back to NETLIFY_DATABASE_URL/DATABASE_URL and never substitutes PGlite.",
  );
}

let parsed;
try {
  parsed = new URL(target);
} catch {
  fail("ELOHIM_TEST_PG_URL is not a valid URL.");
}
if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
  fail(
    `ELOHIM_TEST_PG_URL must use the postgres:// scheme (got "${parsed.protocol}").`,
  );
}
const host = parsed.hostname;
if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
  fail(
    `Refusing non-loopback Postgres target (host "${host}"). Use a disposable local/CI database.`,
  );
}
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!/test/i.test(dbName)) {
  fail(
    `Refusing database "${dbName || "(none)"}": the name must contain "test" to prove disposability.`,
  );
}
for (const inherited of ["NETLIFY_DATABASE_URL", "DATABASE_URL"]) {
  if (process.env[inherited] && process.env[inherited] === target) {
    fail(
      `ELOHIM_TEST_PG_URL must not equal ${inherited}: the integration lane never runs against application database URLs.`,
    );
  }
}

// Prove the engine before running anything that would trust it.
const probe = new pg.Client({
  connectionString: target,
  connectionTimeoutMillis: 10_000,
});
try {
  await probe.connect();
} catch (err) {
  fail(
    `Cannot connect to the disposable target: ${redact(err instanceof Error ? err.message : err)}`,
  );
}
let version = "";
let database = "";
let user = "";
try {
  version = (await probe.query("SELECT version() AS v")).rows[0].v;
  database = (await probe.query("SELECT current_database() AS d")).rows[0].d;
  user = (await probe.query("SELECT current_user AS u")).rows[0].u;
} finally {
  await probe.end().catch(() => {});
}
if (/pglite/i.test(version)) {
  fail(
    "Target reports a PGlite engine. This lane requires real Postgres; PGlite coverage belongs to `npm run test:local`.",
  );
}
report(`Engine: ${version}`);
report(`Database "${database}" as "${user}"; running test/integration.`);

const child = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "test/integration"],
  {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      NETLIFY_DATABASE_URL: target,
      DATABASE_URL: target,
      ELOHIM_DB_POOL: "4",
      ELOHIM_PG_LANE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => output.write(`${redact(line)}\n`));
}
const code = await new Promise((resolve) => {
  child.once("error", () => resolve(1));
  child.once("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
});
process.exit(code);
