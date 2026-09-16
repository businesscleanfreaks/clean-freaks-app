-- Cleaner payments: record what each payment actually settles.
--
-- WHY: cleaner pay was a boolean on each job plus one line item on one
-- arbitrary job, and what a payment covered was re-derived by inference. Three
-- defects came from that single gap:
--
--   * A flat monthly rate was added once PER REQUEST rather than once per
--     month, so paying two cleans from the same month in two selections
--     recorded the full monthly amount twice.
--   * Two simultaneous requests both read the jobs as unpaid and both wrote a
--     payment, because nothing claimed the obligation.
--   * Undo was asymmetric: a flat-rate payment wrote one line item on the first
--     job while marking every selected job paid, so undoing through any other
--     job unmarked the job but left the payment claiming to cover it.
--
-- The UNIQUE on obligationKey is the fix for the first two: the database
-- refuses a second settlement of the same schedule-month or the same clean,
-- whatever order the requests arrive in.

CREATE TABLE IF NOT EXISTS "subcontractor_payment_coverage" (
    "id"            TEXT NOT NULL,
    "paymentId"     TEXT NOT NULL,
    "obligationKey" TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "amount"        DOUBLE PRECISION NOT NULL,
    "period"        TEXT NOT NULL,
    "scheduleId"    TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subcontractor_payment_coverage_pkey" PRIMARY KEY ("id")
);

-- An obligation is settled once. This is the guard, not the application code.
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractor_payment_coverage_obligationKey_key"
    ON "subcontractor_payment_coverage" ("obligationKey");

CREATE INDEX IF NOT EXISTS "subcontractor_payment_coverage_paymentId_idx"
    ON "subcontractor_payment_coverage" ("paymentId");
CREATE INDEX IF NOT EXISTS "subcontractor_payment_coverage_period_idx"
    ON "subcontractor_payment_coverage" ("period");

-- Deleting a payment releases its obligations to be paid again.
ALTER TABLE "subcontractor_payment_coverage"
    DROP CONSTRAINT IF EXISTS "subcontractor_payment_coverage_paymentId_fkey";
ALTER TABLE "subcontractor_payment_coverage"
    ADD CONSTRAINT "subcontractor_payment_coverage_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "subcontractor_payments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
