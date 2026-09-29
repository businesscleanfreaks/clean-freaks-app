-- FOLLOW-UP to migrations/20260929200000_subcontractor_files: drop the old
-- inline photo and W-9 columns from subcontractors.
--
-- Deliberately NOT in prisma/migrations. Vercel's build can run
-- `prisma migrate deploy` (scripts/vercel-migrate-deploy.ts), and this must
-- not run in the same deploy as the code change: the deployment still serving
-- while the new one builds reads these columns on every cleaner query.
--
-- Run it once the new code is live and a cleaner's photo and W-9 show on
-- their profile:
--   npx prisma db execute --file prisma/follow-ups/drop_subcontractor_file_columns.sql --schema prisma/schema.prisma
--
-- Look first. This lists files that are ONLY in the old columns:
--   SELECT s."id", s."name",
--          s."photoData" IS NOT NULL AND p."id" IS NULL AS "photoOnlyInOldColumn",
--          s."w9Data" IS NOT NULL AND w."id" IS NULL AS "w9OnlyInOldColumn"
--   FROM "subcontractors" s
--   LEFT JOIN "subcontractor_files" p ON p."subcontractorId" = s."id" AND p."kind" = 'photo'
--   LEFT JOIN "subcontractor_files" w ON w."subcontractorId" = s."id" AND w."kind" = 'w9'
--   WHERE (s."photoData" IS NOT NULL AND p."id" IS NULL)
--      OR (s."w9Data" IS NOT NULL AND w."id" IS NULL);
-- The only rows expected are cleaners whose photo or W-9 was REMOVED after the
-- switch (removing one deletes the new row and leaves the old column alone).
-- Anything else was uploaded to the old code after the copy ran: upload it
-- again on the profile. (Re-running the migration would copy it, but would
-- also bring back every file removed since the switch.)

-- Dropping the columns before the copy would lose every photo and W-9.
DO $$ BEGIN
  IF to_regclass('subcontractor_files') IS NULL THEN
    RAISE EXCEPTION 'subcontractor_files does not exist: apply migrations/20260929200000_subcontractor_files first';
  END IF;
END $$;

ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "photoData";
ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "photoMimeType";
ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "w9FileName";
ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "w9MimeType";
ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "w9Data";
ALTER TABLE "subcontractors" DROP COLUMN IF EXISTS "w9UploadedAt";
