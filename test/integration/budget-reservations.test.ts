/**
 * P1-T07 — atomic provider budget reservations.
 *
 * Proves the reserve → commit → call → settle contract against real
 * concurrency: N independent connections racing for one remaining allowance
 * admit exactly one; settle/refund/fail are idempotent on the operation ID;
 * midnight binds each reservation to the day that admitted it; a failed
 * dispatch settles once without charging quota; and a pending row survives
 * a pool restart so crash recovery can resume it by operation ID. Pending
 * age alone never proves that a provider was not dispatched.
 *
 * Lane-only like its neighbours: skips loudly outside `npm run test:pg`.
 * This file is intentionally a real-Postgres lane; CI's `test:pg` is the
 * gate. The in-memory PGlite lane does not prove independent-connection
 * locking semantics and is never accepted as evidence here.
 *
 * Synthetic data only: every user and operation ID in this file is
 * prefixed `p1t07-` and is cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  connectionString,
  migrate,
  row,
  run,
  toPg,
  type Param,
} from "../../server/db/index.ts";
import {
  allowance,
  BudgetDispatchError,
  dayString,
  failReservation,
  getReservation,
  listPendingReservations,
  refundReservation,
  reserve,
  reserveInTransaction,
  settleReservation,
  withReservation,
  type BudgetTx,
} from "../../server/ai/budget.ts";

const lane = process.env.ELOHIM_PG_LANE === "1";
if (!lane) {
  console.warn(
    "[budget-reservations] Not in the test:pg lane — skipping (use `npm run test:pg` with ELOHIM_TEST_PG_URL).",
  );
}

const tag = `p1t07-${process.pid}`;

async function client() {
  const c = new pg.Client({ connectionString: connectionString() });
  await c.connect();
  return c;
}

/** Wraps one raw connection as a BudgetTx with its own BEGIN/COMMIT. */
function txOver(c: pg.Client): BudgetTx {
  const query = (sql: string, params: Param[]) =>
    c.query(toPg(sql), params as unknown[]);
  return {
    rows: async <R>(sql: string, ...params: Param[]) =>
      (await query(sql, params)).rows as R[],
    row: async <R>(sql: string, ...params: Param[]) =>
      (await query(sql, params)).rows[0] as R | undefined,
    run: async (sql: string, ...params: Param[]) =>
      (await query(sql, params)).rowCount ?? 0,
  };
}

async function ledgerFor(
  day: string,
  userId: string,
): Promise<{ turns: number; input: number; output: number } | undefined> {
  const found = await row<{
    turns: string | number;
    input_tokens: string | number;
    output_tokens: string | number;
  }>(
    "SELECT turns, input_tokens, output_tokens FROM usage_ledger WHERE day = ? AND user_id = ?",
    day,
    userId,
  );
  if (!found) return undefined;
  return {
    turns: Number(found.turns),
    input: Number(found.input_tokens),
    output: Number(found.output_tokens),
  };
}

const savedEnv = {
  userTurns: process.env.ELOHIM_USER_DAILY_TURNS,
  dailyTurns: process.env.ELOHIM_DAILY_TURNS,
  dailyTokens: process.env.ELOHIM_DAILY_TOKENS,
};

function setCaps(userTurns: string, dailyTurns: string, dailyTokens: string) {
  process.env.ELOHIM_USER_DAILY_TURNS = userTurns;
  process.env.ELOHIM_DAILY_TURNS = dailyTurns;
  process.env.ELOHIM_DAILY_TOKENS = dailyTokens;
}

beforeAll(async () => {
  if (!lane) return;
  await migrate();
}, 60_000);

afterAll(async () => {
  if (savedEnv.userTurns === undefined)
    delete process.env.ELOHIM_USER_DAILY_TURNS;
  else process.env.ELOHIM_USER_DAILY_TURNS = savedEnv.userTurns;
  if (savedEnv.dailyTurns === undefined) delete process.env.ELOHIM_DAILY_TURNS;
  else process.env.ELOHIM_DAILY_TURNS = savedEnv.dailyTurns;
  if (savedEnv.dailyTokens === undefined)
    delete process.env.ELOHIM_DAILY_TOKENS;
  else process.env.ELOHIM_DAILY_TOKENS = savedEnv.dailyTokens;
  if (!lane) return;
  // Synthetic rows only: nothing outside the p1t07- prefix is touched.
  await run("DELETE FROM budget_reservations WHERE user_id LIKE 'p1t07-%'");
  await run("DELETE FROM usage_ledger WHERE user_id LIKE 'p1t07-%'");
});

describe.skipIf(!lane)("budget reservations", () => {
  it("admits exactly one of N independent connections racing for one allowance", async () => {
    // One global turn left for the whole day; every contender is a different
    // user with ample personal quota, so the ONLY gate is the shared one.
    const day = "2031-05-01";
    setCaps("100", "1", "100000000");
    const N = 8;
    const starts = Array.from({ length: N }, (_, i) => ({
      userId: `${tag}-race-${i}`,
      operationId: `${tag}-race-op-${i}`,
    }));

    const contender = async (parts: {
      userId: string;
      operationId: string;
    }) => {
      const c = await client();
      try {
        await c.query("BEGIN");
        try {
          const outcome = await reserveInTransaction(txOver(c), {
            operationId: parts.operationId,
            userId: parts.userId,
            provider: "anthropic",
            unit: "chat-tokens",
            estimatedUnits: 10,
            day,
          });
          await c.query("COMMIT");
          return outcome;
        } catch (err) {
          await c.query("ROLLBACK").catch(() => {});
          throw err;
        }
      } finally {
        await c.end().catch(() => {});
      }
    };

    // All N transactions open and race; transport failures are hard failures.
    // This proof is intentionally real-Postgres-only and must never be made
    // green by retrying or skipping a broken concurrent connection.
    const outcomes = await Promise.all(starts.map(contender));
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(N - 1);
    for (const loser of losers) {
      expect(loser).toMatchObject({ ok: false, reason: "global_turns" });
    }

    // Ledger plus pending counts the winner exactly once: no double-spend.
    const totals = await row<{ turns: string | number }>(
      `SELECT coalesce(sum(turns), 0)
         + (SELECT count(*) FROM budget_reservations WHERE day = ? AND status = 'pending') AS turns
       FROM usage_ledger WHERE day = ?`,
      day,
      day,
    );
    expect(Number(totals?.turns ?? 0)).toBe(1);

    // Hygiene: settle the winner so later tests see no stray pending rows.
    const winner = winners[0];
    if (winner.ok) {
      await settleReservation(winner.reservation.operationId, {
        inputTokens: 5,
        outputTokens: 5,
      });
    }
  });

  it("is idempotent for one operation ID and rejects mismatched replay metadata", async () => {
    const day = "2031-05-01";
    setCaps("100", "100", "100000000");
    const operationId = `${tag}-replay-op`;
    const base = {
      operationId,
      userId: `${tag}-replay-user`,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 25,
      day,
    } as const;

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => reserve(base)),
    );
    expect(attempts.filter((r) => r.ok)).toHaveLength(6);
    expect(attempts.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(new Set(attempts.filter((r) => r.ok).map((r) => r.reservation.operationId))).toEqual(
      new Set([operationId]),
    );

    await expect(
      reserve({ ...base, userId: `${tag}-other-user` }),
    ).rejects.toThrow(/operationId/i);
    await expect(
      reserve({ ...base, provider: "elevenlabs" }),
    ).rejects.toThrow(/operationId/i);
    await expect(
      reserve({ ...base, unit: "tts-chars" }),
    ).rejects.toThrow(/operationId/i);
    await expect(
      reserve({ ...base, estimatedUnits: 26 }),
    ).rejects.toThrow(/operationId/i);
    await expect(
      reserve({ ...base, day: "2031-05-02" }),
    ).rejects.toThrow(/operationId/i);

    await refundReservation(operationId);
  });

  it("keeps a pending reservation when settlement input is invalid", async () => {
    const day = "2031-05-01";
    setCaps("100", "100", "100000000");
    const operationId = `${tag}-invalid-settle`;
    expect(
      (
        await reserve({
          operationId,
          userId: `${tag}-invalid-settle-user`,
          provider: "anthropic",
          unit: "chat-tokens",
          estimatedUnits: 10,
          day,
        })
      ).ok,
    ).toBe(true);

    await expect(
      settleReservation(operationId, { inputTokens: -1 }),
    ).rejects.toThrow(/inputTokens/i);
    expect((await getReservation(operationId))?.status).toBe("pending");
    await refundReservation(operationId);
  });

  it("counts duplicate settle and duplicate refund exactly once", async () => {
    const day = "2031-05-02";
    setCaps("100", "100", "100000000");
    const userId = `${tag}-idem`;
    const first = await reserve({
      operationId: `${tag}-idem-op-1`,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 100,
      day,
    });
    expect(first.ok).toBe(true);

    const opId = `${tag}-idem-op-1`;
    const s1 = await settleReservation(opId, {
      inputTokens: 60,
      outputTokens: 40,
    });
    const s2 = await settleReservation(opId, {
      inputTokens: 60,
      outputTokens: 40,
    });
    expect(s1.ok && s2.ok).toBe(true);
    if (s1.ok && s2.ok) {
      expect(s1.duplicate).toBe(false);
      expect(s2.duplicate).toBe(true);
      expect(s2.reservation.status).toBe("settled");
      expect(s2.reservation.actualUnits).toBe(100);
    }

    // Refunding after settle is a terminal-state no-op, not a second move.
    const r1 = await refundReservation(opId);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.duplicate).toBe(true);

    const ledger = await ledgerFor(day, userId);
    expect(ledger).toMatchObject({ turns: 1, input: 60, output: 40 });

    // Refund path, separately: double refund leaves the ledger untouched and
    // a later settle cannot resurrect the reservation.
    const op2 = `${tag}-idem-op-2`;
    expect(
      (
        await reserve({
          operationId: op2,
          userId,
          provider: "elevenlabs",
          unit: "tts-chars",
          estimatedUnits: 500,
          day,
        })
      ).ok,
    ).toBe(true);
    const f1 = await refundReservation(op2);
    const f2 = await refundReservation(op2);
    expect(f1.ok && f2.ok).toBe(true);
    const late = await settleReservation(op2, { units: 500 });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.duplicate).toBe(true);
    expect(await ledgerFor(day, userId)).toMatchObject({
      turns: 1,
      input: 60,
      output: 40,
    });
    expect((await getReservation(op2))?.status).toBe("refunded");
  });

  it("binds reservations to the admitting day across the midnight boundary", async () => {
    // One turn per user per day: yesterday's pending must not spend today's
    // cap, and today's cap must still deny a second today-reservation.
    setCaps("1", "100", "100000000");
    const userId = `${tag}-midnight`;
    const yesterday = dayString(new Date(Date.now() - 24 * 3_600 * 1_000));
    const todayKey = dayString(new Date(Date.now()));
    expect(yesterday).not.toBe(todayKey);

    const y = await reserve({
      operationId: `${tag}-mid-op-y`,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 10,
      day: yesterday,
    });
    expect(y.ok).toBe(true);

    // The advisory `allowance` agrees yesterday's row does not leak forward.
    expect(await allowance(userId, todayKey)).toMatchObject({
      ok: true,
      reason: "",
    });

    const t1 = await reserve({
      operationId: `${tag}-mid-op-t1`,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 10,
      day: todayKey,
    });
    expect(t1.ok).toBe(true);

    const t2 = await reserve({
      operationId: `${tag}-mid-op-t2`,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 10,
      day: todayKey,
    });
    expect(t2).toMatchObject({ ok: false, reason: "user_turns" });

    // Settling the yesterday reservation after "midnight" debits yesterday:
    // no double-spend onto today, no lost reservation. Today holds only the
    // zero-spend lock-anchor row the reserve wrote, never a charge.
    const settled = await settleReservation(`${tag}-mid-op-y`, {
      inputTokens: 5,
      outputTokens: 5,
    });
    expect(settled.ok).toBe(true);
    expect(await ledgerFor(yesterday, userId)).toMatchObject({ turns: 1 });
    expect(await ledgerFor(todayKey, userId)).toMatchObject({
      turns: 0,
      input: 0,
      output: 0,
    });

    // Hygiene: release today's pending hold so later tests start clean.
    await refundReservation(`${tag}-mid-op-t1`);
  });

  it("settles a failed dispatch exactly once without charging quota", async () => {
    const day = "2031-05-03";
    setCaps("100", "100", "100000000");
    const userId = `${tag}-failed`;
    const opId = `${tag}-fail-op-1`;

    // The withReservation shape: a throwing provider settles once as failed
    // and the original error still reaches the caller.
    await expect(
      withReservation(
        {
          operationId: opId,
          userId,
          provider: "perfectcorp",
          unit: "vision-tasks",
          estimatedUnits: 1,
          day,
        },
        async () => {
          throw new BudgetDispatchError("provider exploded", false);
        },
      ),
    ).rejects.toThrow("provider exploded");
    expect((await getReservation(opId))?.status).toBe("failed");

    // Duplicate fail and late settle/refund are all terminal no-ops.
    const again = await failReservation(opId, "dispatch_failed");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.duplicate).toBe(true);
    const late = await settleReservation(opId, { units: 1 });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.duplicate).toBe(true);
    const refunded = await refundReservation(opId);
    expect(refunded.ok).toBe(true);
    if (refunded.ok) expect(refunded.duplicate).toBe(true);

    // Policy: a call that never ran records no spend — the ledger holds at
    // most the zero-spend lock-anchor row the reserve wrote.
    expect(await ledgerFor(day, userId)).toMatchObject({
      turns: 0,
      input: 0,
      output: 0,
    });
  });

  it("keeps an ambiguous provider error pending for reconciliation", async () => {
    const day = "2031-05-03";
    setCaps("100", "100", "100000000");
    const opId = `${tag}-uncertain-op-1`;

    await expect(
      withReservation(
        {
          operationId: opId,
          userId: `${tag}-uncertain`,
          provider: "anthropic",
          unit: "chat-tokens",
          estimatedUnits: 10,
          day,
        },
        async () => {
          throw new Error("socket closed after dispatch");
        },
      ),
    ).rejects.toThrow("socket closed after dispatch");

    expect((await getReservation(opId))?.status).toBe("pending");
    await refundReservation(opId);
  });

  it("keeps pending reservations resumable by operation ID across a restart", async () => {
    const day = "2031-05-04";
    setCaps("100", "100", "100000000");
    const userId = `${tag}-crash`;
    const opId = `${tag}-crash-op-1`;

    const admitted = await reserve({
      operationId: opId,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits: 250,
      day,
    });
    expect(admitted.ok).toBe(true);

    // Simulate process death: drop the pool. Nothing in memory may matter —
    // the pending row is the whole recovery story. (No sweeper forgives it.)
    const { closePool } = await import("../../server/db/index.ts");
    await closePool();

    const recovered = await getReservation(opId);
    expect(recovered).toMatchObject({
      operationId: opId,
      userId,
      day,
      status: "pending",
      estimatedUnits: 250,
    });
    expect(await listPendingReservations(day)).toEqual(
      expect.arrayContaining([expect.objectContaining({ operationId: opId })]),
    );

    // The outcome is now known (provider confirms 200 tokens): settle once
    // from the "new process" and the pending hold converts to actuals.
    const settled = await settleReservation(opId, {
      inputTokens: 150,
      outputTokens: 50,
    });
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.duplicate).toBe(false);
    expect(await listPendingReservations(day)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ operationId: opId })]),
    );
    expect(await ledgerFor(day, userId)).toMatchObject({
      turns: 1,
      input: 150,
      output: 50,
    });
  });

  it("does not infer dispatch outcome from age; pending rows remain recoverable", async () => {
    const day = "2031-05-05";
    setCaps("100", "100", "100000000");
    const operationId = `${tag}-pending-age`;
    expect(
      (
        await reserve({
          operationId,
          userId: `${tag}-pending-age-user`,
          provider: "anthropic",
          unit: "chat-tokens",
          estimatedUnits: 10,
          day,
        })
      ).ok,
    ).toBe(true);
    expect(await listPendingReservations(day)).toEqual(
      expect.arrayContaining([expect.objectContaining({ operationId, status: "pending" })]),
    );
    expect((await getReservation(operationId))?.status).toBe("pending");
    await refundReservation(operationId);
  });
});
