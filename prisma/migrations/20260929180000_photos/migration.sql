-- Photos of clients, locations and contacts (Clients handoff: card photo band,
-- profile photo tile, location tiles, contact headshots).
--
-- A table of its own, not columns on clients / locations / client_contacts:
-- those rows are read whole all over the app, and the image bytes would ride
-- along with every one of those reads. Exactly one owner id is set per row.
--
-- Additive only: a new table, nothing existing changes. Apply to live with
--   npx prisma db execute --file prisma/migrations/20260929180000_photos/migration.sql --schema prisma/schema.prisma

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "locationId" TEXT,
    "contactId" TEXT,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photos_clientId_key" ON "photos"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "photos_locationId_key" ON "photos"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "photos_contactId_key" ON "photos"("contactId");

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "client_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

