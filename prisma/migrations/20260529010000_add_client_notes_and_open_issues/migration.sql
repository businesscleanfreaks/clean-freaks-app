-- Client Cockpit Notes system. Additive only — no data loss.

-- Notes table
CREATE TABLE IF NOT EXISTS "client_notes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "author" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_notes_clientId_idx" ON "client_notes"("clientId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_notes_clientId_fkey') THEN
    ALTER TABLE "client_notes"
      ADD CONSTRAINT "client_notes_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Overview "Open Issues" — short unresolved-issue strings on the client
ALTER TABLE "clients"
ADD COLUMN IF NOT EXISTS "openIssues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
