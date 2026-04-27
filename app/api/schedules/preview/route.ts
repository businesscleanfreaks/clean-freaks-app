import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { previewScheduleChanges } from '@/lib/regenerate-schedule-jobs'
import { logger, getErrorMessage } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    await requireAuth()

    const body = await request.json()
    const { scheduleId, updates } = body

    if (!scheduleId || typeof scheduleId !== 'string') {
      return NextResponse.json(
        { error: 'scheduleId is required' },
        { status: 400 }
      )
    }

    const preview = await previewScheduleChanges(scheduleId, updates || {})

    return NextResponse.json({ success: true, preview })
  } catch (error) {
    logger.error('Error previewing schedule changes:', error)
    const message = getErrorMessage(error)
    if (message === 'Authentication required') {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    return NextResponse.json(
      { error: 'Failed to preview schedule changes' },
      { status: 500 }
    )
  }
}
