import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { logger } from '@/lib/logger'

/**
 * POST /api/jobs/auto-generate
 *
 * Regenerates jobs for all active schedules to ensure Job records
 * exist for the next 3 months. Called on dashboard load (once per session)
 * to keep the calendar and other job-dependent features current.
 */
export async function POST() {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    let totalCreated = 0

    for (const schedule of schedules) {
      const summary = await regenerateJobsForSchedule(schedule.id)
      totalCreated += summary.createdCount
    }

    logger.debug(`[auto-generate] Regenerated ${schedules.length} schedules, created ${totalCreated} new jobs`)

    return NextResponse.json({
      success: true,
      message: `Processed ${schedules.length} schedules, created ${totalCreated} new job(s)`,
      schedulesProcessed: schedules.length,
      jobsCreated: totalCreated,
    })
  } catch (error) {
    logger.error('Error auto-generating jobs:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to auto-generate jobs'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
