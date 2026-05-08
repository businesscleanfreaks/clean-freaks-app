-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "billingPeriodEnd" TIMESTAMP(3);
