import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { startOfDay } from 'date-fns'
import { logger } from '@/lib/logger'

export async function POST() {
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
    const errorMessage = error instanceof Error ? error.message : 'Failed to auto-complete jobs'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

