-- P1-T02: shared abuse-limit buckets.
--
-- The limiter used to count in a per-process Map, so every serverless
-- instance had its own quota. Counts are authoritative here, in Postgres,
-- and every instance shares them through a single-statement atomic upsert
-- (see server/lib/rate-limit.ts).
--
-- Identities are SHA-256 hex digests of "limiter-name:identity" — raw
-- emails and IP addresses are never stored in this table.
CREATE TABLE rate_limit_buckets (
  key_hash TEXT PRIMARY KEY,
  count    INTEGER NOT NULL CHECK (count >= 1),
  reset_at TIMESTAMPTZ NOT NULL
);
-- The opportunistic per-hit cleanup deletes through this index, bounded
-- (LIMIT 100 per hit), so expiry can never become an unbounded sweep.
CREATE INDEX idx_rate_limit_buckets_reset_at ON rate_limit_buckets (reset_at);
