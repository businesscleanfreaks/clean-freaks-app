import { NextResponse } from 'next/server'
import { z } from 'zod'
import { addDays, subDays, startOfDay } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { revalidateSchedulePages } from '@/lib/revalidate'
import { triggerSystemRefresh } from '@/lib/cascading-updates'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { parseDateOnly, parseDateOnlyForStorage } from '@/lib/date-only'

const pauseSchema = z.object({
  pauseFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pause start must be YYYY-MM-DD'),
  pauseTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  indefinite: z.boolean().optional().default(false),
  carryForwardRecurringAddOns: z.boolean().optional().default(true),
})

/**
 * Pause a schedule over a date range. Models the pause as the interval model
 * already does: the current schedule ends the day before the pause; for a finite
 * pause a copy resumes the day after. Job regeneration then clears the paused
 * cleans (protected/invoiced ones stay) and rebuilds the resumed ones.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAuth()
    const parsed = pauseSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const { pauseFrom, pauseTo, indefinite, carryForwardRecurringAddOns } = parsed.data

    const schedule = await prisma.schedule.findUnique({
      where: { id: params.id },
      include: {
        location: { include: { client: true } },
        recurringAddOnServices: { where: { isRecurring: true } },
      },
    })
    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

    const today = startOfDay(new Date())
    const pauseFromLocal = startOfDay(parseDateOnly(pauseFrom)!)
    if (pauseFromLocal < today) {
      return NextResponse.json({ error: 'Pause start must be today or later.' }, { status: 400 })
    }
    if (!indefinite && !pauseTo) {
      return NextResponse.json({ error: 'Provide a pause end date, or mark the pause indefinite.' }, { status: 400 })
    }
    if (pauseTo && startOfDay(parseDateOnly(pauseTo)!) < pauseFromLocal) {
      return NextResponse.json({ error: 'Pause end cannot be before pause start.' }, { status: 400 })
    }

    // Stored as UTC-noon (what job regeneration reads back consistently).
    const pauseFromStorage = parseDateOnlyForStorage(pauseFrom)!
    const newOldEnd = subDays(pauseFromStorage, 1)
    const existingEnd = schedule.endDate ? parseDateOnlyForStorage(schedule.endDate) : null
    // Never extend a schedule that already ends before the pause.
    const oldEndDate = existingEnd && existingEnd < newOldEnd ? existingEnd : newOldEnd

    let resumeScheduleId: string | null = null

    await prisma.$transaction(async (tx) => {
      await tx.schedule.update({ where: { id: schedule.id }, data: { endDate: oldEndDate } })

      if (!indefinite && pauseTo) {
        const resumeStart = addDays(parseDateOnlyForStorage(pauseTo)!, 1)
        const resume = await tx.schedule.create({
          data: {
            locationId: schedule.locationId,
            frequency: schedule.frequency,
            daysOfWeek: schedule.daysOfWeek,
            monthlyPattern: schedule.monthlyPattern,
            customDates: schedule.customDates,
            startDate: resumeStart,
            endDate: existingEnd ?? null, // resume keeps the schedule's original end, if any
            defaultClientRate: schedule.defaultClientRate,
            defaultSubcontractorRate: schedule.defaultSubcontractorRate,
            clientPayType: schedule.clientPayType,
            subcontractorPayType: schedule.subcontractorPayType,
            subcontractorId: schedule.subcontractorId,
            timeType: schedule.timeType,
            startTime: schedule.startTime,
            startWindowBegin: schedule.startWindowBegin,
            startWindowEnd: schedule.startWindowEnd,
            isActive: true,
            excludedDates: schedule.excludedDates,
          },
        })
        resumeScheduleId = resume.id

        if (carryForwardRecurringAddOns && schedule.recurringAddOnServices.length > 0) {
          await tx.addOnService.createMany({
            data: schedule.recurringAddOnServices.map((a) => ({
              scheduleId: resume.id,
              description: a.description,
              clientRate: a.clientRate,
              subcontractorRate: a.subcontractorRate,
              frequency: a.frequency,
              isRecurring: true,
            })),
          })
        }
      }
    })

    await regenerateJobsForSchedule(schedule.id)
    if (resumeScheduleId) await regenerateJobsForSchedule(resumeScheduleId)

    revalidateSchedulePages(schedule.location.client.id)
    await triggerSystemRefresh()

    return NextResponse.json({
      success: true,
      pausedScheduleId: schedule.id,
      resumeScheduleId,
      indefinite: !!indefinite,
    })
  } catch (error) {
    logger.error('Error pausing schedule:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to pause schedule' },
      { status: 500 },
    )
  }
}
