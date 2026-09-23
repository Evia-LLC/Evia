-- Decisions are facts, not mutable settings. The legacy table remains during
-- the caller migration window and can be removed by a later migration.
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

-- Preserve every legacy row as the closest expressible historical state. Use
-- the original grant time when it exists; otherwise identify the migration-time
-- timestamp explicitly rather than pretending the original choice time is known.
INSERT INTO consent_events
  (id, user_id, consent_type, wording_version_id, state, recorded_at,
   actor_type, metadata_json, idempotency_key)
SELECT
  'legacy-' || md5(user_id || ':' || kind), user_id, kind, 'legacy-v1',
  CASE WHEN granted = 1 THEN 'granted' ELSE 'withdrawn' END,
  COALESCE(granted_at, CURRENT_TIMESTAMP::TEXT), 'migration',
  CASE WHEN granted_at IS NULL
    THEN '{"source":"legacy_consents","recordedAtSource":"migration_time"}'
    ELSE '{"source":"legacy_consents","recordedAtSource":"granted_at"}' END::JSONB,
  'legacy-v1:' || kind
FROM consents;

CREATE FUNCTION prevent_consent_event_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consent_events_no_update
BEFORE UPDATE ON consent_events
FOR EACH ROW EXECUTE FUNCTION prevent_consent_event_update();
