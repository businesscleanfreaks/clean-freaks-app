-- Threading: remember the Message-ID of the invoice email so a reminder can
-- reply into the same thread rather than starting a new one.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "emailMessageId" TEXT;

-- Reminder ladder history (stage 1: 1-4 days late, 2: 5-13, 3: 14+ = phone call).
CREATE TABLE IF NOT EXISTS "invoice_reminders" (
  "id"        TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "stage"     INTEGER NOT NULL,
  "channel"   TEXT NOT NULL,
  "daysLate"  INTEGER NOT NULL,
  "body"      TEXT,
  "sentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_reminders_invoiceId_idx" ON "invoice_reminders"("invoiceId");

DO $$
BEGIN
  ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
