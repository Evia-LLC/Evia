-- Empty-project baseline. Installed out of band; never executed at application boot.
SET search_path = public, pg_catalog;

-- Elohim initial schema. See ARCHITECTURE.md §2.
-- Everything user-owned cascades from users(id) so account deletion is a single
-- statement rather than a checklist somebody will eventually forget to update.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  date_of_birth TEXT
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE skin_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skin_type         TEXT NOT NULL DEFAULT 'unknown',
  fitzpatrick       INTEGER,
  concerns_json     TEXT NOT NULL DEFAULT '[]',
  sensitivities_json TEXT NOT NULL DEFAULT '[]',
  updated_at        TEXT NOT NULL,
  pregnancy_status  TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE preferences (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  explanation_style TEXT NOT NULL DEFAULT 'adaptive',
  voice_enabled     INTEGER NOT NULL DEFAULT 1,
  reduced_motion    INTEGER NOT NULL DEFAULT 0,
  quality_tier      TEXT NOT NULL DEFAULT 'auto',
  locale            TEXT NOT NULL DEFAULT 'en',
  voice_uri         TEXT,
  updated_at        TEXT NOT NULL
);

-- image_ref is the encrypted-blob filename, never a servable path.
CREATE TABLE skin_scans (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  captured_at          TEXT NOT NULL,
  image_ref            TEXT,
  thumb_ref            TEXT,
  metrics_json         TEXT NOT NULL,
  regions_json         TEXT NOT NULL DEFAULT '{}',
  capture_quality_json TEXT NOT NULL DEFAULT '{}',
  observations_json    TEXT NOT NULL DEFAULT '[]',
  confidence           DOUBLE PRECISION NOT NULL DEFAULT 0,
  model_version        TEXT NOT NULL,
  notes                TEXT
);
CREATE INDEX idx_scans_user_time ON skin_scans(user_id, captured_at DESC);

CREATE TABLE products (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  brand            TEXT,
  category         TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  source           TEXT NOT NULL DEFAULT 'user',
  created_at       TEXT NOT NULL,
  owner_id         TEXT REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_owner ON products(owner_id);

CREATE TABLE product_usage (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  frequency  TEXT,
  notes      TEXT
);
CREATE INDEX idx_usage_user ON product_usage(user_id, started_at DESC);

CREATE TABLE product_observations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  verdict    TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  title          TEXT
);
CREATE INDEX idx_conversations_user ON conversations(user_id, last_active_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  emotion         TEXT,
  intent          TEXT,
  directive_json  TEXT,
  demo            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Durable facts, distinct from the transcript. UNIQUE(user_id, kind, key) is what
-- makes a contradiction an update instead of a second conflicting belief.
CREATE TABLE memories (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  source_message_id TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (user_id, kind, key)
);
CREATE INDEX idx_memories_user ON memories(user_id, kind);

-- Body scans get their own table, and that separation is the point.
--
-- A body reading and a skin reading are produced by different pipelines,
-- against different model versions, on different scales. Nothing may ever
-- compare one to the other — a shoulder ratio and a hydration score share
-- nothing but the range they happen to be printed on. Two tables makes that
-- comparison impossible to write by accident; one table with a `kind` column
-- makes it a bug waiting to happen, and the bug would look like a trend.
--
-- `profile_json` is nullable on purpose: a front-only scan has no abdominal
-- reading at all, and the honest record of that is an absent column rather
-- than a zero that later reads as a measurement.
CREATE TABLE body_scans (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  captured_at           TEXT NOT NULL,
  -- Front frame, then the side view. Both gated behind image_storage consent,
  -- exactly like a skin capture.
  image_ref             TEXT,
  profile_image_ref     TEXT,
  metrics_json          TEXT NOT NULL,
  -- Whether the waist was traced from the body outline or estimated from joint
  -- positions. Stored because a trend may only compare like with like: the two
  -- differ by far more than any change a person could be trying to see.
  waist_source          TEXT NOT NULL DEFAULT 'joints',
  profile_json          TEXT,
  profile_detail_json   TEXT,
  landmarks_json        TEXT NOT NULL DEFAULT '[]',
  confidence            DOUBLE PRECISION NOT NULL DEFAULT 0,
  model_version         TEXT NOT NULL,
  profile_model_version TEXT
);
CREATE INDEX idx_body_scans_user_time ON body_scans(user_id, captured_at DESC);

-- Encrypted images, in the database rather than on disk.
--
-- The blob store used to be files under data/blobs. That works for a process
-- on a laptop and not at all for a function whose filesystem is rebuilt on
-- every cold start: a stored scan photo survived exactly until the next deploy
-- and then quietly 404ed, which made "keep it for comparisons" a promise the
-- app could not keep. Rows survive. The bytes are still AES-256-GCM under
-- ELOHIM_BLOB_KEY before they get here, so the database never holds a face in
-- the clear.
CREATE TABLE blobs (
  ref        TEXT PRIMARY KEY,
  data       BYTEA NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Model spend, per user per day.
--
-- Cloud reasoning is billed per token, and an app with a public entry screen
-- and no ledger is an open tab. One row per (day, user) is enough to answer
-- the two questions the budget asks: how many turns has this person had today,
-- and how much has everyone had today.
CREATE TABLE usage_ledger (
  day           TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  turns         INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX idx_usage_day ON usage_ledger(day);

-- Synthesised lines, kept.
--
-- Her voice is billed per character, and she says the same things often: the
-- greeting, the scan choreography, "hold still". Each line is synthesised once
-- per voice and model and then served from here, with the word timings that
-- drive her mouth stored alongside so a cached line lip-syncs exactly like a
-- fresh one. Keyed by a hash of (voice, model, text), so changing the voice
-- never serves the old one.
CREATE TABLE voice_lines (
  key          TEXT PRIMARY KEY,
  voice_id     TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  text         TEXT NOT NULL,
  audio        BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  words_json   TEXT NOT NULL,
  duration     DOUBLE PRECISION NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- The shelf: products she can actually point to.
--
-- Separate from `products`, which is the user's own routine (things they
-- typed in or scanned a label from). This is the operator's catalogue - the
-- shop behind the app - read from the storefront or imported, with prices and
-- links, so a recommendation can end in something to buy rather than in an
-- ingredient to go and look for.
CREATE TABLE catalogue_products (
  id               TEXT PRIMARY KEY,
  source           TEXT NOT NULL,            -- shopify | woocommerce | import | manual
  external_id      TEXT,
  sku              TEXT,
  name             TEXT NOT NULL,
  brand            TEXT,
  category         TEXT,
  description      TEXT NOT NULL DEFAULT '',
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  tags_json        TEXT NOT NULL DEFAULT '[]',
  price_cents      INTEGER,
  currency         TEXT NOT NULL DEFAULT 'USD',
  url              TEXT NOT NULL,
  image_url        TEXT,
  in_stock         INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_catalogue_name ON catalogue_products(name);

-- One row per sync, so "when did the shelf last change" has an answer.
CREATE TABLE catalogue_syncs (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  store_url   TEXT,
  imported    INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- Consent events remain immutable; there is no legacy-data backfill.
CREATE TABLE consent_events (
  id                 TEXT PRIMARY KEY,
  event_sequence     BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type       TEXT NOT NULL,
  wording_version_id TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('granted', 'withdrawn')),
  recorded_at        TEXT NOT NULL,
  actor_type         TEXT,
  actor_id           TEXT,
  metadata_json      JSONB,
  idempotency_key    TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_consent_events_current
  ON consent_events(user_id, consent_type, recorded_at DESC);


CREATE FUNCTION prevent_consent_event_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent events are immutable';
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = '';


CREATE TRIGGER consent_events_no_update
BEFORE UPDATE ON consent_events
FOR EACH ROW EXECUTE FUNCTION prevent_consent_event_update();

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

-- Progress photos are a separate, affirmative act, not a side effect of a scan.
-- Deliberately no landmark, embedding, face-geometry, or biometric columns.
CREATE TABLE progress_photos (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_scan_id       TEXT REFERENCES skin_scans(id) ON DELETE SET NULL,
  blob_ref           TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  captured_at        TEXT NOT NULL,
  consent_event_id   TEXT NOT NULL REFERENCES consent_events(id),
  presentation_json  TEXT,
  UNIQUE (user_id, skin_scan_id)
);
CREATE INDEX idx_progress_photos_user_time
  ON progress_photos(user_id, captured_at DESC);

-- MIGRATION BLOCKER: existing skin_scans.image_ref values are intentionally not
-- copied. The legacy image_storage wording did not describe a per-photo save,
-- so it cannot prove the consent required by this table. Retain those refs only
-- for deletion until product/legal defines a valid mapping or purge policy.

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
