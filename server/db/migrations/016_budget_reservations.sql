-- P1-T07: atomic provider budget reservations.
--
-- The old budget was check-then-record: `allowance()` read two sums and a
-- later `record()` wrote one row, with nothing in between stopping two
-- instances from admitting the same last allowance. Reservations close that
-- gap. Every billable dispatch first inserts a pending row in one SHORT
-- transaction (see server/ai/budget.ts for the lock order), calls the
-- provider only after that transaction commits, and then settles or refunds
-- exactly once against the reservation's operation ID.
--
-- Crash policy lives here as structure, not as a sweeper: a pending row
-- survives process death (there is deliberately NO background job that
-- forgives pending rows — a dispatched call may already have been billed).
-- Pending rows are reconcilable by operation_id and leave the pending state
-- only through settle, refund, or an explicitly known pre-dispatch failure.
--
-- Additive only: usage_ledger is untouched. Pending usage is derived from
-- this table (day + status), so settled and pending can never diverge into
-- two counters that disagree.
CREATE TABLE budget_reservations (
  operation_id    TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  -- Calendar day (YYYY-MM-DD) the reservation counts against. Bound at
  -- reserve time from an injectable day parameter, so a settle that lands
  -- after midnight still debits the day that admitted it.
  day             TEXT NOT NULL,
  provider        TEXT NOT NULL,
  -- e.g. chat-tokens, tts-chars, vision-tasks.
  unit            TEXT NOT NULL,
  -- Admission estimate in the unit's natural quantity (tokens, chars,
  -- tasks). An estimate, not a spend cap: see the overrun note in
  -- server/ai/budget.ts.
  estimated_units BIGINT NOT NULL CHECK (estimated_units >= 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'settled', 'refunded', 'failed')),
  -- Provider-reported actuals, written once at settle time. May exceed the
  -- estimate; overrun is accounted, never silently dropped.
  actual_units    BIGINT CHECK (actual_units IS NULL OR actual_units >= 0),
  fail_reason     TEXT,
  created_at      TEXT NOT NULL,
  settled_at      TEXT
);
-- Reserve-time scans filter on (day, status); recovery lists by user + day.
CREATE INDEX idx_budget_reservations_day_status ON budget_reservations (day, status);
CREATE INDEX idx_budget_reservations_user_day ON budget_reservations (user_id, day);
