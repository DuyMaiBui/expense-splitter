-- 0008_drop_member_bank.sql: CONTRACT step for the user-owned bank profile.
-- Apply this AFTER 0007 is applied AND the code that reads bank info from `users` is deployed.
-- Apply order: 0007 (before deploy) -> deploy the new code -> 0008 (after deploy).
--
-- Until this runs, the columns are dead weight: from 0007 on, NO code reads or writes
-- group_members.bank_* (lib/group-queries.ts derives Member.bank from the linked user), so
-- dropping them cannot break a running deployment.
ALTER TABLE group_members DROP COLUMN bank_bin;
ALTER TABLE group_members DROP COLUMN bank_account_no;
ALTER TABLE group_members DROP COLUMN bank_account_name;
