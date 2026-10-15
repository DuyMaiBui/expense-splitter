-- 0002_indexes.sql: read-path and write-cost tuning. Additive and idempotent; no data changes.
--
-- D1 bills rows READ (scanned) and rows WRITTEN, and every secondary index adds one written
-- row per insert. So this migration (a) adds the two indexes the hot queries were missing and
-- (b) drops two indexes nothing reads.

-- Group list / membership: `WHERE m.user_id = ?` had no index whose FIRST column is user_id
-- (the unique index leads with group_id), so listing a user's groups scanned group_members.
CREATE INDEX IF NOT EXISTS idx_group_members_user_id
  ON group_members(user_id)
  WHERE user_id IS NOT NULL;

-- Expense list: `WHERE group_id = ? AND deleted_at IS NULL ORDER BY spent_at DESC,
-- created_at DESC, id DESC LIMIT n` is now answered straight from the index, in order, and
-- stops after n rows instead of reading and sorting every expense of the group.
CREATE INDEX IF NOT EXISTS idx_expenses_group_live
  ON expenses(group_id, deleted_at, spent_at DESC, created_at DESC, id DESC);

-- Redundant: idx_expenses_group_live has group_id as its leading column.
DROP INDEX IF EXISTS idx_expenses_group_id;

-- Unused: no query looks sessions up by user_id, yet every login paid a row for it.
DROP INDEX IF EXISTS idx_sessions_user_id;
