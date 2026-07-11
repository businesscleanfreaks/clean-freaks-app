import { endOfDay, startOfDay, subDays } from 'date-fns'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { calculateScheduleDates, previewScheduleChanges, diffScheduleChange } from '@/lib/regenerate-schedule-jobs'
import { changeScheduleGoingForwardSchema } from '@/lib/validations'
import { parseDateOnly, parseDateOnlyForStorage } from '@/lib/date-only'

type OverlapLike = {
  startDate: Date
  endDate: Date | null
}

function rangesOverlap(
  left: OverlapLike,
  right: OverlapLike
) {
  const leftStart = startOfDay(parseDateOnly(left.startDate)!)
  const rightStart = startOfDay(parseDateOnly(right.startDate)!)
  const leftEnd = left.endDate ? endOfDay(parseDateOnly(left.endDate)!) : null
  const rightEnd = right.endDate ? endOfDay(parseDateOnly(right.endDate)!) : null

  if (leftEnd && leftEnd < rightStart) return false
  if (rightEnd && rightEnd < leftStart) return false
  return true
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth()

    const body = await request.json()
    const validationResult = changeScheduleGoingForwardSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    const existingSchedule = await prisma.schedule.findUnique({
      where: { id: params.id },
      include: {
        recurringAddOnServices: {
          where: { isRecurring: true },
        },
      },
    })

    if (!existingSchedule) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      )
    }

    const {
      carryForwardRecurringAddOns,
      locationId: _ignoredLocationId,
      ...newScheduleData
    } = validationResult.data

    const newStartDate = startOfDay(parseDateOnly(newScheduleData.startDate)!)
    const currentStartDate = startOfDay(parseDateOnly(existingSchedule.startDate)!)
    const today = startOfDay(new Date())

    if (newStartDate < today) {
      return NextResponse.json(
        { error: 'Start date for a future change must be today or later.' },
        { status: 400 }
      )
    }

    if (newStartDate < currentStartDate) {
      return NextResponse.json(
        { error: 'Start date must be on or after the current schedule start date.' },
        { status: 400 }
      )
    }

    // Per-date diff (added / removed / modified / kept) for the modal preview.
    const dateDiff = await diffScheduleChange(existingSchedule.id, {
      frequency: newScheduleData.frequency,
      daysOfWeek: newScheduleData.daysOfWeek ?? null,
      monthlyPattern: newScheduleData.monthlyPattern ?? null,
      startDate: newScheduleData.startDate,
      endDate: newScheduleData.endDate ?? null,
      defaultClientRate: newScheduleData.defaultClientRate,
      defaultSubcontractorRate: newScheduleData.defaultSubcontractorRate,
      subcontractorId: newScheduleData.subcontractorId ?? null,
      timeType: newScheduleData.timeType,
      startTime: newScheduleData.startTime ?? null,
      startWindowBegin: newScheduleData.startWindowBegin ?? null,
      startWindowEnd: newScheduleData.startWindowEnd ?? null,
    })

    // ── Same-start-date: preview an in-place update ─────────────────────────
    const isSameStartDate = newStartDate.getTime() === currentStartDate.getTime()

    if (isSameStartDate) {
      const persistedEndDate = parseDateOnlyForStorage(newScheduleData.endDate)

      if (persistedEndDate && startOfDay(persistedEndDate) < newStartDate) {
        return NextResponse.json(
          { error: 'The new schedule end date cannot be before its start date.' },
          { status: 400 }
        )
      }

      const candidateDates = calculateScheduleDates({
        frequency: newScheduleData.frequency,
        startDate: newStartDate,
        endDate: persistedEndDate ?? existingSchedule.endDate,
        daysOfWeek: newScheduleData.daysOfWeek ?? null,
        monthlyPattern: newScheduleData.monthlyPattern ?? null,
        customDates: newScheduleData.customDates ?? null,
        excludedDates: existingSchedule.excludedDates,
      })

      const today = startOfDay(new Date())
      let futureJobsToCreate = 0
      let firstNewJobDate: string | null = null
      let lastNewJobDate: string | null = null

      if (candidateDates.length > 0) {
        const futureDates = candidateDates.filter((d) => d >= today).sort((a, b) => a.getTime() - b.getTime())
        futureJobsToCreate = futureDates.length
        firstNewJobDate = futureDates[0]?.toISOString().split('T')[0] ?? null
        lastNewJobDate = futureDates[futureDates.length - 1]?.toISOString().split('T')[0] ?? null
      }

      return NextResponse.json({
        preview: {
          oldScheduleEndDate: null,
          futureOldJobsRemoved: 0,
          futureProtectedJobsCount: 0,
          futureJobsToCreate,
          futureJobsSkipped: 0,
          firstNewJobDate,
          lastNewJobDate,
          recurringAddOnsToCarry: 0,
          overlappingScheduleCount: 0,
          inPlaceUpdate: true,
        },
        dateDiff,
      })
    }

    const persistedEndDate = parseDateOnlyForStorage(newScheduleData.endDate)

    if (persistedEndDate && startOfDay(persistedEndDate) < newStartDate) {
      return NextResponse.json(
        { error: 'The new schedule end date cannot be before its start date.' },
        { status: 400 }
      )
    }

    const requestedOldEndDate = subDays(newStartDate, 1)
    const existingEndDate = existingSchedule.endDate
      ? startOfDay(parseDateOnly(existingSchedule.endDate)!)
      : null
    const oldScheduleEndDate = existingEndDate && existingEndDate < requestedOldEndDate
      ? existingEndDate
      : requestedOldEndDate

    const [futureProtectedJobsCount, oldSchedulePreview, overlappingSchedules] = await Promise.all([
      prisma.job.count({
        where: {
          scheduleId: existingSchedule.id,
          date: { gte: newStartDate },
          OR: [
            { invoiced: true },
            { subcontractorPaid: true },
            { status: 'CANCELLED' },
            { invoiceLineItems: { some: { invoice: { status: 'DRAFT' } } } },
          ],
        },
      }),
      previewScheduleChanges(existingSchedule.id, {
        endDate: oldScheduleEndDate.toISOString(),
      }),
      prisma.schedule.findMany({
        where: {
          locationId: existingSchedule.locationId,
          id: { not: existingSchedule.id },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
        },
      }),
    ])

    const candidateDates = calculateScheduleDates({
      frequency: newScheduleData.frequency,
      startDate: newStartDate,
      endDate: persistedEndDate ?? null,
      daysOfWeek: newScheduleData.daysOfWeek ?? null,
      monthlyPattern: newScheduleData.monthlyPattern ?? null,
      customDates: newScheduleData.customDates ?? null,
      excludedDates: existingSchedule.excludedDates,
    })

    let futureJobsToCreate = 0
    let futureJobsSkipped = 0
    let firstNewJobDate: string | null = null
    let lastNewJobDate: string | null = null

    if (candidateDates.length > 0) {
      const existingJobs = await prisma.job.findMany({
        where: {
          locationId: existingSchedule.locationId,
          date: { in: candidateDates },
          status: { not: 'CANCELLED' },
        },
        select: { date: true },
      })

      const existingDates = new Set(existingJobs.map((job) => job.date.getTime()))
      const futureDates = candidateDates.filter((date) => date >= today).sort((a, b) => a.getTime() - b.getTime())

      futureJobsSkipped = futureDates.filter((date) => existingDates.has(date.getTime())).length
      futureJobsToCreate = futureDates.length - futureJobsSkipped
      firstNewJobDate = futureDates[0]?.toISOString().split('T')[0] ?? null
      lastNewJobDate = futureDates[futureDates.length - 1]?.toISOString().split('T')[0] ?? null
    }

    const overlappingScheduleCount = overlappingSchedules.filter((schedule) =>
      rangesOverlap(
        {
          startDate: newStartDate,
          endDate: persistedEndDate ?? null,
        },
        schedule
      )
    ).length

    return NextResponse.json({
      preview: {
        oldScheduleEndDate: oldScheduleEndDate.toISOString(),
        futureOldJobsRemoved: oldSchedulePreview.deletedCount,
        futureProtectedJobsCount,
        futureJobsToCreate,
        futureJobsSkipped,
        firstNewJobDate,
        lastNewJobDate,
        recurringAddOnsToCarry: carryForwardRecurringAddOns
          ? existingSchedule.recurringAddOnServices.length
          : 0,
        overlappingScheduleCount,
      },
      dateDiff,
    })
  } catch (error) {
    logger.error('Error previewing future schedule change:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to preview future schedule change'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
