/**
 * Cancellation / gas fee.
 *
 * When a clean is called off late the cleaner has usually already committed
 * the trip, so the client is charged a small fee and that fee is passed to the
 * cleaner. It is never applied automatically — someone decides, per clean,
 * whether the circumstances warrant it — but a same-day cancellation offers
 * the standard amount so the common case is one keystroke.
 */

import { parseAmount } from "./new-invoice"

/** Offered for same-day cancellations. Editable every time; never forced. */
export const STANDARD_GAS_FEE = 20

/**
 * Whether a cancellation counts as same-day, comparing calendar days in local
 * time. A clean called off the morning it was due is same-day; one called off
 * the night before is not, however few hours separate them.
 */
export function isSameDayCancellation(cleanDate: Date, cancelledAt: Date): boolean {
  return (
    cleanDate.getFullYear() === cancelledAt.getFullYear() &&
    cleanDate.getMonth() === cancelledAt.getMonth() &&
    cleanDate.getDate() === cancelledAt.getDate()
  )
}

/**
 * What to put in the fee box when the cancel form opens.
 *
 * Returns "" rather than "0" for cancellations made in advance: an empty box
 * reads as "no fee decided", where a zero reads as a decision already made.
 */
export function suggestedCancellationFee(cleanDate: Date, cancelledAt: Date = new Date()): string {
  return isSameDayCancellation(cleanDate, cancelledAt) ? String(STANDARD_GAS_FEE) : ""
}

/**
 * What the cleaner is owed for a cancelled clean.
 *
 * The normal rate does not apply — no clean happened — but the fee charged to
 * the client is passed through in full. No fee charged means nothing owed.
 */
export function cleanerOwedForCancellation(cancellationFee: number | null | undefined): number {
  const fee = cancellationFee ?? 0
  return fee > 0 ? fee : 0
}

/**
 * Reads what was typed into the fee box. The field takes free text so it does
 * not change value on scroll, which means it can arrive as "$20" or "20.00 " —
 * anything unreadable, or negative, is no fee rather than a broken number.
 */
export function parseFeeInput(raw: string): number {
  const n = parseAmount(raw)
  return n > 0 ? n : 0
}
