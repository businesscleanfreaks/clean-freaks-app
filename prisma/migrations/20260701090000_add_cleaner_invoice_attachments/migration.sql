ALTER TABLE "cleaner_invoices"
  ADD COLUMN IF NOT EXISTS "attachmentFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "attachmentData" BYTEA;
