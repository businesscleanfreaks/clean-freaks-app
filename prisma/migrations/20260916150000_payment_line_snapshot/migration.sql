-- Payment line items keep their own record of what was paid for.
--
-- WHY: both payment line item tables cascaded from the job. Deleting a clean
-- deleted the record of what a payment bought while the payment kept the money.
-- It has already happened: one cleaner payment in production is $1,200 with no
-- line items at all, against seventeen cleans still marked paid.
--
-- The invoice line item never had this problem, because it carries its own
-- description and date · losing the job link costs it nothing. These tables now
-- do the same, and the job link becomes SET NULL instead of CASCADE. A deleted
-- clean leaves the payment intact and still readable.

ALTER TABLE "subcontractor_payment_line_items"
    ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "serviceDate" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "scheduleId"  TEXT;

ALTER TABLE "vendor_payment_line_items"
    ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "serviceDate" TIMESTAMP(3);

-- Backfill from the jobs that are still there, so existing payments become
-- readable rather than only future ones.
UPDATE "subcontractor_payment_line_items" li
SET "description" = c."name" || ' · ' || to_char(j."date", 'Mon DD, YYYY'),
    "serviceDate" = j."date",
    "scheduleId"  = j."scheduleId"
FROM "jobs" j
JOIN "locations" l ON l."id" = j."locationId"
JOIN "clients"   c ON c."id" = l."clientId"
WHERE li."jobId" = j."id" AND li."description" = '';

UPDATE "vendor_payment_line_items" li
SET "description" = c."name" || ' · ' || to_char(j."date", 'Mon DD, YYYY'),
    "serviceDate" = j."date"
FROM "jobs" j
JOIN "locations" l ON l."id" = j."locationId"
JOIN "clients"   c ON c."id" = l."clientId"
WHERE li."jobId" = j."id" AND li."description" = '';

UPDATE "vendor_payment_line_items" li
SET "description" = a."description",
    "serviceDate" = COALESCE(a."createdAt", li."serviceDate")
FROM "add_on_services" a
WHERE li."addOnServiceId" = a."id" AND li."description" = '';

-- The clean may be gone; the money record may not.
ALTER TABLE "subcontractor_payment_line_items" ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "subcontractor_payment_line_items"
    DROP CONSTRAINT IF EXISTS "subcontractor_payment_line_items_jobId_fkey";
ALTER TABLE "subcontractor_payment_line_items"
    ADD CONSTRAINT "subcontractor_payment_line_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_payment_line_items"
    DROP CONSTRAINT IF EXISTS "vendor_payment_line_items_jobId_fkey";
ALTER TABLE "vendor_payment_line_items"
    ADD CONSTRAINT "vendor_payment_line_items_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_payment_line_items"
    DROP CONSTRAINT IF EXISTS "vendor_payment_line_items_addOnServiceId_fkey";
ALTER TABLE "vendor_payment_line_items"
    ADD CONSTRAINT "vendor_payment_line_items_addOnServiceId_fkey"
    FOREIGN KEY ("addOnServiceId") REFERENCES "add_on_services"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
