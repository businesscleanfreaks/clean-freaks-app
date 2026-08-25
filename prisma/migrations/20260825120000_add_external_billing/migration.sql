-- Record that an invoice was billed by hand outside the app (QuickBooks, an
-- emailed PDF). Keeps the invoice as the record of what was billed while
-- taking it out of the send queue, so it can be looked up rather than deleted.
--
-- Additive and nullable: no existing row changes, no backfill, no lock beyond
-- the catalogue update.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "externallyBilledAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "externallyBilledNote" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_externallyBilledAt_idx" ON "invoices"("externallyBilledAt");
