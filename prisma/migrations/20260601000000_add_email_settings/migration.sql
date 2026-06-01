-- In-app email configuration (Settings → Email). Additive only — no data loss.

CREATE TABLE IF NOT EXISTS "email_settings" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'gmail',
  "fromName" TEXT,
  "fromEmail" TEXT,
  "gmailUser" TEXT,
  "gmailAppPassword" TEXT,
  "resendApiKey" TEXT,
  "testEmail" TEXT,
  "enableSending" BOOLEAN NOT NULL DEFAULT false,
  "allowRealClientEmails" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);
