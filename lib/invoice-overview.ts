/**
 * Invoices overview metrics (Invoices page header cards).
 *
 * Pure functions over a simple invoice shape so the money math is unit-testable
 * without a database.
 */

export interface OverviewInvoice {
  id: string
  invoiceNumber: string
  clientName: string
  status: string
  totalAmount: number
  dateCreated: string
  dateDue: string | null
  datePaid: string | null
}

export interface OverdueEntry {
  id: string
  clientName: string
  amount: number
  daysOverdue: number
}

export interface InvoiceOverviewMetrics {
  /** Money actually received for invoices in the period. */
  collected: number
  /** Everything billed in the period, excluding voids. */
  expected: number
  /** Billed but not yet paid (excludes drafts — nothing has been asked for yet). */
  outstanding: number
  collectedPct: number
  sentPct: number
  invoiceCount: number
  sentCount: number
  overdue: OverdueEntry[]
  overdueTotal: number
}

/** VOID invoices never count toward any total. */
const isVoid = (status: string) => status === 'VOID'
const isPaid = (status: string) => status === 'PAID'
/** Only SENT invoices represent money actually requested from a client. */
const isSent = (status: string) => status === 'SENT'

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

export function computeOverviewMetrics(
  invoices: OverviewInvoice[],
  now: Date = new Date(),
): InvoiceOverviewMetrics {
  const live = invoices.filter(inv => !isVoid(inv.status))

  const expected = live.reduce((sum, inv) => sum + inv.totalAmount, 0)
  const collected = live.filter(inv => isPaid(inv.status)).reduce((sum, inv) => sum + inv.totalAmount, 0)
  // Drafts are excluded: the client has not been asked to pay them yet.
  const outstanding = live.filter(inv => isSent(inv.status)).reduce((sum, inv) => sum + inv.totalAmount, 0)
  const sentCount = live.filter(inv => isSent(inv.status) || isPaid(inv.status)).length

  const overdue = live
    .filter(inv => isSent(inv.status) && inv.dateDue && new Date(inv.dateDue) < now)
    .map(inv => ({
      id: inv.id,
      clientName: inv.clientName,
      amount: inv.totalAmount,
      daysOverdue: daysBetween(new Date(inv.dateDue as string), now),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    collected,
    expected,
    outstanding,
    collectedPct: expected > 0 ? Math.round((collected / expected) * 100) : 0,
    sentPct: live.length > 0 ? Math.round((sentCount / live.length) * 100) : 0,
    invoiceCount: live.length,
    sentCount,
    overdue,
    overdueTotal: overdue.reduce((sum, entry) => sum + entry.amount, 0),
  }
}

/** Inclusive UTC bounds for a "YYYY-MM" period. */
export function monthBounds(period: string): { start: Date; end: Date } {
  const [yearRaw, monthRaw] = period.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw) - 1
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  }
}

export function isValidPeriod(period: string | null | undefined): period is string {
  if (!period) return false
  if (!/^\d{4}-\d{2}$/.test(period)) return false
  const month = Number(period.split('-')[1])
  return month >= 1 && month <= 12
}

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
