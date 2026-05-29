-- Vendor rebuild: multi-contact, Zelle, and services fields.
-- Additive only — no data loss. Existing phone/email columns are preserved.

ALTER TABLE "vendors"
ADD COLUMN IF NOT EXISTS "zelle" TEXT;

ALTER TABLE "vendors"
ADD COLUMN IF NOT EXISTS "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "vendors"
ADD COLUMN IF NOT EXISTS "contacts" JSONB;
