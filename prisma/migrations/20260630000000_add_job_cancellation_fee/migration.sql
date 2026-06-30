-- Cancellation fees ride the client's regular invoice as line items.
-- Additive + idempotent so it is safe to run against the live database.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "cancellationFee" DOUBLE PRECISION;
