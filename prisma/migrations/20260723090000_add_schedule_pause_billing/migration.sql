ALTER TABLE "schedules"
  ADD COLUMN IF NOT EXISTS "pauseFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pauseTo" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pauseName" TEXT,
  ADD COLUMN IF NOT EXISTS "pauseBilling" TEXT,
  ADD COLUMN IF NOT EXISTS "pauseCreditMode" TEXT,
  ADD COLUMN IF NOT EXISTS "pauseCreditAmount" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "schedules_pauseFrom_pauseTo_idx"
  ON "schedules"("pauseFrom", "pauseTo");
