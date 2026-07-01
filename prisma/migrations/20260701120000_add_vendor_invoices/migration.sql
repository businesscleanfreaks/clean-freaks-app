CREATE TABLE IF NOT EXISTS "vendor_invoices" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "claimedAmount" DOUBLE PRECISION NOT NULL,
  "computedOwed" DOUBLE PRECISION NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attachmentFileName" TEXT,
  "attachmentMimeType" TEXT,
  "attachmentSize" INTEGER,
  "attachmentData" BYTEA,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vendor_invoices_vendorId_idx" ON "vendor_invoices"("vendorId");
CREATE INDEX IF NOT EXISTS "vendor_invoices_vendorId_period_idx" ON "vendor_invoices"("vendorId", "period");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vendor_invoices_vendorId_fkey'
  ) THEN
    ALTER TABLE "vendor_invoices"
    ADD CONSTRAINT "vendor_invoices_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
