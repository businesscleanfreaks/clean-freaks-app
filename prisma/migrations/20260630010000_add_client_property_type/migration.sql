ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "propertyType" TEXT;

CREATE INDEX IF NOT EXISTS "clients_propertyType_idx"
  ON "clients"("propertyType");
