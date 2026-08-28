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
