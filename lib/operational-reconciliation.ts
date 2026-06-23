import { logger } from '@/lib/logger'
import {
  ensureJobsForDateRange,
  type EnsureJobsForDateRangeSummary,
} from '@/lib/regenerate-schedule-jobs'

export type OperationalReconciliationSurface =
  | 'calendar'
  | 'jobs'
  | 'invoices'
  | 'dashboard'
  | 'payables'

export async function ensureOperationalDataForDateRange({
  startDate,
  endDate,
  surface,
}: {
  startDate: Date
  endDate: Date
  surface: OperationalReconciliationSurface
}): Promise<EnsureJobsForDateRangeSummary> {
  const summary = await ensureJobsForDateRange({ startDate, endDate })

  if (summary.createdCount || summary.repairedCount) {
    logger.info('[operational-reconciliation] Reconciled schedule jobs before read', {
      surface,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...summary,
    })
  }

  return summary
}
