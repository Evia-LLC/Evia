-- Progress photos are a separate, affirmative act, not a side effect of a scan.
-- Deliberately no landmark, embedding, face-geometry, or biometric columns.
CREATE TABLE consent_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  wording_version TEXT NOT NULL,
  granted         INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_consent_events_active
  ON consent_events(user_id, kind, created_at DESC);

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

