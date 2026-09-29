/**
 * P0-T03 — real-Postgres engine identity.
 *
 * Runs ONLY in the `npm run test:pg` lane (ELOHIM_PG_LANE=1 with a dedicated
 * disposable target). Under `test:local` (PGlite) or bare vitest it skips
 * loudly: this file must never pass against a substituted engine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { connectionString, migrate } from "../../server/db/index.ts";

const lane = process.env.ELOHIM_PG_LANE === "1";
if (!lane) {
  console.warn(
    "[pg-engine] Not in the test:pg lane — skipping (use `npm run test:pg` with ELOHIM_TEST_PG_URL).",
  );
}

let version = "";
let database = "";
let user = "";

beforeAll(async () => {
  if (!lane) return;
  await migrate();
  const probe = new pg.Client({ connectionString: connectionString() });
  await probe.connect();
  try {
    version = (await probe.query("SELECT version() AS v")).rows[0].v as string;
    database = (await probe.query("SELECT current_database() AS d")).rows[0]
      .d as string;
    user = (await probe.query("SELECT current_user AS u")).rows[0].u as string;
  } finally {
    await probe.end();
  }
}, 60_000);

afterAll(async () => {
  if (!lane) return;
  const probe = new pg.Client({ connectionString: connectionString() });
  await probe.connect();
  try {
    await probe.query("SELECT pg_advisory_unlock_all()");
  } finally {
    await probe.end();
  }
});

describe.skipIf(!lane)("postgres engine identity", () => {
  it("identifies a real engine and version, never a silent PGlite", async () => {
    console.info(`[pg-engine] version: ${version}`);
    console.info(`[pg-engine] database: ${database} as ${user}`);
    expect(version).not.toMatch(/pglite/i);
    expect(version).toMatch(/PostgreSQL/i);
    expect(database).toMatch(/test/i);
  });

  it("reports available extensions and effective privileges", async () => {
    const client = new pg.Client({ connectionString: connectionString() });
    await client.connect();
    try {
      const ext = await client.query(
        "SELECT extname FROM pg_extension ORDER BY extname",
      );
      console.info(
        `[pg-engine] extensions: ${ext.rows.map((r) => r.extname).join(", ") || "(none)"}`,
      );
      // Privilege proof: the lane role can create and drop its own objects.
      await client.query(
        "CREATE TEMP TABLE pg_lane_priv_check (id TEXT PRIMARY KEY)",
      );
      await client.query("DROP TABLE pg_lane_priv_check");
    } finally {
      await client.end();
    }
  });

  it("holds an advisory lock across one connection against another", async () => {
    const lockId = 4_100_000 + (Date.now() % 1_000_000);
    const a = new pg.Client({ connectionString: connectionString() });
    const b = new pg.Client({ connectionString: connectionString() });
    await a.connect();
    await b.connect();
    try {
      await a.query("SELECT pg_advisory_lock($1)", [lockId]);
      const held = await b.query("SELECT pg_try_advisory_lock($1) AS ok", [
        lockId,
      ]);
      expect(held.rows[0].ok).toBe(false);
      const released = await a.query("SELECT pg_advisory_unlock($1) AS ok", [
        lockId,
      ]);
      expect(released.rows[0].ok).toBe(true);
      const acquired = await b.query("SELECT pg_try_advisory_lock($1) AS ok", [
        lockId,
      ]);
      expect(acquired.rows[0].ok).toBe(true);
      await b.query("SELECT pg_advisory_unlock($1)", [lockId]);
    } finally {
      await a.query("SELECT pg_advisory_unlock_all()").catch(() => {});
      await b.query("SELECT pg_advisory_unlock_all()").catch(() => {});
      await a.end();
      await b.end();
    }
  });
});
