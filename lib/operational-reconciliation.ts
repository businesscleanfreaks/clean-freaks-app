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

/**
 * Repeat reconciliations of the same range are skipped for this long.
 *
 * The pass is additive and, on a settled dataset, finds nothing to do while
 * still costing several seconds of database work — and it sits in front of
 * every read of the invoice workspace, calendar and dashboard. Without this,
 * simply switching months and back pays that cost again each time.
 *
 * Deliberately short: a stale window of a minute cannot lose data (the pass
 * only ever ADDS missing cleans), and any page load after it re-runs the pass.
 */
const RECONCILE_TTL_MS = 60_000

interface CachedRun { at: number; summary: EnsureJobsForDateRangeSummary }
const recentRuns = new Map<string, CachedRun>()

/** Drop the memo so the next read reconciles for real (call after writes). */
export function invalidateReconciliationCache(): void {
  recentRuns.clear()
}

export async function ensureOperationalDataForDateRange({
  startDate,
  endDate,
  surface,
  force = false,
}: {
  startDate: Date
  endDate: Date
  surface: OperationalReconciliationSurface
  /** Skip the memo — for paths that must see their own write immediately. */
  force?: boolean
}): Promise<EnsureJobsForDateRangeSummary> {
  const key = `${startDate.toISOString()}|${endDate.toISOString()}`
  const cached = recentRuns.get(key)
  if (!force && cached && Date.now() - cached.at < RECONCILE_TTL_MS) {
    return cached.summary
  }

  const summary = await ensureJobsForDateRange({ startDate, endDate })
  recentRuns.set(key, { at: Date.now(), summary })

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
