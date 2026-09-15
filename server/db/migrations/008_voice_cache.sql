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
