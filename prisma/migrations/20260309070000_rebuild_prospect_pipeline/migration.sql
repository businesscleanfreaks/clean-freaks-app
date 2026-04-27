ALTER TABLE "prospects"
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "nextActionType" TEXT,
ADD COLUMN     "nextActionNote" TEXT,
ADD COLUMN     "lastTouchedAt" TIMESTAMP(3),
ADD COLUMN     "proposalSentAt" TIMESTAMP(3),
ADD COLUMN     "walkthroughAt" TIMESTAMP(3),
ADD COLUMN     "convertedClientId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "priority" TEXT;

ALTER TABLE "prospect_activities"
ADD COLUMN     "channels" TEXT,
ADD COLUMN     "result" TEXT;

UPDATE "prospects"
SET "stage" = CASE
  WHEN "status" = 'WON' THEN 'WON'
  WHEN "status" = 'LOST' THEN 'LOST'
  WHEN "followUpDate" IS NOT NULL THEN 'FOLLOW_UP'
  ELSE 'NEW'
END;

UPDATE "prospects" p
SET "lastTouchedAt" = activity."createdAt"
FROM (
  SELECT "prospectId", MAX("createdAt") AS "createdAt"
  FROM "prospect_activities"
  GROUP BY "prospectId"
) activity
WHERE activity."prospectId" = p."id";

CREATE INDEX "prospects_stage_idx" ON "prospects"("stage");
CREATE INDEX "prospects_convertedClientId_idx" ON "prospects"("convertedClientId");

ALTER TABLE "prospects"
ADD CONSTRAINT "prospects_convertedClientId_fkey"
FOREIGN KEY ("convertedClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
