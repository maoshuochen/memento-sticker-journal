CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  used_by_user_id TEXT UNIQUE,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user_expiry ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS sync_entities (
  user_id TEXT NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  payload TEXT NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_changes_by_user_cursor ON sync_changes(user_id, cursor);
CREATE INDEX IF NOT EXISTS sync_changes_by_changed_at ON sync_changes(changed_at);

CREATE TABLE IF NOT EXISTS user_usage (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  asset_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
