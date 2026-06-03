-- Cached invoice PDF, keyed by a content fingerprint. Additive only — no data loss.

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "pdfCache" BYTEA;

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "pdfFingerprint" TEXT;
