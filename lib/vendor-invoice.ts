/**
 * Vendor-invoice reconciliation: compare what a vendor bills us for a period
 * against what Payables independently says we owe them.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { periodRange, reconcileStatus, type ReconcileStatus } from '@/lib/cleaner-invoice'

type DbClient = typeof prisma | Prisma.TransactionClient

export { reconcileStatus, periodRange }
export type { ReconcileStatus }

/**
 * What we currently owe this vendor for the given month: unpaid vendor add-ons
 * plus unpaid vendor-performed one-off jobs for that period.
 */
export async function computeOwedForVendorPeriod(
  db: DbClient,
  vendorId: string,
  period: string,
): Promise<number> {
  const { start, end } = periodRange(period)
  const [addOns, jobs] = await Promise.all([
    db.addOnService.findMany({
      where: {
        vendorId,
        vendorPaid: false,
        OR: [
          { job: { date: { gte: start, lte: end } } },
          { jobId: null, createdAt: { gte: start, lte: end } },
        ],
      },
      select: { subcontractorRate: true },
    }),
    db.job.findMany({
      where: {
        vendorId,
        vendorPaid: false,
        scheduleId: null,
        status: { not: 'CANCELLED' },
        date: { gte: start, lte: end },
      },
      select: { subcontractorRate: true },
    }),
  ])

  return (
    addOns.reduce((sum, addOn) => sum + addOn.subcontractorRate, 0) +
    jobs.reduce((sum, job) => sum + job.subcontractorRate, 0)
  )
}
