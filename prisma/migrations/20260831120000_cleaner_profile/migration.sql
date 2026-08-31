-- Cleaner profile: contacts, W-9 / tax details, photo and notes.
--
-- PRIVACY: only the LAST FOUR digits of a tax ID are stored. Issuing a 1099
-- from this app does not need the full number, and holding it would make this
-- table worth stealing for no operational benefit.
--
-- Additive: one new table plus nullable columns.

CREATE TABLE IF NOT EXISTS "cleaner_contacts" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cleaner_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cleaner_contacts_subcontractorId_sortOrder_idx"
    ON "cleaner_contacts"("subcontractorId", "sortOrder");

ALTER TABLE "cleaner_contacts" DROP CONSTRAINT IF EXISTS "cleaner_contacts_subcontractorId_fkey";
ALTER TABLE "cleaner_contacts" ADD CONSTRAINT "cleaner_contacts_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "photoData" BYTEA;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "photoMimeType" TEXT;

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "w9OnFile" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "w9FileName" TEXT;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "w9MimeType" TEXT;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "w9Data" BYTEA;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "w9UploadedAt" TIMESTAMP(3);

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "taxIdType" TEXT;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "taxIdLast4" TEXT;
ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "profileNotes" TEXT;

-- Only ever four digits, and only SSN or EIN.
ALTER TABLE "subcontractors" DROP CONSTRAINT IF EXISTS "subcontractors_taxid_check";
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_taxid_check"
    CHECK (("taxIdLast4" IS NULL OR "taxIdLast4" ~ '^[0-9]{4}$')
       AND ("taxIdType" IS NULL OR "taxIdType" IN ('SSN', 'EIN')));
