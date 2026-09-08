-- Schedules: remember the first clean of the original series.
--
-- WHY: for BI_WEEKLY and other every-N-weeks cadences, which weeks are "on" was
-- computed by counting from the schedule's own startDate. A "change going
-- forward" splits the schedule and gives the new half a start date that is
-- usually NOT one of the client's clean days, so the count restarted there and
-- shifted every future clean by a week. Verified: a bi-weekly Wednesday series
-- running 09-02, 09-16, 09-30 became 09-23, 10-07, 10-21 when split with an
-- effective date of Thursday 09-10.
--
-- NULLABLE ON PURPOSE: null means "count from startDate", which is exactly the
-- old behaviour, so existing schedules are unaffected until an anchor is set.

ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "cadenceAnchor" TIMESTAMP(3);

-- Backfill: for existing schedules the original series began at startDate, so
-- that IS the anchor. Doing this now means a later split keeps their rhythm.
UPDATE "schedules" SET "cadenceAnchor" = "startDate" WHERE "cadenceAnchor" IS NULL;
