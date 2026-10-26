/**
 * The model budget.
 *
 * Cloud reasoning costs money per token and the app has a public front door.
 * Without a ledger the only limit on spend is how fast people can type, which
 * is not a limit. This keeps one row per user per day and answers two
 * questions before any call is made: has this person had their share today,
 * and has everyone.
 *
 * Over budget is not an error. She keeps talking, from the local engine, and
 * the turn is marked `demo` the same way it is when there is no key at all -
 * the interface already knows how to say she is answering locally. What must
 * never happen is a silent bill, so the check runs before the call and the
 * usage is recorded after it, from the numbers the API actually reported.
 *
 * Limits come from the environment and have conservative defaults:
 *
 *   ELOHIM_USER_DAILY_TURNS   turns per user per day            (default 80)
 *   ELOHIM_DAILY_TURNS        turns across everyone per day     (default 2000)
 *   ELOHIM_DAILY_TOKENS       tokens across everyone per day    (default 4,000,000)
 *
 * Prices are estimates for the cost line in the health report, not the source
 * of truth for any decision - the token counts are.
 *
 * ---------------------------------------------------------------------------
 * P1-T07 — atomic reservations. Read this before touching the code below.
 *
 * The old `allowance()` + `record()` pair is check-then-record: two
 * connections can both read "one allowance left" and both dispatch. Every
 * billable dispatch must instead follow reserve → commit → call → settle:
 *
 *   1. `reserve()` calls a SHORT database transaction that admits or denies ONE
 *      operation. The transaction never spans provider I/O — it commits
 *      before the provider is called, so a slow or hung provider cannot hold
 *      a database transaction (and its locks) open.
 *   2. The provider is called only when the reservation committed with ok.
 *   3. `settleReservation()`, `refundReservation()` or `failReservation()`
 *      moves the reservation out of `pending` EXACTLY ONCE, keyed by the
 *      caller-supplied operation ID.
 *
 * LOCK ORDER (stable everywhere, or concurrent reserves deadlock): inside a
 * reserve transaction, lock the USER row first
 * (`usage_ledger` row for (day, user_id), inserted when absent, then
 * `SELECT ... FOR UPDATE`), and only then take the GLOBAL day serializer
 * (`pg_advisory_xact_lock` on the day key). Settle/refund/fail follow the
 * same relative order: user ledger row first, then the reservation row
 * (`SELECT ... FOR UPDATE`). No path ever takes the global lock before the
 * user row, and no path ever locks two user rows, so there is no lock cycle.
 * The advisory lock is transaction-scoped: it releases on COMMIT/ROLLBACK
 * and dies with the session, so a crashed contender cannot wedge the day.
 *
 * IDEMPOTENCY: the operation ID is the primary key of budget_reservations.
 * A repeated `reserve()` with the same ID returns the existing reservation
 * without counting twice. Settle/refund/fail only transition out of
 * `pending` (`UPDATE ... WHERE status = 'pending'`); a duplicate finds a
 * terminal row and is a no-op that changes no counters. Unknown operation
 * IDs settle to an explicit `unknown_operation` result, never a phantom row.
 *
 * CONSERVATIVE UNCERTAINTY: a dispatched-but-unconfirmed call stays counted
 * against the caps (pending reservations are summed into every admission
 * check). Process death does NOT auto-refund: a call that left the box may
 * already have been billed, and forgiving it would re-admit spend. Crash
 * recovery is structural — the pending row survives, `getReservation()` and
 * `listPendingReservations()` find it by operation ID, and the caller
 * settles or refunds once the provider outcome is known. There is deliberately
 * no age-based expiry: age cannot prove that a provider call was never sent.
 *
 * MIDNIGHT: caps are per day, and a reservation is bound to the day that
 * admitted it (the `day` parameter, defaulting to today). A settle that
 * lands after midnight debits the ORIGINAL day's ledger row, so concurrent
 * requests straddling midnight neither double-spend (charged to both days)
 * nor lose the reservation (charged to neither). Tests pass explicit days;
 * production defaults to the current UTC date.
 *
 * PROVIDER ERRORS: a failed dispatch settles once as `failed` via
 * `failReservation()`. Policy: a failed call releases its estimate and
 * records NOTHING in usage_ledger — a call that never ran must not consume
 * quota, silently or otherwise — and the transition is exactly-once like
 * every other terminal move. `withReservation()` encodes the whole pattern
 * (reserve → run → settle-or-fail) so new dispatch sites cannot forget it.
 *
 * ESTIMATES VS ACTUALS, AND THE OVERRUN NOTE: `estimatedUnits` is an
 * admission estimate in the unit's natural quantity (tokens, characters,
 * tasks) — it decides whether the call may start. It is NOT a strict dollar
 * cap and token estimates are NOT a spend ceiling: the provider bills what
 * it bills. `settleReservation()` records the provider-REPORTED actuals
 * against the ledger even when they exceed the estimate. Overrun is
 * accounted, never silently dropped and never retroactively denied.
 * Only the `chat-tokens` unit draws on the global token cap; the
 * `tts-chars` and `vision-tasks` units consume turn capacity (one pending
 * turn each), which is the bounded user + global capacity the plan asks
 * for. Per-provider unit caps, if ever wanted, belong to P1-T08's
 * dispatch inventory, not to this mechanism.
 */
import {
  reserveBudget, transitionBudget, readBudgetUsage, readBudgetAllowance,
  getBudgetReservation, pendingBudgetReservations, type ReservationRow,
} from '../db/budget.ts';
import { DataApiError } from '../lib/data-api.ts';
import { log } from "../lib/log.ts";

function limit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export interface BudgetVerdict {
  ok: boolean;
  /** Why not, in a form the log can carry. Empty when ok. */
  reason: "" | "user_turns" | "global_turns" | "global_tokens";
}

/** Calendar day (YYYY-MM-DD) for cap accounting. Injectable for tests. */
export function dayString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

const today = (): string => dayString();

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function checkDay(day: string): string {
  if (!DAY_PATTERN.test(day)) {
    throw new Error("budget day must be YYYY-MM-DD.");
  }
  return day;
}

function caps() {
  return {
    p_user_cap: limit('ELOHIM_USER_DAILY_TURNS', 80),
    p_turn_cap: limit('ELOHIM_DAILY_TURNS', 2000),
    p_token_cap: limit('ELOHIM_DAILY_TOKENS', 4_000_000),
  };
}

export type ReservationStatus = "pending" | "settled" | "refunded" | "failed";

export interface ReservationInput {
  /** Caller-supplied idempotency key. Retrying with it never double-counts. */
  operationId: string;
  userId: string;
  provider: string;
  /** e.g. chat-tokens, tts-chars, vision-tasks. */
  unit: string;
  /**
   * Admission estimate in the unit's natural quantity. NOT a spend cap —
   * see the overrun note in the header.
   */
  estimatedUnits: number;
  /** Day the reservation counts against. Defaults to today. */
  day?: string;
}

export interface Reservation {
  operationId: string;
  userId: string;
  day: string;
  provider: string;
  unit: string;
  estimatedUnits: number;
  status: ReservationStatus;
  actualUnits: number | null;
  failReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation; duplicate: boolean }
  | { ok: false; reason: Exclude<BudgetVerdict["reason"], ""> };

export type SettleResult =
  | { ok: true; reservation: Reservation; duplicate: boolean }
  | { ok: false; reason: "unknown_operation" };

/** Reusing an idempotency key for a different operation is a caller bug. */
export class BudgetOperationConflict extends Error {
  constructor() {
    super("operationId is already reserved for different operation parameters.");
    this.name = "BudgetOperationConflict";
  }
}

/** Provider adapters identify failures that occurred before dispatch. */
export class BudgetDispatchError extends Error {
  readonly dispatched: boolean;

  constructor(message: string, dispatched: boolean) {
    super(message);
    this.name = "BudgetDispatchError";
    this.dispatched = dispatched;
  }
}

function checkReservationInput(input: ReservationInput): {
  operationId: string;
  userId: string;
  provider: string;
  unit: string;
  estimatedUnits: number;
  day: string;
} {
  const { operationId, userId, provider, unit, estimatedUnits } = input;
  if (
    typeof operationId !== "string" ||
    operationId.length < 1 ||
    operationId.length > 128
  ) {
    throw new Error(
      "operationId must be a non-empty string of at most 128 characters.",
    );
  }
  if (typeof userId !== "string" || userId.length < 1 || userId.length > 256) {
    throw new Error(
      "userId must be a non-empty string of at most 256 characters.",
    );
  }
  if (
    typeof provider !== "string" ||
    provider.length < 1 ||
    provider.length > 64
  ) {
    throw new Error(
      "provider must be a non-empty string of at most 64 characters.",
    );
  }
  if (typeof unit !== "string" || unit.length < 1 || unit.length > 64) {
    throw new Error(
      "unit must be a non-empty string of at most 64 characters.",
    );
  }
  if (!Number.isSafeInteger(estimatedUnits) || estimatedUnits < 0) {
    throw new Error("estimatedUnits must be a non-negative safe integer.");
  }
  return {
    operationId,
    userId,
    provider,
    unit,
    estimatedUnits,
    day: checkDay(input.day ?? today()),
  };
}

function checkActualValue(name: string, value: number | undefined): number {
  const amount = value ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return amount;
}

function toReservation(found: ReservationRow): Reservation {
  return {
    operationId: found.operation_id,
    userId: found.user_id,
    day: found.day,
    provider: found.provider,
    unit: found.unit,
    estimatedUnits: Number(found.estimated_units),
    status: found.status,
    actualUnits:
      found.actual_units === null ? null : Number(found.actual_units),
    failReason: found.fail_reason,
    createdAt: found.created_at,
    settledAt: found.settled_at,
  };
}

/** One RPC commits the reservation before any provider is dispatched. */
export async function reserve(input: ReservationInput): Promise<ReserveResult> {
  try {
    const clean = checkReservationInput(input);
    const stored = await reserveBudget(clean, caps());
    return stored.ok ? { ...stored, reservation: toReservation(stored.reservation) } : stored;
  } catch (err) {
    if (err instanceof DataApiError && err.code === 'EV001') throw new BudgetOperationConflict();
    if (err instanceof BudgetOperationConflict) throw err;
    log.error('budget', 'reservation failed; denying the provider call', { error: (err as Error).message });
    return { ok: false, reason: 'global_tokens' };
  }
}

async function terminal(operationId: string, status: 'settled' | 'refunded' | 'failed',
  actualUnits: number | null, failReason: string | null, inputTokens = 0, outputTokens = 0): Promise<SettleResult> {
  const stored = await transitionBudget(operationId, status, actualUnits, failReason, inputTokens, outputTokens);
  return stored.ok ? { ...stored, reservation: toReservation(stored.reservation) } : stored;
}

export interface SettleActuals {
  /**
   * Provider-REPORTED token usage. Recorded even above the estimate:
   * overrun is accounted, never silently dropped (see header note).
   */
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Actual quantity for non-token units (chars, tasks). Defaults to the
   * token total, which is 0 for non-token calls that pass no breakdown.
   */
  units?: number;
}

/**
 * Records what a reserved call actually cost, from the usage the provider
 * reported. Idempotent on the operation ID: the first call debits the
 * day's ledger once; every later call is a no-op returning the stored row.
 * The debit lands on the reservation's ORIGINAL day, even after midnight.
 */
export async function settleReservation(
  operationId: string,
  actual: SettleActuals = {},
): Promise<SettleResult> {
  const inputTokens = checkActualValue("inputTokens", actual.inputTokens);
  const outputTokens = checkActualValue("outputTokens", actual.outputTokens);
  const units = checkActualValue(
    "units",
    actual.units ?? inputTokens + outputTokens,
  );
  try {
    return await terminal(operationId, 'settled', units, null, inputTokens, outputTokens);
  } catch (err) {
    log.error("budget", "could not settle reservation", {
      error: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Releases a reservation that will never dispatch (consent withdrawn,
 * request superseded). Pending → refunded exactly once; the ledger is
 * untouched because nothing was spent. Settling afterwards is a no-op.
 */
export async function refundReservation(
  operationId: string,
): Promise<SettleResult> {
  return terminal(operationId, 'refunded', null, null);
}

/**
 * Settles a FAILED dispatch exactly once. Policy: a call that never ran
 * releases its estimate and records NOTHING in usage_ledger — failed calls
 * must not silently consume quota, and exactly-once keeps them from
 * consuming it twice either.
 */
export async function failReservation(
  operationId: string,
  reason: string = "dispatch_failed",
): Promise<SettleResult> {
  if (typeof reason !== "string" || reason.length < 1 || reason.length > 256) {
    throw new Error(
      "fail reason must be a non-empty string of at most 256 characters.",
    );
  }
  return terminal(operationId, 'failed', 0, reason);
}

/**
 * Reserve → run → settle-or-fail around one provider call.
 *
 * This is the shape every dispatch site must follow (P1-T08 wires the
 * callers): the transaction commits before `provider` runs, a success
 * settles with provider-reported actuals, and a known pre-dispatch failure
 * settles once as failed. An ambiguous provider or transport error remains
 * pending because the provider may have accepted the request; reconciliation
 * resolves that operation by its id.
 */
export async function withReservation<T>(
  input: ReservationInput,
  provider: (
    reservation: Reservation,
  ) => Promise<{ result: T; actual: SettleActuals }>,
): Promise<{ result: T; reservation: Reservation }> {
  const admitted = await reserve(input);
  if (!admitted.ok) {
    throw new Error(`over budget: ${admitted.reason}`);
  }
  try {
    const { result, actual } = await provider(admitted.reservation);
    const settled = await settleReservation(
      admitted.reservation.operationId,
      actual,
    );
    if (!settled.ok) {
      throw new Error("reservation vanished between dispatch and settle.");
    }
    return { result, reservation: settled.reservation };
  } catch (err) {
    if (err instanceof BudgetDispatchError && !err.dispatched) {
      await failReservation(input.operationId, err.message).catch((settleErr) => {
        log.error("budget", "failed dispatch could not settle as failed", {
          error: (settleErr as Error).message,
        });
      });
    }
    throw err;
  }
}

/** A pending row by operation ID: the crash-recovery handle. Survives process death. */
export async function getReservation(
  operationId: string,
): Promise<Reservation | undefined> {
  const found = await getBudgetReservation(operationId);
  return found ? toReservation(found) : undefined;
}

/** Pending reservations, optionally for one day: the reconciler's work list. */
export async function listPendingReservations(
  day?: string,
): Promise<Reservation[]> {
  const found = await pendingBudgetReservations(day === undefined ? undefined : checkDay(day));
  return found.map(toReservation);
}

/** Whether a model call may be made right now for this user. */
export async function allowance(
  userId: string,
  day?: string,
): Promise<BudgetVerdict> {
  const dayKey = checkDay(day ?? today());
  try {
    return await readBudgetAllowance(dayKey, userId, caps());
  } catch (err) {
    // A ledger that cannot be read must not become an open tab. Deny.
    log.error("budget", "ledger unreadable; denying the model call", {
      error: (err as Error).message,
    });
    return { ok: false, reason: "global_tokens" };
  }
}

/** Today so far, for the health report. Pending estimates count: dispatched but unconfirmed. */
export async function todaySummary(day?: string): Promise<{
  turns: number;
  tokens: number;
  limits: { userTurns: number; turns: number; tokens: number };
}> {
  const dayKey = checkDay(day ?? today());
  try {
    const usage = await readBudgetUsage(dayKey, '');
    return {
      turns: usage.globalLedgerTurns + usage.globalPendingTurns,
      tokens: usage.globalLedgerTokens + usage.globalPendingTokenEstimates,
      limits: {
        userTurns: limit("ELOHIM_USER_DAILY_TURNS", 80),
        turns: limit("ELOHIM_DAILY_TURNS", 2000),
        tokens: limit("ELOHIM_DAILY_TOKENS", 4_000_000),
      },
    };
  } catch {
    return {
      turns: 0,
      tokens: 0,
      limits: {
        userTurns: limit("ELOHIM_USER_DAILY_TURNS", 80),
        turns: limit("ELOHIM_DAILY_TURNS", 2000),
        tokens: limit("ELOHIM_DAILY_TOKENS", 4_000_000),
      },
    };
  }
}
