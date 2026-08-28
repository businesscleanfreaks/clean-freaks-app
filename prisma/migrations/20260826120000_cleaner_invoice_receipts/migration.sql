-- Cleaner invoicing, per Josh 2026-08-26.
--
-- Cleaners invoice us per ACCOUNT (a company with 7 accounts sends 7 invoices
-- at month end), except residential and one-off work which is invoiced per
-- CLEAN. Some teams never invoice at all. Each cleaner has their own pay-by
-- day of the month, defaulting to the 3rd.
--
-- All additive. Defaults are chosen so existing rows keep working: every
-- cleaner is assumed to invoice us, on the 3rd, per account.

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "invoicesUs" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "payByDay" INTEGER NOT NULL DEFAULT 3;

-- NULL means PER_ACCOUNT, so existing schedules need no backfill.
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "cleanerInvoiceUnit" TEXT;

CREATE TABLE IF NOT EXISTS "cleaner_invoice_receipts" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "jobId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cleaner_invoice_receipts_pkey" PRIMARY KEY ("id")
);

-- Postgres treats NULLs as distinct in a unique index, so the account-wide case
-- (jobId IS NULL) needs its own partial index or the same account-period could
-- be recorded twice. Two indexes, one for each shape.
CREATE UNIQUE INDEX IF NOT EXISTS "cleaner_invoice_receipts_per_clean_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period", "jobId")
    WHERE "jobId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cleaner_invoice_receipts_per_account_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period")
    WHERE "jobId" IS NULL;
CREATE INDEX IF NOT EXISTS "cleaner_invoice_receipts_subcontractorId_period_idx"
    ON "cleaner_invoice_receipts"("subcontractorId", "period");
CREATE INDEX IF NOT EXISTS "cleaner_invoice_receipts_locationId_period_idx"
    ON "cleaner_invoice_receipts"("locationId", "period");

ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_subcontractorId_fkey";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_locationId_fkey";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_jobId_fkey";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
