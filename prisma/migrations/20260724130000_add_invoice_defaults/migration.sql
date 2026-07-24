ALTER TABLE "business_settings"
ADD COLUMN IF NOT EXISTS "residentialPaymentTerms" TEXT,
ADD COLUMN IF NOT EXISTS "commercialPaymentTerms" TEXT,
ADD COLUMN IF NOT EXISTS "invoiceFooterNote" TEXT;
