-- An add-on a cleaner performed on someone else's schedule gets a line of its own.
--
-- WHY: these add-ons ("Payout-B") were paid by setting a flag on the add-on and
-- adding the amount straight to the payment total. Nothing recorded them:
--
--   * The payment history counts line items to show "N cleans", so the add-on
--     was invisible in it.
--   * Undoing a clean on the same payment recomputed the total from the line
--     items, which did not include the add-on · so its money disappeared while
--     the add-on stayed marked paid.
--   * Nothing ever unmarked one. Undo only ever looked at cleans.
--
-- The vendor line item and the invoice line item both already carry an add-on
-- link. This makes the cleaner one match.

ALTER TABLE "subcontractor_payment_line_items"
    ADD COLUMN IF NOT EXISTS "addOnServiceId" TEXT;

-- A clean OR an add-on, never both, and never neither.
ALTER TABLE "subcontractor_payment_line_items"
    DROP CONSTRAINT IF EXISTS "subcontractor_payment_line_items_addOnServiceId_fkey";
ALTER TABLE "subcontractor_payment_line_items"
    ADD CONSTRAINT "subcontractor_payment_line_items_addOnServiceId_fkey"
    FOREIGN KEY ("addOnServiceId") REFERENCES "add_on_services"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- One line per add-on per payment, the same guarantee cleans already have.
CREATE UNIQUE INDEX IF NOT EXISTS "subcontractor_payment_line_items_paymentId_addOnServiceId_key"
    ON "subcontractor_payment_line_items" ("paymentId", "addOnServiceId");

CREATE INDEX IF NOT EXISTS "subcontractor_payment_line_items_addOnServiceId_idx"
    ON "subcontractor_payment_line_items" ("addOnServiceId");
