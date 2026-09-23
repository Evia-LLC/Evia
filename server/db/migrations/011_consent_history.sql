-- Append-only record of consent decisions. The consents table remains the
-- current, quickly-readable state; this table records how that state changed.
CREATE TABLE consent_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  granted    INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_consent_history_user_time
  ON consent_history(user_id, recorded_at);

-- Existing accounts get an honest baseline rather than an invented sequence.
INSERT INTO consent_history (id, user_id, kind, granted, recorded_at)
SELECT 'consent-baseline-' || c.user_id || '-' || c.kind,
       c.user_id, c.kind, c.granted, COALESCE(c.granted_at, u.created_at)
FROM consents c JOIN users u ON u.id = c.user_id;
