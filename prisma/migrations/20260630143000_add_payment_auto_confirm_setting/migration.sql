ALTER TABLE "email_settings"
  ADD COLUMN IF NOT EXISTS "autoConfirmHighConfidencePayments" BOOLEAN NOT NULL DEFAULT false;
