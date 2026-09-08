-- Asset metadata is kept in D1 so quota reservations can be made atomically
-- before an R2 write. The R2 object remains the source of truth for bytes;
-- asset_records is a recovery index updated after a successful operation.
CREATE TABLE IF NOT EXISTS asset_records (
  user_id TEXT NOT NULL REFERENCES users(id),
  asset_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  etag TEXT,
  content_hash TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE IF NOT EXISTS asset_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  asset_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('put', 'delete')),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'unknown', 'committed', 'failed')),
  old_bytes INTEGER NOT NULL CHECK (old_bytes >= 0),
  new_bytes INTEGER NOT NULL CHECK (new_bytes >= 0),
  delta_bytes INTEGER NOT NULL,
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  old_etag TEXT,
  content_hash TEXT,
  mime_type TEXT,
  quota_released INTEGER NOT NULL DEFAULT 0 CHECK (quota_released IN (0, 1)),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active_key TEXT
);

-- An active operation serializes replacement and deletion of one asset. A
-- nullable key lets completed/failed history remain for audit and retry
-- diagnostics without blocking a later operation.
CREATE UNIQUE INDEX IF NOT EXISTS asset_operations_active_asset
  ON asset_operations (user_id, asset_id, active_key)
  WHERE active_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_operations_by_state
  ON asset_operations (user_id, state, updated_at);
CREATE INDEX IF NOT EXISTS asset_records_by_user
  ON asset_records (user_id, updated_at);
