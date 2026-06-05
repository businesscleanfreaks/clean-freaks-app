-- Workspace-level invoice email template (Settings / composer "Templates"). Additive.

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'Invoice · {client} · {month}',
  "message" TEXT NOT NULL DEFAULT 'Hi {client}, please find attached your invoice for {total} for {month}. Payment is due by {due_date}. Thank you for your business.',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);
