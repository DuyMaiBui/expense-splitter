-- 0010_share_adjust.sql: per-participant weight adjustment of a split (docs/CONTRACT.md § SPLIT RULE).
-- adjust_pct is the percentage a participant pays ON TOP of a normal share: 0 = normal (weight 1),
-- +10 = weight 1,1, -50 = weight 0,5. The amount column stays the money truth that settlement sums;
-- adjust_pct records the intent the amount was computed from, which the amount alone cannot give
-- back ("B, C +10%" and "D -9,09%" produce the same amounts). Existing rows are equal splits (0).
-- Apply BEFORE deploying the code that selects it.
ALTER TABLE expense_shares ADD COLUMN adjust_pct INTEGER NOT NULL DEFAULT 0;
