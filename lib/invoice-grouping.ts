/**
 * Invoice line-item grouping (presentation only — recomputed every render).
 *
 * For pay-per-clean clients, a month of repeat cleanings renders as ONE summary
 * line (Qty × Unit Price) with the visit dates in parentheses, instead of one
 * row per visit. Add-ons stay as their own lines, and flat-rate invoices are
 * left exactly as they are today. See clean-freaks-invoice-grouping-spec.md.
 *
 * This is a pure function so the PDF, the on-screen preview, the detail view,
 * and the public client view all produce identical output from the same data.
 */

export interface RawInvoiceLineItem {
  id: string
  description: string
  amount: number
  serviceDate?: string | Date | null
  jobId?: string | null
  addOnServiceId?: string | null
}

export interface GroupedInvoiceRow {
  key: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
  /** true when the row summarises more than one visit */
  grouped: boolean
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthYearLabel(dates: Date[]): string {
  if (dates.length === 0) return ''
  const d = dates[0]
  return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`
}

function abbrDate(d: Date): string {
  return `${MONTHS_ABBR[d.getMonth()]} ${d.getDate()}`
}

/**
 * Ascending date list. ≤12 dates: "Jun 1, 4, 8…" (month shown once, repeated
 * only when it changes). >12 dates: "Jun 1 to Jun 30, 30 visits".
 */
function dateListLabel(dates: Date[]): string {
  if (dates.length === 0) return ''
  if (dates.length > 12) {
    return `${abbrDate(dates[0])} to ${abbrDate(dates[dates.length - 1])}, ${dates.length} visits`
  }
  let lastMonth = -1
  return dates
    .map((d) => {
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth()
        return abbrDate(d) // "Jun 1"
      }
      return String(d.getDate()) // "4"
    })
    .join(', ')
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

export function groupInvoiceLineItems(
  lineItems: RawInvoiceLineItem[],
  opts?: { billingType?: string | null },
): GroupedInvoiceRow[] {
  // Flat-rate invoices are unchanged: one row per line item.
  if (opts?.billingType === 'FLAT_RATE') {
    return lineItems.map((li) => ({
      key: li.id,
      description: li.description,
      quantity: 1,
      unitPrice: li.amount,
      amount: li.amount,
      grouped: false,
    }))
  }

  // Per-clean: cleaning visits (a job, not an add-on) group by unit price;
  // add-ons and any manual lines stay individual.
  const visits: RawInvoiceLineItem[] = []
  const others: RawInvoiceLineItem[] = []
  for (const li of lineItems) {
    if (!li.addOnServiceId && li.jobId) visits.push(li)
    else others.push(li)
  }

  const byPrice = new Map<number, RawInvoiceLineItem[]>()
  for (const li of visits) {
    const price = Math.round((li.amount || 0) * 100) / 100
    const bucket = byPrice.get(price)
    if (bucket) bucket.push(li)
    else byPrice.set(price, [li])
  }

  const groupRows: Array<{ row: GroupedInvoiceRow; earliest: number }> = []
  for (const [price, items] of byPrice) {
    const dates = items
      .map((i) => toDate(i.serviceDate))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())
    const qty = items.length
    const month = monthYearLabel(dates)
    const list = dateListLabel(dates)
    const description = month
      ? `Cleaning Services, ${month}${list ? ` (${list})` : ''}`
      : 'Cleaning Services'
    groupRows.push({
      row: {
        key: `clean-${price}`,
        description,
        quantity: qty,
        unitPrice: price,
        amount: Math.round(price * qty * 100) / 100,
        grouped: qty > 1,
      },
      earliest: dates.length ? dates[0].getTime() : Number.MAX_SAFE_INTEGER,
    })
  }
  groupRows.sort((a, b) => a.earliest - b.earliest)

  const otherRows: GroupedInvoiceRow[] = others.map((li) => ({
    key: li.id,
    description: li.description,
    quantity: 1,
    unitPrice: li.amount,
    amount: li.amount,
    grouped: false,
  }))

  return [...groupRows.map((g) => g.row), ...otherRows]
}
