import { NextResponse } from 'next/server'
import { ensureJobsForDateRange } from '@/lib/regenerate-schedule-jobs'
import { logger } from '@/lib/logger'
import { authorizeCron } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/auto-generate
 *
 * Nightly self-check: additively reconcile every active schedule from the start
 * of the current month through ~3 months ahead, so cleans exist — and stay
 * correct — even for periods nobody has opened.
 *
 * ADDITIVE ONLY: it fills missing cleans and repairs times; it never deletes,
 * so a legitimately-added extra clean is preserved. (Stale removal stays in
 * regenerateJobsForSchedule, which runs at schedule-change time where the old
 * vs new pattern is known.) Invoked by Vercel Cron (vercel.json); guarded by
 * CRON_SECRET.
 */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59)

    const summary = await ensureJobsForDateRange({ startDate, endDate })

    logger.info('[auto-generate] Nightly reconcile complete', summary)

    return NextResponse.json({
      success: true,
      message: `Reconciled ${summary.schedulesChecked} schedule(s); created ${summary.createdCount}, repaired ${summary.repairedCount}`,
      ...summary,
    })
  } catch (error) {
    logger.error('Error in nightly auto-generate reconcile:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to auto-generate jobs'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

export const GET = POST
