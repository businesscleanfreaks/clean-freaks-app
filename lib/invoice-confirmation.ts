/**
 * The final confirmation before an invoice with changes goes out.
 *
 * Approving each change one by one says "I saw this row". This says "I stand
 * behind the whole set" — and per Josh (2026-08-25) it is a hard gate: an
 * invoice carrying changes cannot be sent until it is ticked.
 *
 * An invoice with nothing unusual on it needs no confirmation. Asking for one
 * on every routine invoice would train people to tick without reading, which
 * costs the gate exactly the value it is supposed to add.
 */

import type { Adjustment } from "./invoice-adjustments"

const money = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Whether this invoice needs confirming at all. Only changes make it
 * necessary — a plain month of expected cleans does not.
 */
export function needsConfirmation(list: Adjustment[]): boolean {
  return list.length > 0
}

/**
 * The sentence next to the checkbox. Names the single change when there is
 * one, because "the 1 change above" tells the reader nothing they can check.
 */
export function confirmationText(list: Adjustment[]): string {
  if (list.length === 0) return ""
  if (list.length === 1) {
    const a = list[0]
    const label = (a.label || "change").toLowerCase()
    const day = a.serviceDay ? ` on day ${a.serviceDay}` : ""
    const verb = a.amount < 0 ? "credit of" : "charge of"
    return `I confirm the ${label}${day} · ${verb} ${money(a.amount)} is correct.`
  }
  return `I confirm the ${list.length} changes above are correct.`
}

/**
 * Why sending is blocked, or null when it is fine to send.
 *
 * Order matters: unapproved rows are named first, because ticking the box is
 * meaningless while rows are still unreviewed.
 */
export function confirmBlockedReason(list: Adjustment[], confirmed: boolean): string | null {
  const pending = list.filter(a => !a.approved).length
  if (pending > 0) return `Approve ${pending} change${pending === 1 ? "" : "s"} before sending`
  if (needsConfirmation(list) && !confirmed) return "Confirm the changes above before sending"
  return null
}
