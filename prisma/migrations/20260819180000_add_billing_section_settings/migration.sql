-- Billing schedule sheet: one-time job defaults, invoice footer templates and
-- reminder templates. Nullable JSON; readers fall back to the shipped defaults.
ALTER TABLE "business_settings" ADD COLUMN IF NOT EXISTS "oneTimeJobDefaults" JSONB;
ALTER TABLE "business_settings" ADD COLUMN IF NOT EXISTS "invoiceFooterTemplates" JSONB;
ALTER TABLE "business_settings" ADD COLUMN IF NOT EXISTS "reminderTemplates" JSONB;
