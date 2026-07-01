/**
 * Cleaner-invoice reconciliation: compare what a cleaner bills us for a period
 * against what we independently compute we owe them, so we can enforce Josh's
 * rule — never pay a cleaner until they've invoiced us AND it matches.
 *
 * The "what we owe" figure reuses buildSubcontractorPayLedger (the same math the
 * payables screen uses) so the comparison can never disagree with Payables.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { buildSubcontractorPayLedger, type PayLedgerJob } from '@/lib/payout-calculator'

type DbClient = typeof prisma | Prisma.TransactionClient

export type ReconcileStatus = 'MATCHED' | 'MISMATCH'

const CENTS = 0.005

/** A claim matches when it equals the computed owed to the cent. */
export function reconcileStatus(claimedAmount: number, computedOwed: number): ReconcileStatus {
  return Math.abs(claimedAmount - computedOwed) < CENTS ? 'MATCHED' : 'MISMATCH'
}

/** UTC month bounds for a "yyyy-MM" period. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
  }
}

/**
 * What we currently owe this cleaner for the given month — the unpaid total
 * across their cleans + add-ons that period, via the shared payout ledger.
 */
export async function computeOwedForCleanerPeriod(
  db: DbClient,
  subcontractorId: string,
  period: string,
): Promise<number> {
  const { start, end } = periodRange(period)
  const [jobs, assignedAddOns] = await Promise.all([
    db.job.findMany({
      where: {
        subcontractorId,
        status: { not: 'CANCELLED' },
        date: { gte: start, lte: end },
      },
      include: {
        location: { include: { client: true } },
        schedule: true,
        addOnServices: true,
      },
    }),
    db.addOnService.findMany({
      where: {
        subcontractorId,
        subcontractorPaid: false,
        OR: [
          { job: { date: { gte: start, lte: end } } },
          { jobId: null, createdAt: { gte: start, lte: end } },
        ],
      },
      select: {
        subcontractorRate: true,
        job: { select: { subcontractorId: true } },
        schedule: { select: { subcontractorId: true } },
      },
    }),
  ])
  const jobOwed = buildSubcontractorPayLedger(jobs as unknown as PayLedgerJob[]).totalOwed
  const assignedAddOnOwed = assignedAddOns.reduce((sum, addOn) => {
    const owner = addOn.job?.subcontractorId ?? addOn.schedule?.subcontractorId ?? null
    return owner === subcontractorId ? sum : sum + addOn.subcontractorRate
  }, 0)
  return jobOwed + assignedAddOnOwed
}
