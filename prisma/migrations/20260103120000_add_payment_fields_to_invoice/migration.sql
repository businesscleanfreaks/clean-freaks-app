-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "invoices" ADD COLUMN "paymentTransactionId" TEXT;
ALTER TABLE "invoices" ADD COLUMN "paymentReceivedAt" DATETIME;
ALTER TABLE "invoices" ADD COLUMN "paymentNotes" TEXT;

