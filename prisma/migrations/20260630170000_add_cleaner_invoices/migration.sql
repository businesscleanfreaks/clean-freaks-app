-- Cleaner-submitted invoices, reconciled against what we compute we owe.
CREATE TABLE IF NOT EXISTS "cleaner_invoices" (
  "id" TEXT NOT NULL,
  "subcontractorId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "claimedAmount" DOUBLE PRECISION NOT NULL,
  "computedOwed" DOUBLE PRECISION NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cleaner_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cleaner_invoices_subcontractorId_idx" ON "cleaner_invoices"("subcontractorId");
CREATE INDEX IF NOT EXISTS "cleaner_invoices_subcontractorId_period_idx" ON "cleaner_invoices"("subcontractorId", "period");

DO $$ BEGIN
  ALTER TABLE "cleaner_invoices"
    ADD CONSTRAINT "cleaner_invoices_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
