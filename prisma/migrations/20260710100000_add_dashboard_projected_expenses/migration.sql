ALTER TABLE "business_settings"
ADD COLUMN IF NOT EXISTS "projectedExpenses" JSONB;
