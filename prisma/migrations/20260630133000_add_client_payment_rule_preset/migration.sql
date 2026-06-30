ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "paymentRulePreset" TEXT;

CREATE INDEX IF NOT EXISTS "clients_paymentRulePreset_idx"
  ON "clients"("paymentRulePreset");
