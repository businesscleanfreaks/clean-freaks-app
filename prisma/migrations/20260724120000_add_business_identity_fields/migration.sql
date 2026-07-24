ALTER TABLE "business_settings"
ADD COLUMN IF NOT EXISTS "legalName" TEXT,
ADD COLUMN IF NOT EXISTS "paymentEmail" TEXT;
