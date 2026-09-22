-- Evia initial schema. See ARCHITECTURE.md §2.
-- Everything user-owned cascades from users(id) so account deletion is a single
-- statement rather than a checklist somebody will eventually forget to update.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
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
  updated_at        TEXT NOT NULL
);

CREATE TABLE preferences (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  explanation_style TEXT NOT NULL DEFAULT 'adaptive',
  voice_enabled     INTEGER NOT NULL DEFAULT 0,
  reduced_motion    INTEGER NOT NULL DEFAULT 0,
  quality_tier      TEXT NOT NULL DEFAULT 'auto',
  locale            TEXT NOT NULL DEFAULT 'en',
  updated_at        TEXT NOT NULL
);

CREATE TABLE consents (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  PRIMARY KEY (user_id, kind)
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
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_products_name ON products(name);

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
