-- A cleaner's photo and W-9 move off the subcontractors row into a table of
-- their own.
--
-- Cleaners are read whole all over the app (`include: { subcontractor: true }`,
-- findMany without a select), so every one of those reads loaded the photo
-- (up to 5MB) and the W-9 along with the name. In their own table the bytes
-- only load when app/api/cleaners/[id]/files serves them.
--
-- Additive: a new table, and the files already uploaded are COPIED into it.
-- The old columns stay, untouched, so the code still running while this is
-- applied keeps working. prisma/follow-ups/drop_subcontractor_file_columns.sql
-- drops them once the new code is live.
--
-- Safe to run again: nothing is created twice, and a cleaner who already has a
-- row of a kind keeps it (an old column never overwrites a newer upload).
-- Apply to live BEFORE the code that reads the table reaches main, with
--   npx prisma db execute --file prisma/migrations/20260929200000_subcontractor_files/migration.sql --schema prisma/schema.prisma

-- CreateTable
CREATE TABLE IF NOT EXISTS "subcontractor_files" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractor_files_subcontractorId_kind_key"
    ON "subcontractor_files"("subcontractorId", "kind");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "subcontractor_files"
    ADD CONSTRAINT "subcontractor_files_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Copy the files already uploaded. Skipped when the old columns are gone (the
-- follow-up has run), so running this again later is harmless.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subcontractors' AND column_name = 'photoData'
  ) THEN
    -- No upload time was kept for photos; the copy's own time versions the URL.
    INSERT INTO "subcontractor_files" ("id", "subcontractorId", "kind", "data", "mimeType", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, "id", 'photo', "photoData", "photoMimeType", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "subcontractors"
    WHERE "photoData" IS NOT NULL AND "photoMimeType" IS NOT NULL
    ON CONFLICT ("subcontractorId", "kind") DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subcontractors' AND column_name = 'w9Data'
  ) THEN
    -- The W-9 keeps its upload date: the profile shows "Uploaded <date>" from it.
    INSERT INTO "subcontractor_files" ("id", "subcontractorId", "kind", "data", "mimeType", "fileName", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, "id", 'w9', "w9Data", "w9MimeType", "w9FileName",
           COALESCE("w9UploadedAt", CURRENT_TIMESTAMP), COALESCE("w9UploadedAt", CURRENT_TIMESTAMP)
    FROM "subcontractors"
    WHERE "w9Data" IS NOT NULL AND "w9MimeType" IS NOT NULL
    ON CONFLICT ("subcontractorId", "kind") DO NOTHING;
  END IF;
END $$;
