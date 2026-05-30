-- Cockpit structured Scope + Access. Additive only — no data loss.

ALTER TABLE "clients"
ADD COLUMN IF NOT EXISTS "scopeStructured" JSONB;

ALTER TABLE "locations"
ADD COLUMN IF NOT EXISTS "accessFields" JSONB;
