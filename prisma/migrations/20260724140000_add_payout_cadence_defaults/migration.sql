ALTER TABLE "business_settings"
ADD COLUMN IF NOT EXISTS "residentialPayoutCadence" TEXT,
ADD COLUMN IF NOT EXISTS "commercialPayoutCadence" TEXT;
