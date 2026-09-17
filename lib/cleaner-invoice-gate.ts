/**
 * Whether a cleaner has actually billed us for the work we are about to pay for.
 *
 * Josh's rule: don't pay a cleaner for work unless they have sent us an invoice
 * for it. The gate that enforced it asked a much weaker question than the rule ·
 * it looked for ANY receipt from that cleaner in that MONTH:
 *
 *     where: { subcontractorId, period: { in: periodsBeingPaid } }
 *
 * Receipts are recorded per ACCOUNT, and optionally per clean or per add-on
 * (Josh 2026-08-26: most accounts invoice monthly, residential and one-off work
 * invoices per clean). So a cleaner who invoiced for one clean on one account
 * released payment for every account and every clean they worked that month.
 * The more carefully the receipts were recorded, the wider the hole: a single
 * per-clean tick opened the whole month.
 *
 * What covers a piece of work:
 *
 *   - a matched or resolved CleanerInvoice for that month · the older intake,
 *     one invoice per cleaner per month, which genuinely does cover the month;
 *   - an account-wide receipt for that account and month;
 *   - a receipt for exactly that clean, or exactly that add-on.
 *
 * Nothing else. In particular a receipt for a DIFFERENT account, or for a
 * different clean on the same account, covers nothing.
 *
 * Pure: no Prisma, no clock.
 */

/** One thing being paid for, as the gate needs to see it. */
export interface PayableUnit {
  kind: "JOB" | "ADDON"
  id: string
  locationId: string
  /** For the refusal message. */
  locationName: string
  /** "yyyy-MM" of the work. */
  period: string
}

/** A recorded receipt. A null job and add-on means the whole account. */
export interface ReceiptRecord {
  locationId: string
  period: string
  jobId: string | null
  addOnServiceId: string | null
}

/** One account-month the cleaner has not billed us for. */
export interface InvoiceGap {
  locationId: string
  locationName: string
  period: string
  /** How many pieces of work are uncovered there. */
  count: number
}

export interface InvoiceGateResult {
  /** True when every unit is billed for and the payment may go ahead. */
  satisfied: boolean
  uncovered: PayableUnit[]
  /** Uncovered work grouped the way a person would describe it. */
  gaps: InvoiceGap[]
  /** Kept for callers that only ever showed the months. */
  periods: string[]
}

const accountKey = (locationId: string, period: string) => `${locationId}|${period}`

/**
 * Which units of work are not yet billed for.
 *
 * `monthsInvoiced` are periods with a matched or resolved CleanerInvoice on
 * file, which covers everything in that month for that cleaner.
 */
export function checkInvoiceGate(
  units: readonly PayableUnit[],
  receipts: readonly ReceiptRecord[],
  monthsInvoiced: ReadonlySet<string> = new Set(),
): InvoiceGateResult {
  const wholeAccount = new Set<string>()
  const byJob = new Set<string>()
  const byAddOn = new Set<string>()

  for (const receipt of receipts) {
    if (receipt.jobId) {
      byJob.add(receipt.jobId)
      continue
    }
    if (receipt.addOnServiceId) {
      byAddOn.add(receipt.addOnServiceId)
      continue
    }
    wholeAccount.add(accountKey(receipt.locationId, receipt.period))
  }

  const uncovered = units.filter(unit => {
    if (monthsInvoiced.has(unit.period)) return false
    if (wholeAccount.has(accountKey(unit.locationId, unit.period))) return false
    if (unit.kind === "JOB") return !byJob.has(unit.id)
    return !byAddOn.has(unit.id)
  })

  const gaps = new Map<string, InvoiceGap>()
  for (const unit of uncovered) {
    const key = accountKey(unit.locationId, unit.period)
    const existing = gaps.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    gaps.set(key, {
      locationId: unit.locationId,
      locationName: unit.locationName,
      period: unit.period,
      count: 1,
    })
  }

  return {
    satisfied: uncovered.length === 0,
    uncovered,
    gaps: [...gaps.values()],
    periods: [...new Set(uncovered.map(u => u.period))],
  }
}

/** "Bigco Offices · 2026-09" and so on, for the refusal. */
export function describeGaps(gaps: readonly InvoiceGap[]): string {
  return gaps.map(gap => `${gap.locationName} · ${gap.period}`).join(", ")
}
