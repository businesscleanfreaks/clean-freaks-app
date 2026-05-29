-- Client Cockpit Scope tab. Additive only — no data loss.

ALTER TABLE "clients"
ADD COLUMN IF NOT EXISTS "scopeNotes" TEXT;

ALTER TABLE "clients"
ADD COLUMN IF NOT EXISTS "scopeDocUrl" TEXT;
