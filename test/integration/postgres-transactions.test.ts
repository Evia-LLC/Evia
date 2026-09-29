/**
 * P0-T03 — rollback, isolation and row contention on real Postgres.
 *
 * Two independent pg.Client connections (never the shared pool) contend on
 * one scratch row. Lane-only: skips loudly outside `npm run test:pg`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { connectionString, migrate } from "../../server/db/index.ts";

const lane = process.env.ELOHIM_PG_LANE === "1";
if (!lane) {
  console.warn(
    "[pg-transactions] Not in the test:pg lane — skipping (use `npm run test:pg` with ELOHIM_TEST_PG_URL).",
  );
}

const key = `lane-${process.pid}`;

async function client() {
  const c = new pg.Client({ connectionString: connectionString() });
  await c.connect();
  return c;
}

async function count(c: pg.Client) {
  const r = await c.query(
    "SELECT COUNT(*)::int AS n FROM pg_lane_probe WHERE id = $1",
    [key],
  );
  return r.rows[0].n as number;
}

beforeAll(async () => {
  if (!lane) return;
  await migrate();
  const c = await client();
  try {
    await c.query(
      "CREATE TABLE IF NOT EXISTS pg_lane_probe (id TEXT PRIMARY KEY, v INT NOT NULL)",
    );
    await c.query("DELETE FROM pg_lane_probe WHERE id = $1", [key]);
  } finally {
    await c.end();
  }
}, 60_000);

afterAll(async () => {
  if (!lane) return;
  const c = await client();
  try {
    await c.query("DELETE FROM pg_lane_probe WHERE id = $1", [key]);
  } finally {
    await c.end();
  }
});

describe.skipIf(!lane)("postgres rollback and isolation", () => {
  it("rolls back an aborted transaction with nothing left behind", async () => {
    const c = await client();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO pg_lane_probe (id, v) VALUES ($1, 1)", [key]);
      expect(await count(c)).toBe(1);
      await c.query("ROLLBACK");
      expect(await count(c)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("isolates uncommitted writes from a second connection", async () => {
    const a = await client();
    const b = await client();
    try {
      await a.query("BEGIN");
      await a.query("INSERT INTO pg_lane_probe (id, v) VALUES ($1, 2)", [key]);
      expect(await count(b)).toBe(0);
      await a.query("COMMIT");
      expect(await count(b)).toBe(1);
    } finally {
      await a.end();
      await b.end();
    }
    const c = await client();
    try {
      await c.query("DELETE FROM pg_lane_probe WHERE id = $1", [key]);
    } finally {
      await c.end();
    }
  });

  it("fails the contender on a locked row and cleans up after the failure", async () => {
    const setup = await client();
    try {
      await setup.query(
        "INSERT INTO pg_lane_probe (id, v) VALUES ($1, 10) ON CONFLICT (id) DO UPDATE SET v = 10",
        [key],
      );
    } finally {
      await setup.end();
    }
    const a = await client();
    const b = await client();
    try {
      await a.query("BEGIN");
      await a.query("UPDATE pg_lane_probe SET v = 11 WHERE id = $1", [key]);
      await b.query("SET lock_timeout = '2s'");
      await expect(
        b.query("UPDATE pg_lane_probe SET v = 12 WHERE id = $1", [key]),
      ).rejects.toMatchObject({
        code: "55P03",
      });
      await a.query("ROLLBACK");
    } finally {
      await a.end();
      await b.end();
    }
    // Cleanup proof: the failed contender left no lock and no partial write.
    const c = await client();
    try {
      const r = await c.query("SELECT v FROM pg_lane_probe WHERE id = $1", [
        key,
      ]);
      expect(r.rows[0].v).toBe(10);
      await c.query("UPDATE pg_lane_probe SET v = 13 WHERE id = $1", [key]);
      expect(
        (await c.query("SELECT v FROM pg_lane_probe WHERE id = $1", [key]))
          .rows[0].v,
      ).toBe(13);
      await c.query("DELETE FROM pg_lane_probe WHERE id = $1", [key]);
      expect(await count(c)).toBe(0);
    } finally {
      await c.end();
    }
  });
});
