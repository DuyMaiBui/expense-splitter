-- 0005_abuse_and_group_admin.sql: account bans, IP bans, spam signals, soft-deleted groups.
-- Apply AFTER 0004 and BEFORE deploying the code that selects these columns.

-- Account ban. A banned user keeps their data; sessions are deleted and login is refused.
ALTER TABLE users ADD COLUMN banned_at TEXT;
ALTER TABLE users ADD COLUMN ban_reason TEXT;

-- The address a registration came from, only to cap sign-ups per address per day.
ALTER TABLE users ADD COLUMN created_ip TEXT;
CREATE INDEX IF NOT EXISTS idx_users_created_ip ON users(created_ip, created_at) WHERE created_ip IS NOT NULL;

-- Soft delete: a deleted group disappears for members, the admin can restore it.
ALTER TABLE groups ADD COLUMN deleted_at TEXT;

-- datastore-class: aggregate
CREATE TABLE ip_bans (
  ip         TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('admin', 'auto')),
  created_by TEXT REFERENCES users(id),     -- NULL for an automatic ban
  created_at TEXT NOT NULL,
  expires_at TEXT                           -- NULL = until an admin lifts it
);

-- datastore-class: raw reason="append-only abuse signal: one row per rate-limit violation, written only when a limit is exceeded, de-duplicated to at most one row per account per 10 minutes per isolate, and pruned after 7 days. Read paths are index-backed ((ip, created_at), (user_id, created_at), (created_at)) and LIMIT-capped."
CREATE TABLE abuse_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id),
  kind       TEXT NOT NULL,                 -- 'write-rate'
  created_at TEXT NOT NULL
);
CREATE INDEX idx_abuse_events_ip ON abuse_events(ip, created_at);
CREATE INDEX idx_abuse_events_user ON abuse_events(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX idx_abuse_events_created ON abuse_events(created_at);
