/**
 * What the cleaner is owed for the work on one invoice.
 *
 * The review workspace shows this next to the invoice because the two are the
 * same month's work seen from opposite sides: the client pays us, then we
 * settle with whoever did the cleans. The design only surfaces it once the
 * client has actually paid — before that it is not yet a decision, and putting
 * it on every unsent invoice would just be noise.
 */

export type PayoutState = "paid" | "ready" | "locked"

export interface PayoutClean {
  status: string
  subcontractorRate?: number | null
  subcontractorPaid?: boolean | null
  cleanerName?: string | null
}

export interface PayoutSummary {
  state: PayoutState
  /** Who is owed. "3 cleaners" when the month's work is split. */
  cleanerLabel: string
  amount: number
  title: string
  sub: string
  /** Whether the reviewer can act on it now. */
  actionable: boolean
}

/** Cleans that count toward a payout: cancelled work is not owed for. */
const payable = (c: PayoutClean) => c.status !== "CANCELLED" && (c.subcontractorRate ?? 0) > 0

/** "Amy" for one cleaner, "3 cleaners" when the month is shared. */
export function cleanerLabelFor(cleans: PayoutClean[]): string {
  const names = [...new Set(cleans.filter(payable).map(c => (c.cleanerName || "").trim()).filter(Boolean))]
  if (names.length === 0) return "the cleaner"
  if (names.length === 1) return names[0]
  return `${names.length} cleaners`
}

export interface PayoutInput {
  cleans: PayoutClean[]
  /** Invoice status: DRAFT | SENT | PAID. */
  invoiceStatus?: string | null
  /** Whether the client is past due — the design says pay anyway. */
  overdue?: boolean
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function buildPayoutSummary(input: PayoutInput): PayoutSummary | null {
  const { cleans, invoiceStatus, overdue = false } = input
  const owed = cleans.filter(payable)
  if (owed.length === 0) return null

  const cleanerLabel = cleanerLabelFor(cleans)
  const outstanding = owed.filter(c => !c.subcontractorPaid)
  const amount = outstanding.reduce((sum, c) => sum + (c.subcontractorRate ?? 0), 0)

  if (outstanding.length === 0) {
    return {
      state: "paid",
      cleanerLabel,
      amount: 0,
      title: `${cleanerLabel} paid`,
      sub: "Settled for this month",
      actionable: false,
    }
  }

  // The client's money is in, so this is now a decision the reviewer can make.
  if (invoiceStatus === "PAID" || overdue) {
    return {
      state: "ready",
      cleanerLabel,
      amount,
      title: `${cleanerLabel} · ready to pay`,
      sub: overdue && invoiceStatus !== "PAID"
        ? "Client is late · pay anyway so they don't wait"
        : "Client paid · settle now",
      actionable: true,
    }
  }

  return {
    state: "locked",
    cleanerLabel,
    amount,
    title: `You owe ${cleanerLabel} ${money(amount)}`,
    sub: "Unlocks when the client pays",
    actionable: false,
  }
}

/**
 * The design only shows the card once the client has paid, or once the cleaner
 * has been settled. Everything before that is still just pending work.
 */
export function shouldShowPayout(summary: PayoutSummary | null): boolean {
  return !!summary && summary.state !== "locked"
}
