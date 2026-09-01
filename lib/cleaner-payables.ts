/**
 * What we owe each cleaner, and whether it is ready to go out.
 *
 * Josh's rules (2026-08-26):
 *  - Cleaners invoice us **per account**, not one invoice for everything. A
 *    company with 7 commercial accounts sends 7 invoices at month end.
 *  - Residential and one-off work is invoiced **per clean** instead. Rarer, but
 *    it is how those accounts actually bill.
 *  - Some teams do not invoice at all; their work never waits on one.
 *  - Each cleaner has their own pay-by day of the month (default the 3rd).
 *
 * Pure: no Prisma, no React, so the money rules are testable on their own.
 */

import { cleanerOwedForCancellation } from "./cancellation-fee"

/** How an account bills us for a month's work. */
export type InvoiceUnit = "PER_ACCOUNT" | "PER_CLEAN"

/** Josh 2026-08-26: the default day of the month a cleaner is paid by. */
export const DEFAULT_PAY_BY_DAY = 3

export interface CleanerAccount {
  /** Location/account id. */
  id: string
  clientName: string
  /** PER_ACCOUNT (one invoice a month) or PER_CLEAN (one per visit). */
  invoiceUnit: InvoiceUnit
  /** Unpaid jobs on this account for the period. */
  jobIds: string[]
  /**
   * Job ids whose cleaner invoice has arrived. For PER_ACCOUNT accounts the
   * whole account is marked at once, so this is all-or-nothing.
   */
  invoicedJobIds: string[]
  /** True when the client has settled the invoice covering this work. */
  clientHasPaid: boolean
  /**
   * End-of-month work waits for either the client's money or the pay-by day.
   * Weekly and within-5-days work is never held.
   */
  holdsUntilPayByDay: boolean
}

export interface CleanerInvoiceTally {
  /** Invoices we expect for this account this period. */
  expected: number
  /** How many have arrived. */
  received: number
  complete: boolean
}

/**
 * How many invoices an account owes us, and how many are in.
 *
 * A per-account account owes exactly one invoice however many cleans it had —
 * counting cleans there would show "1 of 9" forever and read as missing work.
 */
export function tallyAccountInvoices(account: CleanerAccount): CleanerInvoiceTally {
  if (account.invoiceUnit === "PER_ACCOUNT") {
    const expected = account.jobIds.length > 0 ? 1 : 0
    const received = account.invoicedJobIds.length > 0 ? 1 : 0
    return { expected, received, complete: expected === 0 || received >= expected }
  }
  const expected = account.jobIds.length
  const received = account.jobIds.filter(id => account.invoicedJobIds.includes(id)).length
  return { expected, received, complete: received >= expected }
}

/** The "12 of 15" a cleaner's row shows, summed over their accounts. */
export function tallyCleanerInvoices(
  accounts: CleanerAccount[],
  invoicesUs: boolean,
): CleanerInvoiceTally & { notApplicable: boolean } {
  if (!invoicesUs) {
    return { expected: 0, received: 0, complete: true, notApplicable: true }
  }
  let expected = 0
  let received = 0
  for (const a of accounts) {
    const t = tallyAccountInvoices(a)
    expected += t.expected
    received += t.received
  }
  return { expected, received, complete: received >= expected, notApplicable: false }
}

/**
 * Whether end-of-month work has come unlocked: the client has paid, or the
 * calendar has reached this cleaner's pay-by day in the month AFTER the work.
 *
 * "We pay by the Nth no matter what" — so once the day arrives the money goes
 * out whether or not the client has settled.
 */
export function isUnlocked(
  account: CleanerAccount,
  payByDay: number,
  period: string,
  now: Date,
): boolean {
  if (!account.holdsUntilPayByDay) return true
  if (account.clientHasPaid) return true
  const [y, m] = period.split("-").map(Number)
  if (!y || !m) return false
  // The pay-by day falls in the month after the work.
  const due = new Date(y, m, clampDay(payByDay), 0, 0, 0, 0)
  return now >= due
}

/** Keeps a stored day usable in every month, February included. */
export function clampDay(day: number): number {
  if (!Number.isFinite(day)) return DEFAULT_PAY_BY_DAY
  return Math.max(1, Math.min(28, Math.trunc(day)))
}

export type JobPayState = "ready" | "needs-invoice" | "locked" | "paid"

export interface JobPayInput {
  jobId: string
  paid: boolean
  account: CleanerAccount
  invoicesUs: boolean
  payByDay: number
  period: string
  now: Date
}

/**
 * Why a single job can or cannot be paid right now.
 *
 * Order is the order the operator can act on: already done, then the thing
 * they chase the cleaner for, then the thing they can only wait out.
 */
export function jobPayState(input: JobPayInput): JobPayState {
  if (input.paid) return "paid"
  if (input.invoicesUs && !hasInvoiceFor(input.jobId, input.account)) return "needs-invoice"
  if (!isUnlocked(input.account, input.payByDay, input.period, input.now)) return "locked"
  return "ready"
}

/**
 * Whether this job's invoice is in. A per-account account is covered as a
 * whole, so any receipt on it covers every job it holds.
 */
export function hasInvoiceFor(jobId: string, account: CleanerAccount): boolean {
  if (account.invoiceUnit === "PER_ACCOUNT") return account.invoicedJobIds.length > 0
  return account.invoicedJobIds.includes(jobId)
}

/** The date a cleaner is paid by: their day, in the month AFTER the work. */
export function payByDate(period: string, payByDay: number): Date {
  const [y, m] = period.split("-").map(Number)
  return new Date(y, m, clampDay(payByDay), 0, 0, 0, 0)
}

export interface DueLabel {
  label: string
  color: string
  /** The design bolds the urgent states so they carry across the row. */
  weight: 600 | 800
}

/**
 * When this cleaner is due to be paid, said the way the design says it.
 *
 * Past the day reads "overdue" rather than a date — once it has slipped, the
 * date is no longer the useful fact.
 */
export function dueLabel(period: string, payByDay: number, now: Date): DueLabel {
  const due = payByDate(period, payByDay)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (due < today) return { label: "overdue", color: "#d92d20", weight: 800 }
  if (due.getTime() === today.getTime()) return { label: "due today", color: "#c2410c", weight: 800 }
  return {
    label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    color: "#9a9fa4",
    weight: 600,
  }
}

/**
 * The memo that goes on the Zelle transfer, so the cleaner can tell which
 * account a payment covers.
 */
export function zelleMemo(clientName: string, period: string): string {
  const [y, m] = period.split("-").map(Number)
  const month = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" })
  return `The Clean Freaks Pay - ${clientName} - ${month}`
}

export interface OwedItem {
  id: string
  paid: boolean
  /** The cleaner's rate for this clean. Ignored for flat-rate months. */
  rate: number
  cancelled?: boolean
  cancellationFee?: number | null
  /** Null for one-off work. */
  scheduleId?: string | null
  /**
   * Add-ons on this clean that this cleaner performed. Paid on top of both
   * rules — an extra job is extra money even in a flat-rate month.
   */
  addOnRate?: number
  /**
   * "YYYY-MM" of the clean. Only read by `accountOwedOverMonths`, which needs
   * to know where one flat-rate month ends and the next begins.
   */
  month?: string
}

/**
 * What a cleaner is owed for one account in one month.
 *
 * The rule that matters: a FLAT_RATE recurring account owes its monthly rate
 * ONCE, however many cleans happened. Summing the rate per clean inflates it by
 * the visit count — on this data that turned $13,140 into $163,240.
 *
 * Cancelled cleans never earn the rate but do pass their gas fee through, so
 * they are added on top of whichever rule applies.
 */
export function accountOwed(
  items: OwedItem[],
  payType: "FLAT_RATE" | "PER_CLEAN",
  monthlyRate: number,
): number {
  const unpaid = items.filter(i => !i.paid)
  const fees = unpaid
    .filter(i => i.cancelled)
    .reduce((sum, i) => sum + cleanerOwedForCancellation(i.cancellationFee), 0)

  const addOns = unpaid
    .filter(i => !i.cancelled)
    .reduce((sum, i) => sum + (i.addOnRate || 0), 0)

  if (payType === "FLAT_RATE") {
    // Earned by cleans that actually happened; a month of pure cancellations
    // owes the fees and nothing more.
    const hasRealClean = unpaid.some(i => !i.cancelled && i.scheduleId)
    return (hasRealClean ? monthlyRate : 0) + addOns + fees
  }

  return (
    unpaid.filter(i => !i.cancelled).reduce((sum, i) => sum + (i.rate || 0), 0) + addOns + fees
  )
}

/**
 * The same rule applied over a span of months.
 *
 * A flat-rate account owes its monthly rate once PER MONTH, so a quarter of
 * unpaid work owes it three times. `accountOwed` deliberately answers for a
 * single month; handing it a quarter's jobs returns one month's rate for three
 * months' work and understates the bill. Grouping by `month` first keeps the
 * "once, however many cleans" rule intact inside each month.
 *
 * For PER_CLEAN this is the same number either way — it is a plain sum.
 */
export function accountOwedOverMonths(
  items: OwedItem[],
  payType: "FLAT_RATE" | "PER_CLEAN",
  monthlyRate: number,
): number {
  const byMonth = new Map<string, OwedItem[]>()
  for (const item of items) {
    const key = item.month ?? ""
    byMonth.set(key, [...(byMonth.get(key) ?? []), item])
  }
  let total = 0
  for (const group of byMonth.values()) {
    total += accountOwed(group, payType, monthlyRate)
  }
  return total
}
