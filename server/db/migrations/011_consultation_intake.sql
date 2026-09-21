-- Optional self-reported consultation notes. Not a clinical record or diagnosis.
-- Owner comes from the authenticated session; account deletion removes the notes.
CREATE TABLE consultation_intakes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  answers_json TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
