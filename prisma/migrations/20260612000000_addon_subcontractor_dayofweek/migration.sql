-- Assign an in-house cleaner to an add-on (alternative to a vendor) + the day it's performed.
ALTER TABLE "add_on_services" ADD COLUMN IF NOT EXISTS "subcontractorId" TEXT;
ALTER TABLE "add_on_services" ADD COLUMN IF NOT EXISTS "dayOfWeek" INTEGER;

CREATE INDEX IF NOT EXISTS "add_on_services_subcontractorId_idx" ON "add_on_services"("subcontractorId");

DO $$ BEGIN
  ALTER TABLE "add_on_services"
    ADD CONSTRAINT "add_on_services_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
