/**
 * Which month an invoice belongs to.
 *
 * There are two dates in play and they are not the same thing:
 *
 *  - `billingPeriodStart` · the month the WORK happened in. This is what the
 *    invoice is for, and it is what the workspace lists an invoice under.
 *  - `dateCreated` · the day the invoice was written. Billing in arrears means
 *    an August invoice is routinely created in September.
 *
 * The invoice list scopes by the billing period; the detail page used to open
 * the workspace using `dateCreated`. For every invoice written in a different
 * month from the work it covers, those disagree · you click an invoice in one
 * month and the workspace opens on another, where its row does not exist.
 *
 * So both sides go through here.
 *
 * UTC accessors on purpose: these are stored as day values, and reading them
 * in a timezone behind UTC turns the first of the month into the last of the
 * previous one, which is the same bug in a smaller costume.
 */

export interface InvoiceMonthInput {
  billingPeriodStart?: Date | string | null
  dateCreated?: Date | string | null
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`

/**
 * The "yyyy-MM" the workspace should open on for this invoice, or null when
 * neither date can be read · the caller then falls back to the current month.
 *
 * Prefers the billing period, matching how the candidates endpoint decides
 * which month a row appears under.
 */
export function invoiceWorkspaceMonth(input: InvoiceMonthInput): string | null {
  const period = asDate(input.billingPeriodStart)
  if (period) return monthOf(period)

  const created = asDate(input.dateCreated)
  return created ? monthOf(created) : null
}
