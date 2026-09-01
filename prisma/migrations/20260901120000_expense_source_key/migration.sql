-- Expenses: a stable key identifying the spreadsheet row an expense came from.
--
-- WHY: `expenses` has only a random uuid for a primary key and no unique
-- constraint on anything. Importing the same sheet twice therefore inserts
-- every row twice, with nothing in the schema able to notice. This column is
-- what makes an import re-runnable.
--
-- The key is derived from the row's CONTENT (date, amount, description,
-- vendor) plus an occurrence number, not from its position in the sheet:
-- row numbers shift the moment a line is inserted above, while the content of
-- a past expense does not change. The occurrence number keeps genuine
-- same-day, same-amount repeats as separate expenses instead of collapsing
-- them into one.
--
-- NULLABLE ON PURPOSE: expenses added by hand in the app have no source row,
-- and Postgres treats NULLs as distinct, so any number of them coexist under
-- a unique index. Only imported rows are constrained.

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;

-- Which import produced the row, so one sheet can be re-imported or backed
-- out without touching expenses that came from somewhere else.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "sourceName" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "expenses_sourceKey_key"
    ON "expenses" ("sourceKey");
