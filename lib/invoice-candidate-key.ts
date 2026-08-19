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

/** Start and end instants of a `YYYY-MM` period, or null when it isn't one. */
export function periodRange(period: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const [y, m] = period.split("-").map(Number)
  if (m < 1 || m > 12) return null
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 0, 23, 59, 59, 999),
  }
}
