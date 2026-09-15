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
