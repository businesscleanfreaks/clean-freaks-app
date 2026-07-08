import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { authorizeCron } from '@/lib/cron-auth'
import { alertOperationalIssue } from '@/lib/error-alerting'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // Auto-complete jobs in the past that are still scheduled
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = await prisma.job.updateMany({
      where: {
        date: {
          lt: today,
        },
        status: 'SCHEDULED',
      },
      data: {
        status: 'COMPLETED',
      },
    })

    return NextResponse.json({ 
      success: true,
      message: `Auto-completed ${result.count} past job(s)`,
      count: result.count
    })
  } catch (error) {
    logger.error('Error auto-completing jobs:', error)
    await alertOperationalIssue('cron:auto-complete failed', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to auto-complete jobs'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

export const GET = POST
