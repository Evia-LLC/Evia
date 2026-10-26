/**
 * P1-T07 — atomic provider budget reservations.
 *
 * Proves the reserve → commit → call → settle contract against real
 * concurrency: N independent HTTP requests racing for one remaining allowance
 * admit exactly one; settle/refund/fail are idempotent on the operation ID;
 * midnight binds each reservation to the day that admitted it; a failed
 * dispatch settles once without charging quota; and a pending row survives
 * a process restart so crash recovery can resume it by operation ID. Pending
 * age alone never proves that a provider was not dispatched.
 *
 * Lane-only like its neighbours: skips loudly outside `npm run test:data-api`.
 * This file is intentionally a real-Postgres lane; CI's `test:data-api` is the
 * gate. Contention is proven through real HTTP requests and real Postgres locks.
 *
 * Synthetic data only: every user and operation ID in this file is
 * prefixed `p1t07-` and is cleaned up in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from 'node:child_process';
import { database, result, requireDataApi } from '../helpers/data-api.ts';
import { readBudgetUsage } from '../../server/db/budget.ts';
import {
  allowance,
  BudgetDispatchError,
  dayString,
  failReservation,
  getReservation,
  listPendingReservations,
  refundReservation,
  reserve,
  settleReservation,
  withReservation,
} from "../../server/ai/budget.ts";

const lane = process.env.ELOHIM_DATA_API_LANE === '1';

const tag = `p1t07-${process.pid}`;

async function ledgerFor(
  day: string,
  userId: string,
): Promise<{ turns: number; input: number; output: number } | undefined> {
  const found = await result<{ turns: number; input_tokens: number; output_tokens: number } | null>(
    database().from('usage_ledger').select('turns,input_tokens,output_tokens').eq('day', day).eq('user_id', userId).maybeSingle(),
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
  await requireDataApi();
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
  await result(database().from('budget_reservations').delete().like('user_id', 'p1t07-%'));
  await result(database().from('usage_ledger').delete().like('user_id', 'p1t07-%'));
});

describe.skipIf(!lane)("budget reservations", () => {
  it('does not dispatch when admission committed but its HTTP acknowledgement was lost', async () => {
    setCaps('100', '100', '100000000');
    const input = { operationId: `${tag}-lost-ack`, userId: `${tag}-lost-ack-user`,
      provider: 'fixture', unit: 'chat-tokens', estimatedUnits: 10, day: '2031-06-01' };
    const dispatch = vi.fn(async () => ({ result: 'should not dispatch', actual: { inputTokens: 1 } }));
    const nativeFetch = globalThis.fetch;
    let lose = true;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await nativeFetch(url, init);
      if (lose && String(url).includes('/rpc/evia_budget_reserve')) {
        lose = false;
        await response.arrayBuffer();
        throw new TypeError('simulated lost acknowledgement');
      }
      return response;
    });
    try {
      await expect(withReservation(input, dispatch)).rejects.toThrow('over budget: global_tokens');
      expect(dispatch).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
    expect(await getReservation(input.operationId)).toMatchObject({ status: 'pending' });
    const replay = await reserve(input);
    expect(replay.ok && replay.duplicate).toBe(true);
    await refundReservation(input.operationId);
  });

  it('allows only one concurrent terminal transition and accounts actual overrun once', async () => {
    setCaps('100', '100', '100000000');
    const operationId = `${tag}-terminal-race`;
    const userId = `${tag}-terminal-user`;
    expect((await reserve({ operationId, userId, provider: 'fixture', unit: 'chat-tokens', estimatedUnits: 1, day: '2031-06-02' })).ok).toBe(true);
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => i % 2 === 0
      ? settleReservation(operationId, { inputTokens: 60, outputTokens: 40 }) : refundReservation(operationId)));
    expect(outcomes.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(outcomes.filter((r) => r.ok && r.duplicate)).toHaveLength(7);
    const final = await getReservation(operationId);
    const ledger = await ledgerFor('2031-06-02', userId);
    expect(ledger).toMatchObject(final?.status === 'settled'
      ? { turns: 1, input: 60, output: 40 } : { turns: 0, input: 0, output: 0 });
    if (final?.status === 'settled') expect(final.actualUnits).toBe(100);
  });

  it("admits exactly one of N independent HTTP requests racing for one allowance", async () => {
    // One global turn left for the whole day; every contender is a different
    // user with ample personal quota, so the ONLY gate is the shared one.
    const day = "2031-05-01";
    setCaps("100", "1", "100000000");
    const N = 8;
    const starts = Array.from({ length: N }, (_, i) => ({
      userId: `${tag}-race-${i}`,
      operationId: `${tag}-race-op-${i}`,
    }));

    const contender = (parts: { userId: string; operationId: string }) => reserve({
      ...parts, provider: 'anthropic', unit: 'chat-tokens', estimatedUnits: 10, day,
    });

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
    const totals = await readBudgetUsage(day, '');
    expect(totals.globalLedgerTurns + totals.globalPendingTurns).toBe(1);

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

    // A fresh Node process has no shared client/session/JS state from the writer.
    const recovered = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      'import { getReservation } from "./server/ai/budget.ts"; console.log(JSON.stringify(await getReservation(process.argv[1])));', opId],
      { encoding: 'utf8', timeout: 15_000 }));
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
