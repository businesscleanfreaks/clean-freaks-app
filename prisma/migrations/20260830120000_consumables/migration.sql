-- Consumables: supplies billed to a client and optionally paid back to the
-- cleaner who bought them. Josh's design, 2026-08-29.
--
-- One record carries both sides. `kind` says which surface owns it:
--   RECURRING  — flat line on every unsent invoice for one client
--   ADHOC      — bought on one visit
--   ALLOWANCE  — a cleaner's standalone monthly slice
--
-- Additive: a new table only, nothing existing is touched.

CREATE TABLE IF NOT EXISTS "consumables" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT,
    "jobId" TEXT,
    "subcontractorId" TEXT,
    "description" TEXT,
    "billAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paybackAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consumables_pkey" PRIMARY KEY ("id")
);

-- Only the three kinds exist.
ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_kind_check";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_kind_check"
    CHECK ("kind" IN ('RECURRING', 'ADHOC', 'ALLOWANCE'));

-- Each kind needs its own anchor, or a row means nothing.
ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_shape_check";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_shape_check" CHECK (
    ("kind" = 'RECURRING' AND "clientId" IS NOT NULL AND "jobId" IS NULL)
 OR ("kind" = 'ADHOC'     AND "jobId"    IS NOT NULL)
 OR ("kind" = 'ALLOWANCE' AND "subcontractorId" IS NOT NULL AND "clientId" IS NULL AND "jobId" IS NULL)
);

-- Money only goes one way on each side.
ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_amounts_check";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_amounts_check"
    CHECK ("billAmount" >= 0 AND "paybackAmount" >= 0);

-- A client has at most one live recurring charge; a cleaner at most one
-- standalone allowance. Partial, so stopped records can pile up as history.
CREATE UNIQUE INDEX IF NOT EXISTS "consumables_one_recurring_per_client"
    ON "consumables"("clientId") WHERE "kind" = 'RECURRING' AND "isActive";
CREATE UNIQUE INDEX IF NOT EXISTS "consumables_one_allowance_per_cleaner"
    ON "consumables"("subcontractorId") WHERE "kind" = 'ALLOWANCE' AND "isActive";

CREATE INDEX IF NOT EXISTS "consumables_clientId_isActive_idx" ON "consumables"("clientId", "isActive");
CREATE INDEX IF NOT EXISTS "consumables_subcontractorId_isActive_idx" ON "consumables"("subcontractorId", "isActive");
CREATE INDEX IF NOT EXISTS "consumables_jobId_idx" ON "consumables"("jobId");
CREATE INDEX IF NOT EXISTS "consumables_kind_date_idx" ON "consumables"("kind", "date");

ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_clientId_fkey";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_jobId_fkey";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consumables" DROP CONSTRAINT IF EXISTS "consumables_subcontractorId_fkey";
ALTER TABLE "consumables" ADD CONSTRAINT "consumables_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
