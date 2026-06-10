-- Per-cleaner fast-pay flag (residential — pay within 72h).
-- Additive + idempotent so it is safe to run against the live (db push-managed) database.

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "fastPay" BOOLEAN NOT NULL DEFAULT false;
