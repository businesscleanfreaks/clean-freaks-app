-- Inbox-sync opt-in + IMAP watermark on the singleton email settings row
ALTER TABLE "email_settings"
  ADD COLUMN IF NOT EXISTS "enableInboxSync" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastInboxUid" TEXT;

-- Detected inbound payments awaiting reconciliation
CREATE TABLE IF NOT EXISTS "payment_matches" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "confirmationNumber" TEXT,
  "senderName" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "rawSnippet" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "confidence" TEXT,
  "matchedInvoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_matches_messageId_key" ON "payment_matches"("messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_matches_confirmationNumber_key" ON "payment_matches"("confirmationNumber");
CREATE INDEX IF NOT EXISTS "payment_matches_status_idx" ON "payment_matches"("status");
CREATE INDEX IF NOT EXISTS "payment_matches_receivedAt_idx" ON "payment_matches"("receivedAt");

-- Learned payer-name → client map
CREATE TABLE IF NOT EXISTS "client_payment_aliases" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "normalizedSenderName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_payment_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_payment_aliases_normalizedSenderName_key" ON "client_payment_aliases"("normalizedSenderName");
CREATE INDEX IF NOT EXISTS "client_payment_aliases_clientId_idx" ON "client_payment_aliases"("clientId");

DO $$ BEGIN
  ALTER TABLE "payment_matches"
    ADD CONSTRAINT "payment_matches_matchedInvoiceId_fkey"
    FOREIGN KEY ("matchedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "client_payment_aliases"
    ADD CONSTRAINT "client_payment_aliases_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
