/**
 * Invoice ledger — the status vocabulary and grouping the Invoices page uses.
 *
 * The design's statuses are DERIVED from the stored `status` plus dates, rather
 * than being a new stored column:
 *
 *   To send      DRAFT with no scheduled send
 *   Scheduled    DRAFT with a scheduledSendAt (cancelable)
 *   Sent: Unpaid SENT and not yet past due
 *   Payment late SENT and past its due date
 *   Sent: Paid   PAID
 *
 * Not yet modelled (need schema work, deliberately out of this slice):
 *   Clearing     ACH/check in flight — no field exists for it yet
 *   Track only   a per-client billing preference, not an invoice state
 */

export type LedgerStatus = "To send" | "Scheduled" | "Sent: Unpaid" | "Payment late" | "Sent: Paid"

export type LedgerTab = "All" | LedgerStatus

export const LEDGER_TABS: LedgerTab[] = [
  "All",
  "To send",
  "Scheduled",
  "Sent: Unpaid",
  "Sent: Paid",
  "Payment late",
]

export type InvoiceKind = "Flat rate" | "Per clean" | "One-off"

export interface LedgerSource {
  id: string
  invoiceNumber: string
  clientName: string
  /** Stored status: DRAFT | SENT | PAID */
  status: string
  totalAmount: number
  dateDue: string | null
  datePaid: string | null
  scheduledSendAt: string | null
  /** Client billingType: FLAT_RATE | PER_CLEAN */
  billingType: string | null
  /**
   * True when every line item on this invoice comes from a one-off job (no
   * schedule). NOTE: `Invoice.billingPeriodStart` is NOT a usable signal here —
   * it exists on the model but is never populated by the invoice-create route
   * (verified: 0 of 11 live invoices have it), so keying off it labelled every
   * invoice "One-off".
   */
  isOneOff: boolean
  paymentMethod: string | null
  paymentReference: string | null
}

export interface LedgerRow extends LedgerSource {
  ledgerStatus: LedgerStatus
  kind: InvoiceKind
  /** Days past the due date; 0 unless Payment late. */
  daysLate: number
  /** Small grey line under the client name, e.g. "Scheduled to send on Aug 14". */
  subtext: string | null
  /** Needs sending today or sooner — drives the red "!" badge. */
  urgent: boolean
}

const DAY_MS = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

export function deriveLedgerStatus(inv: LedgerSource, now: Date): LedgerStatus {
  if (inv.status === "PAID") return "Sent: Paid"
  if (inv.status === "SENT") {
    if (inv.dateDue && new Date(inv.dateDue) < now) return "Payment late"
    return "Sent: Unpaid"
  }
  // DRAFT (or anything unexpected) — scheduled sends are held separately so the
  // "To send" queue only holds work the VA still has to action.
  if (inv.scheduledSendAt) return "Scheduled"
  return "To send"
}

export function deriveKind(inv: LedgerSource): InvoiceKind {
  if (inv.isOneOff) return "One-off"
  return inv.billingType === "FLAT_RATE" ? "Flat rate" : "Per clean"
}

function deriveSubtext(inv: LedgerSource, status: LedgerStatus): string | null {
  if (status === "Scheduled" && inv.scheduledSendAt) {
    return `Scheduled to send on ${shortDate(inv.scheduledSendAt)}`
  }
  if (status === "Sent: Paid" && inv.paymentMethod) {
    const method = inv.paymentMethod.charAt(0) + inv.paymentMethod.slice(1).toLowerCase()
    // Copy rule: "·" separators, never em dashes.
    return inv.paymentReference
      ? `Paid via ${method} · from “${inv.paymentReference}”`
      : `Paid via ${method}`
  }
  return null
}

export function toLedgerRow(inv: LedgerSource, now: Date = new Date()): LedgerRow {
  const ledgerStatus = deriveLedgerStatus(inv, now)
  const daysLate =
    ledgerStatus === "Payment late" && inv.dateDue ? Math.max(0, daysBetween(new Date(inv.dateDue), now)) : 0
  return {
    ...inv,
    ledgerStatus,
    kind: deriveKind(inv),
    daysLate,
    subtext: deriveSubtext(inv, ledgerStatus),
    // Due today or already past — the small red "!" next to Review.
    urgent: ledgerStatus === "To send" && !!inv.dateDue && new Date(inv.dateDue) <= now,
  }
}

/** Ledger opens sorted alphabetically by client (design requirement). */
export function sortRows(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort((a, b) => a.clientName.localeCompare(b.clientName))
}

export function filterByTab(rows: LedgerRow[], tab: LedgerTab): LedgerRow[] {
  return tab === "All" ? rows : rows.filter(r => r.ledgerStatus === tab)
}

/** Tab counts. The design shows a name and a count only — never money. */
export function tabCounts(rows: LedgerRow[]): Record<LedgerTab, number> {
  const counts = Object.fromEntries(LEDGER_TABS.map(t => [t, 0])) as Record<LedgerTab, number>
  counts.All = rows.length
  for (const row of rows) counts[row.ledgerStatus] += 1
  return counts
}

export interface LateClient {
  clientName: string
  amount: number
  daysLate: number
}

export interface LedgerStats {
  collected: number
  billed: number
  outstanding: number
  unpaidCount: number
  lateTotal: number
  lateClientCount: number
  /** Most overdue client, shown on the Late payments card. */
  worstOffender: LateClient | null
}

export function computeStats(rows: LedgerRow[]): LedgerStats {
  const collected = rows.filter(r => r.ledgerStatus === "Sent: Paid").reduce((s, r) => s + r.totalAmount, 0)
  const billed = rows.reduce((s, r) => s + r.totalAmount, 0)
  const unpaid = rows.filter(r => r.ledgerStatus === "Sent: Unpaid" || r.ledgerStatus === "Payment late")
  const late = rows.filter(r => r.ledgerStatus === "Payment late")
  const sortedLate = [...late].sort((a, b) => b.daysLate - a.daysLate)

  return {
    collected,
    billed,
    outstanding: unpaid.reduce((s, r) => s + r.totalAmount, 0),
    unpaidCount: unpaid.length,
    lateTotal: late.reduce((s, r) => s + r.totalAmount, 0),
    lateClientCount: new Set(late.map(r => r.clientName)).size,
    worstOffender: sortedLate[0]
      ? { clientName: sortedLate[0].clientName, amount: sortedLate[0].totalAmount, daysLate: sortedLate[0].daysLate }
      : null,
  }
}
