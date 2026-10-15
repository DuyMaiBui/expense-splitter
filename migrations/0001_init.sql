-- 0001_init.sql — initial schema for the expense splitter (Cloudflare D1 / SQLite)
-- All ids are TEXT (UUID v4), all timestamps are TEXT ISO 8601 UTC with ms.
-- Soft deletes: group_members.removed_at, expenses.deleted_at.
--
-- Datastore class per table (rules/managed-datastore-write-cost-discipline.md):
-- every table holds reduced entity state except activity_log, which is the product's
-- mandated append-only audit trail. D1 bills rows written + rows scanned, so each
-- read path below is index-backed and LIMIT-capped by the API layer.

-- datastore-class: aggregate
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- datastore-class: aggregate
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,      -- sha256 hex of the session token
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- datastore-class: aggregate
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- datastore-class: aggregate
CREATE TABLE group_members (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  user_id    TEXT REFERENCES users(id),   -- NULL for a friend without an account
  name       TEXT NOT NULL,
  removed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
-- A registered user can hold at most one member row per group.
CREATE UNIQUE INDEX idx_group_members_group_user
  ON group_members(group_id, user_id)
  WHERE user_id IS NOT NULL;

-- datastore-class: aggregate
CREATE TABLE expenses (
  id                 TEXT PRIMARY KEY,
  group_id           TEXT NOT NULL REFERENCES groups(id),
  title              TEXT NOT NULL,
  amount             INTEGER NOT NULL,
  paid_by_member_id  TEXT NOT NULL REFERENCES group_members(id),
  spent_at           TEXT NOT NULL,
  note               TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX idx_expenses_group_id ON expenses(group_id);

-- datastore-class: aggregate
CREATE TABLE expense_shares (
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  member_id  TEXT NOT NULL REFERENCES group_members(id),
  amount     INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

-- datastore-class: raw reason="append-only audit trail the product contract requires: one row per mutation, never updated or aggregated. Read path is index-backed on (group_id, id) and always LIMIT-capped (default 50, max 200) with a keyset cursor, so the scan bill stays bounded."
CREATE TABLE activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL REFERENCES groups(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_name    TEXT NOT NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  summary       TEXT NOT NULL,
  detail_json   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_activity_log_group_id ON activity_log(group_id, id);
