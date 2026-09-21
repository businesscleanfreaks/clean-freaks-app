/**
 * Identity for "the invoice this candidate becomes".
 *
 * The review workspace creates an invoice as a VOID preview and immediately
 * finalizes it to DRAFT. The double-billing guards in POST /api/invoices are
 * deliberately skipped for previews (a VOID preview is disposable and must not
 * block opening the review screen) — but once finalized it is not disposable at
 * all, so a retried send used to leave a second finalized invoice behind.
 *
 * Job overlap can't catch that on its own: a flat-rate client's line items
 * carry no jobId, so there is nothing linking its invoice to its month. This
 * key supplies that link.
 *
 * It is deliberately built from the LOCATIONS of the cleans being billed rather
 * than from the caller's candidate id, because a client invoiced separately per
 * location has several legitimate invoices in one period and they must not
 * collapse into each other. Location sets are stable across a retry; candidate
 * id strings are not (they change shape once an invoice exists).
 */

/** `YYYY-MM|locationId,locationId` — periods and locations both sorted. */
export function invoiceCandidateKey(period: string, locationIds: string[]): string | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const unique = [...new Set(locationIds.filter(Boolean))].sort()
  if (unique.length === 0) return null
  return `${period}|${unique.join(",")}`
}

/**
 * The first and last day of a `YYYY-MM` period, or null when it isn't one.
 *
 * At NOON UTC, the convention this codebase stores day values in. These become
 * `billingPeriodStart` / `billingPeriodEnd`, which are read back with UTC
 * accessors (see lib/invoice-month.ts) to decide which month an invoice belongs
 * to. Built at local midnight, the 1st of the month read back in UTC is the
 * last day of the month BEFORE, so an invoice would file itself one month early
 * for everyone ahead of UTC · the same defect in a smaller costume.
 *
 * Noon also keeps overlap comparisons safe against period bounds computed in
 * some other zone: it is twelve hours from either edge of the day.
 */
export function periodRange(period: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const [y, m] = period.split("-").map(Number)
  if (m < 1 || m > 12) return null
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 12, 0, 0, 0)),
    // Day 0 of the next month is the last day of this one.
    end: new Date(Date.UTC(y, m, 0, 12, 0, 0, 0)),
  }
}

/**
 * The period an invoice bills for, inferred from the work on it.
 *
 * For invoices written before the period was recorded. The dates are the
 * service days of the lines · if they all fall in one month, that is the month
 * the invoice is for, whatever day it happened to be written on.
 *
 * Null when the lines span months or carry no dates: then it is a judgement,
 * not an inference, and nothing should be written.
 */
export function periodFromWorkDates(
  dates: readonly (Date | string | null | undefined)[],
): string | null {
  const months = new Set<string>()
  for (const value of dates) {
    if (!value) continue
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) continue
    months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return months.size === 1 ? [...months][0] : null
}
