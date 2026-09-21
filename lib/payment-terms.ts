/**
 * Payment terms and the due date they imply.
 *
 * The review screen showed Net 7 / Net 15 / Net 30 with nothing highlighted and
 * a due date that matched none of them: every client has an empty
 * `paymentTerms`, and the due date was a hardcoded 10th of the month. So the
 * control looked broken and the number beside it was unexplained.
 *
 * Two rules:
 *  - With a term recorded, the due date is derived from it. Picking Net 30
 *    moves the date, which is the whole point of the control.
 *  - With no term recorded, the existing due date is left exactly as it is and
 *    reported as "Custom". Quietly re-dating live invoices to fit a default
 *    nobody chose would change what clients have been told.
 *
 * Pure: no Prisma, no clock.
 */

import { formatDateOnly } from "./date-only"

export const TERM_DAYS: Record<string, number> = {
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
}

/** Shown when the due date does not correspond to any offered term. */
export const CUSTOM_TERM = "CUSTOM" as const

export type TermSelection = keyof typeof TERM_DAYS | typeof CUSTOM_TERM | null

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** The due date `term` implies, counting from the issue date. */
export function dueDateForTerm(issuedDate: Date, term: string): Date | null {
  const days = TERM_DAYS[term]
  if (days === undefined) return null
  const due = startOfDay(issuedDate)
  due.setDate(due.getDate() + days)
  return due
}

/** Whole days between two dates, ignoring the time of day. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * Which chip to light up.
 *
 * Prefers the client's recorded term. Failing that it reads the gap between
 * the dates, so an invoice already due in exactly 15 days shows Net 15 rather
 * than nothing. Anything else is honestly labelled Custom instead of leaving
 * the whole control looking unset.
 */
export function selectedTerm(
  recordedTerm: string | null | undefined,
  issuedDate?: Date | null,
  dueDate?: Date | null,
): TermSelection {
  const recorded = (recordedTerm || "").trim().toUpperCase()
  if (TERM_DAYS[recorded] !== undefined) return recorded as TermSelection

  if (!issuedDate || !dueDate) return null
  const gap = daysBetween(issuedDate, dueDate)
  const match = Object.keys(TERM_DAYS).find(term => TERM_DAYS[term] === gap)
  return (match as TermSelection) ?? CUSTOM_TERM
}

/**
 * The due date to show.
 *
 * A recorded term wins. Without one the existing date stands · the invoice may
 * already have gone out carrying it.
 */
export function resolveDueDate(
  recordedTerm: string | null | undefined,
  issuedDate: Date,
  existingDueDate?: Date | null,
): Date {
  const recorded = (recordedTerm || "").trim().toUpperCase()
  const derived = dueDateForTerm(issuedDate, recorded)
  if (derived) return derived
  return existingDueDate ?? issuedDate
}

/**
 * The due date to put in an invoice email, in the client's own words.
 *
 * The batch send computed one date for the whole run as "the 10th of the month
 * being billed" · `new Date(y, m - 1, 10)`. Two things were wrong with that.
 * Billing in arrears means August is invoiced in September, so the email told
 * the client payment was due on a day that had already passed. And it was the
 * same date for everyone, ignoring the terms each client is actually on, which
 * the invoice has already resolved and stored.
 *
 * So this reads the invoice's OWN due date. A day value, formatted as a day ·
 * see lib/date-only.ts for why that is not the same as formatting an instant.
 *
 * Null when the invoice carries no due date. The caller should leave the date
 * out rather than invent one: a wrong due date on a client's invoice is worse
 * than no sentence about it.
 */
export function dueDateLabel(dateDue: Date | string | null | undefined): string | null {
  return formatDateOnly(dateDue, "MMMM d, yyyy")
}
