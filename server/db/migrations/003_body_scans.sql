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
