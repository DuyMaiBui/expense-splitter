-- 0003_presets.sql: per-group expense presets ("mục mẫu"): a named unit price that the expense
-- form multiplies by a quantity (e.g. "Quả cầu lông" 29.000đ x 3). Purely an input aid: an
-- expense stores only its title and total, so deleting a preset never touches history.
--
-- Additive; no existing table or row changes.

-- datastore-class: aggregate
CREATE TABLE expense_presets (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  name       TEXT NOT NULL COLLATE NOCASE,
  unit_price INTEGER NOT NULL,     -- integer VND per unit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Backstop only: the API compares names Vietnamese-aware in JS (SQLite NOCASE folds ASCII).
  -- Doubles as the covering index for "list a group's presets by name".
  UNIQUE (group_id, name)
);
