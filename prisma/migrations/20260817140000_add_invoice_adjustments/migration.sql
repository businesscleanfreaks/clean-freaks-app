CREATE TABLE IF NOT EXISTS "invoice_adjustments" (
  "id"          TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "period"      TEXT NOT NULL,
  "clientId"    TEXT NOT NULL,
  "mode"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL,
  "serviceDay"  INTEGER,
  "approved"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoice_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "invoice_adjustments_candidateId_period_idx" ON "invoice_adjustments"("candidateId", "period");
CREATE INDEX IF NOT EXISTS "invoice_adjustments_clientId_idx" ON "invoice_adjustments"("clientId");
