/**
 * Whether a detected payment settles the invoice it is being applied to.
 *
 * The confirm route used to mark an invoice PAID without ever reading its
 * total. A $100 Zelle notification applied to a $1,000 invoice reported success
 * and marked it fully settled, and because cleaner payouts can be gated on "the
 * client has paid", it could release a cleaner payment too. The invoice was
 * fetched with `select: { id, clientId }` · the total was not even loaded.
 *
 * The rule here is deliberately conservative: an amount that does not settle
 * the invoice is refused and explained, rather than guessed at. Josh can still
 * apply it, but as a decision he makes rather than one the app makes silently.
 *
 * This is NOT the manual "mark paid" button. That is a person deliberately
 * saying the money arrived, and it carries no amount to check.
 *
 * Pure: no Prisma, no clock.
 */

/** Money compares to the cent; floats do not compare exactly. */
const TOLERANCE = 0.01

export type PaymentFit =
  /** Settles the invoice. */
  | "EXACT"
  /** Less than the balance · the invoice is not settled by it. */
  | "UNDERPAID"
  /** More than the balance. */
  | "OVERPAID"

export interface PaymentApplication {
  fit: PaymentFit
  /** True only when the app may settle the invoice without being told to. */
  settles: boolean
  /** The shortfall or excess, positive in both directions. Zero when exact. */
  difference: number
  /** Shown to the reviewer when it does not settle. */
  reason: string | null
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" })

/**
 * Compare a payment against an invoice total.
 *
 * `invoiceTotal` is the balance owed. Partial payments are not tracked yet, so
 * a second payment against a part-paid invoice still compares to the full
 * amount · which is the conservative direction: it refuses rather than assumes.
 */
export function applyPaymentToInvoice(
  paymentAmount: number,
  invoiceTotal: number,
): PaymentApplication {
  const difference = Math.round((paymentAmount - invoiceTotal) * 100) / 100

  if (Math.abs(difference) <= TOLERANCE) {
    return { fit: "EXACT", settles: true, difference: 0, reason: null }
  }

  if (difference < 0) {
    return {
      fit: "UNDERPAID",
      settles: false,
      difference: Math.abs(difference),
      reason:
        `This payment is ${money(paymentAmount)} but the invoice is ${money(invoiceTotal)}, ` +
        `${money(Math.abs(difference))} short. Marking it paid would record the invoice as ` +
        `settled in full.`,
    }
  }

  return {
    fit: "OVERPAID",
    settles: false,
    difference,
    reason:
      `This payment is ${money(paymentAmount)} but the invoice is ${money(invoiceTotal)}, ` +
      `${money(difference)} more than owed. It may belong to more than one invoice.`,
  }
}

/**
 * Whether the route may proceed.
 *
 * An exact match goes through. Anything else needs the reviewer to say so,
 * which is what `confirmMismatch` carries · the same shape the pre-invoice
 * guard already uses for "review and confirm before sending".
 */
export function mayApplyPayment(
  application: PaymentApplication,
  confirmMismatch: boolean,
): boolean {
  return application.settles || confirmMismatch
}

/** Recorded on the invoice when a mismatch was applied on purpose. */
export function mismatchNote(application: PaymentApplication): string | null {
  if (application.settles) return null
  const direction = application.fit === "UNDERPAID" ? "short" : "over"
  return `Applied with a ${money(application.difference)} ${direction} difference, confirmed by the reviewer.`
}
