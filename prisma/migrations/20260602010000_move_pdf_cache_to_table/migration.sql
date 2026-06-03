-- Move the invoice PDF cache off the invoices row into its own table so the
-- bytes never load with normal invoice queries.

ALTER TABLE "invoices" DROP COLUMN IF EXISTS "pdfCache";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "pdfFingerprint";

CREATE TABLE IF NOT EXISTS "invoice_pdf_cache" (
  "invoiceId" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_pdf_cache_pkey" PRIMARY KEY ("invoiceId")
);

DO $$ BEGIN
  ALTER TABLE "invoice_pdf_cache"
    ADD CONSTRAINT "invoice_pdf_cache_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
