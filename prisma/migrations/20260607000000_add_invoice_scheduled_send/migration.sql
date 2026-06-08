-- "Send later": schedule an invoice email to auto-send at a future time.
-- Additive + idempotent so it is safe to run against the live (db push-managed) database.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "scheduledSendAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "scheduledPayload" JSONB;

CREATE INDEX IF NOT EXISTS "invoices_scheduledSendAt_idx" ON "invoices"("scheduledSendAt");
