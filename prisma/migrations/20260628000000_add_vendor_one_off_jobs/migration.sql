-- Allow one-off jobs to be performed and paid through a vendor.
ALTER TABLE "jobs"
  ADD COLUMN "vendorId" TEXT,
  ADD COLUMN "vendorPaid" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "jobs_vendorId_idx" ON "jobs"("vendorId");

-- Vendor payments can now include either vendor add-ons or vendor-performed jobs.
ALTER TABLE "vendor_payment_line_items"
  ADD COLUMN "jobId" TEXT,
  ALTER COLUMN "addOnServiceId" DROP NOT NULL;

ALTER TABLE "vendor_payment_line_items"
  ADD CONSTRAINT "vendor_payment_line_items_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "vendor_payment_line_items_jobId_idx" ON "vendor_payment_line_items"("jobId");
CREATE UNIQUE INDEX "vendor_payment_line_items_paymentId_jobId_key"
  ON "vendor_payment_line_items"("paymentId", "jobId");

ALTER TABLE "vendor_payment_line_items"
  ADD CONSTRAINT "vendor_payment_line_items_one_source_check"
  CHECK (("addOnServiceId" IS NOT NULL) <> ("jobId" IS NOT NULL));
