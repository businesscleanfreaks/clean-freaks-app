-- "Invoices sent to" card on the client profile's Billing tab.
-- A contact can exist without being an invoice recipient, so membership is its
-- own flag; billingOrder decides who is addressed (first) vs CC'd.
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "isBillingRecipient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "billingOrder" INTEGER;
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "billingRole" TEXT;
