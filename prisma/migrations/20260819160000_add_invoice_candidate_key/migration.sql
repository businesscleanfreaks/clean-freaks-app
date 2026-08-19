-- Identity of the review-workspace candidate an invoice came from ("YYYY-MM|locationIds").
-- Lets POST /api/invoices recognise that a retried send is the same invoice.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "candidateKey" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_clientId_candidateKey_idx"
  ON "invoices" ("clientId", "candidateKey");
