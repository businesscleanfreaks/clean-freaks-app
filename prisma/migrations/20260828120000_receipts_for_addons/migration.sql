-- Vendor specialty work also arrives as add-on services, which are not Jobs and
-- so cannot carry a jobId receipt. The receipt's unit becomes: nothing (whole
-- account), a job, or an add-on.
--
-- Safe to restructure: the table still holds no rows.

ALTER TABLE "cleaner_invoice_receipts" ADD COLUMN IF NOT EXISTS "addOnServiceId" TEXT;

ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_addOnServiceId_fkey";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_addOnServiceId_fkey"
    FOREIGN KEY ("addOnServiceId") REFERENCES "add_on_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A receipt covers at most one item: a job, or an add-on, never both.
ALTER TABLE "cleaner_invoice_receipts"
    DROP CONSTRAINT IF EXISTS "cleaner_invoice_receipts_one_unit";
ALTER TABLE "cleaner_invoice_receipts" ADD CONSTRAINT "cleaner_invoice_receipts_one_unit"
    CHECK (NOT ("jobId" IS NOT NULL AND "addOnServiceId" IS NOT NULL));

-- Rebuild uniqueness: the account-wide case must now also exclude add-on rows,
-- or an add-on receipt would collide with it.
DROP INDEX IF EXISTS "cir_sub_per_account_key";
DROP INDEX IF EXISTS "cir_vendor_per_account_key";

CREATE UNIQUE INDEX IF NOT EXISTS "cir_sub_per_account_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period")
    WHERE "subcontractorId" IS NOT NULL AND "jobId" IS NULL AND "addOnServiceId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cir_vendor_per_account_key"
    ON "cleaner_invoice_receipts"("vendorId", "locationId", "period")
    WHERE "vendorId" IS NOT NULL AND "jobId" IS NULL AND "addOnServiceId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "cir_sub_per_addon_key"
    ON "cleaner_invoice_receipts"("subcontractorId", "locationId", "period", "addOnServiceId")
    WHERE "subcontractorId" IS NOT NULL AND "addOnServiceId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cir_vendor_per_addon_key"
    ON "cleaner_invoice_receipts"("vendorId", "locationId", "period", "addOnServiceId")
    WHERE "vendorId" IS NOT NULL AND "addOnServiceId" IS NOT NULL;
