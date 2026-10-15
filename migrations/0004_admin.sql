-- 0004_admin.sql: a dedicated admin account that can re-issue other users' passwords.
--
-- role: 'user' (everyone who registers) or 'admin'. Only the out-of-band script
-- scripts/create-admin.mjs can produce an admin row; registration always inserts 'user'.
-- Backward compatible: old code never reads the column, so apply this BEFORE deploying the
-- code that selects it.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));

-- The admin user list reads the newest accounts first and stops at its LIMIT, so it walks
-- this index instead of scanning and sorting the whole users table.
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC, id DESC);

-- datastore-class: raw reason="append-only audit trail of privileged admin actions (password re-issue): one row per action, never updated or aggregated, no read path on a hot route. Written only by an admin, a handful of rows per month."
CREATE TABLE admin_audit (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id  TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  action         TEXT NOT NULL,            -- 'password.reset'
  created_at     TEXT NOT NULL
);
