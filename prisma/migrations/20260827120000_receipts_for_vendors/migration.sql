-- Vendors invoice us the same way cleaners do, and the design puts them in the
-- same table, so the receipt has to accept either payee.
--
-- Safe to restructure: the table was added yesterday and holds no rows.

ALTER TABLE "cleaner_invoice_receipts" ALTER COLUMN "subcontractorId" DROP NOT NULL;
ALTER TABLE "cleaner_invoice_receipts" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;

ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_vendorId_fkey";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one payee. Prisma cannot express this, so it lives here.
ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_one_payee";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_one_payee"
    CHECK (("subcontractorId" IS NOT NULL) <> ("vendorId" IS NOT NULL));

-- Uniqueness, one partial index per (payee kind x shape). Postgres treats NULLs
-- as distinct, so the account-wide cases each need their own.
DROP INDEX IF EXISTS "cleaner_invoice_receipts_per_clean_key";
DROP INDEX IF EXISTS "cleaner_invoice_receipts_per_account_key";

CREATE UNIQUE INDEX IF NOT EXISTS "cir_sub_per_clean_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period", "jobId")
    WHERE "subcontractorId" IS NOT NULL AND "jobId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cir_sub_per_account_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period")
    WHERE "subcontractorId" IS NOT NULL AND "jobId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cir_vendor_per_clean_key"
    ON "cleaner_invoice_receipts"("vendorId", "locationId", "period", "jobId")
    WHERE "vendorId" IS NOT NULL AND "jobId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cir_vendor_per_account_key"
    ON "cleaner_invoice_receipts"("vendorId", "locationId", "period")
    WHERE "vendorId" IS NOT NULL AND "jobId" IS NULL;

CREATE INDEX IF NOT EXISTS "cleaner_invoice_receipts_vendorId_period_idx"
    ON "cleaner_invoice_receipts"("vendorId", "period");
