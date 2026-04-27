import { prisma } from '@/lib/db'
import { addDays, addMonths, startOfDay, startOfMonth, endOfMonth, getDay, setDate } from 'date-fns'
import { logger } from '@/lib/logger'

export interface RegenerationSummary {
  deletedCount: number
  updatedCount: number
  createdCount: number
  protectedCount: number
  skippedCount: number
  firstJobDate: string | null
  lastJobDate: string | null
}

export interface ScheduleDateParams {
  frequency: string
  startDate: Date
  endDate?: Date | string | null
  daysOfWeek: string | null
  monthlyPattern: string | null
  customDates: string | null
  excludedDates: string | null
}

const WEEK_INTERVALS: Record<string, number> = {
  WEEKLY: 1,
  BI_WEEKLY: 2,
  EVERY_3_WEEKS: 3,
  EVERY_4_WEEKS: 4,
  EVERY_6_WEEKS: 6,
}

function toNoonUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date | null {
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = endOfMonth(firstOfMonth)
  let count = 0
  let current = new Date(firstOfMonth)
  while (current <= lastOfMonth) {
    if (getDay(current) === weekday) {
      count++
      if (count === nth) return current
    }
    current = addDays(current, 1)
  }
  return null
}

/**
 * Calculate all candidate job dates for a schedule's parameters.
 * Pure function — no database access.
 * @param rangeEnd Optional end date. Defaults to 3 months from now.
 *   Pass a custom date to project further into the future (e.g. for P&L forecasts).
 */
export function calculateScheduleDates(params: ScheduleDateParams, rangeEnd?: Date): Date[] {
  const now = startOfDay(new Date())
  const startDate = startOfDay(new Date(params.startDate))
  const projectedEndDate = rangeEnd ? startOfDay(rangeEnd) : addMonths(now, 3)
  const scheduleEndDate = params.endDate ? startOfDay(new Date(params.endDate)) : null
  const endDate = scheduleEndDate && scheduleEndDate < projectedEndDate ? scheduleEndDate : projectedEndDate
  const dates: Date[] = []

  if (endDate < startDate) {
    return []
  }

  const weekInterval = WEEK_INTERVALS[params.frequency]

  if (weekInterval) {
    const daysOfWeek = params.daysOfWeek ? JSON.parse(params.daysOfWeek) : []
    let currentDate = new Date(startDate)
    let weekCount = 0

    while (currentDate <= endDate) {
      if (weekCount % weekInterval === 0 && daysOfWeek.includes(currentDate.getDay())) {
        dates.push(new Date(currentDate))
      }
      const nextDay = addDays(currentDate, 1)
      if (nextDay.getDay() === 0 && currentDate.getDay() === 6) weekCount++
      currentDate = nextDay
    }
  } else if (params.frequency === 'MONTHLY') {
    const dayOfMonth = startDate.getDate()
    let currentMonth = startOfMonth(startDate)
    while (currentMonth <= endDate) {
      const daysInMonth = endOfMonth(currentMonth).getDate()
      const targetDay = Math.min(dayOfMonth, daysInMonth)
      const jobDate = setDate(currentMonth, targetDay)
      if (jobDate >= startDate && jobDate <= endDate) dates.push(startOfDay(jobDate))
      currentMonth = addMonths(currentMonth, 1)
    }
  } else if (params.frequency === '2X_MONTHLY' && params.monthlyPattern) {
    const pattern = JSON.parse(params.monthlyPattern)
    if (pattern.type === 'FIXED_DATES') {
      const fixedDates = pattern.dates as number[]
      let currentMonth = startOfMonth(startDate)
      while (currentMonth <= endDate) {
        for (const dayOfMonth of fixedDates) {
          const daysInMonth = endOfMonth(currentMonth).getDate()
          if (dayOfMonth <= daysInMonth) {
            const jobDate = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth(), dayOfMonth, 12, 0, 0))
            if (jobDate >= startDate && jobDate <= endDate) dates.push(startOfDay(jobDate))
          }
        }
        currentMonth = addMonths(currentMonth, 1)
      }
    } else if (pattern.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday as number
      const weeks = pattern.weeks as number[]
      let currentMonth = startOfMonth(startDate)
      while (currentMonth <= endDate) {
        for (const weekNum of weeks) {
          const jobDate = getNthWeekdayOfMonth(currentMonth.getFullYear(), currentMonth.getMonth(), weekday, weekNum)
          if (jobDate && jobDate >= startDate && jobDate <= endDate) dates.push(startOfDay(jobDate))
        }
        currentMonth = addMonths(currentMonth, 1)
      }
    }
  } else if (params.frequency === 'CUSTOM' && params.customDates) {
    const customDateStrs = JSON.parse(params.customDates)
    customDateStrs.forEach((dateStr: string) => {
      const date = startOfDay(new Date(dateStr))
      if (date <= endDate) dates.push(date)
    })
  }

  const excludedDates: string[] = params.excludedDates ? JSON.parse(params.excludedDates) : []

  return dates
    .filter((date) => {
      if (date < startDate) return false
      const dateStr = date.toISOString().split('T')[0]
      return !excludedDates.includes(dateStr)
    })
    .map((date) => toNoonUTC(date))
}

/**
 * Preview what would happen if a schedule were regenerated.
 * Returns counts without making any changes.
 */
export async function previewScheduleChanges(
  scheduleId: string,
  updates?: Record<string, unknown>
): Promise<RegenerationSummary> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { location: { include: { client: true } } },
  })

  if (!schedule) {
    return { deletedCount: 0, updatedCount: 0, createdCount: 0, protectedCount: 0, skippedCount: 0, firstJobDate: null, lastJobDate: null }
  }

  // Merge updates with current schedule to simulate the change
  const merged = { ...schedule, ...updates }
  const now = startOfDay(new Date())
  const startDate = startOfDay(new Date(merged.startDate))

  // Count protected jobs
  const protectedCount = await prisma.job.count({
    where: {
      scheduleId,
      OR: [{ invoiced: true }, { subcontractorPaid: true }, { status: 'CANCELLED' }],
    },
  })

  const draftInvoiceCount = await prisma.job.count({
    where: {
      scheduleId,
      invoiceLineItems: { some: { invoice: { status: 'DRAFT' } } },
    },
  })

  const totalProtected = protectedCount + draftInvoiceCount

  // Count jobs that would be deleted (past pre-start + future scheduled)
  const pastDeleteCount = await prisma.job.count({
    where: {
      scheduleId,
      date: { lt: startDate },
      invoiced: false,
      subcontractorPaid: false,
      status: { not: 'CANCELLED' },
    },
  })

  const futureDeleteCount = await prisma.job.count({
    where: {
      scheduleId,
      date: { gte: now },
      status: 'SCHEDULED',
      invoiced: false,
      subcontractorPaid: false,
    },
  })

  // Count future jobs that would be updated (subcontractor/rate change)
  const updateCount = await prisma.job.count({
    where: {
      scheduleId,
      subcontractorPaid: false,
      invoiced: false,
      date: { gte: now },
      status: { not: 'CANCELLED' },
    },
  })

  // Calculate what dates the new schedule would generate
  const candidateDates = calculateScheduleDates({
    frequency: String(merged.frequency),
    startDate: new Date(merged.startDate),
    daysOfWeek: merged.daysOfWeek ?? null,
    monthlyPattern: merged.monthlyPattern ?? null,
    customDates: merged.customDates ?? null,
    excludedDates: merged.excludedDates ?? null,
    endDate: merged.endDate ?? null,
  })

  // Check which dates already have jobs at this location
  let skippedCount = 0
  let createdCount = 0

  if (candidateDates.length > 0) {
    const existingJobs = await prisma.job.findMany({
      where: {
        locationId: schedule.locationId,
        date: { in: candidateDates },
        status: { not: 'CANCELLED' },
      },
      select: { date: true },
    })
    const existingDates = new Set(existingJobs.map(j => j.date.getTime()))

    for (const date of candidateDates) {
      if (existingDates.has(date.getTime())) {
        skippedCount++
      } else {
        createdCount++
      }
    }
  }

  // Date range
  const futureDates = candidateDates.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime())
  const firstJobDate = futureDates.length > 0 ? futureDates[0].toISOString().split('T')[0] : null
  const lastJobDate = futureDates.length > 0 ? futureDates[futureDates.length - 1].toISOString().split('T')[0] : null

  return {
    deletedCount: pastDeleteCount + futureDeleteCount,
    updatedCount: Math.max(0, updateCount - futureDeleteCount), // don't double-count deleted ones
    createdCount,
    protectedCount: totalProtected,
    skippedCount,
    firstJobDate,
    lastJobDate,
  }
}

export async function regenerateJobsForSchedule(scheduleId: string): Promise<RegenerationSummary> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      location: {
        include: { client: true },
      },
    },
  })

  const emptySummary: RegenerationSummary = {
    deletedCount: 0, updatedCount: 0, createdCount: 0,
    protectedCount: 0, skippedCount: 0,
    firstJobDate: null, lastJobDate: null,
  }

  if (!schedule || !schedule.isActive) {
    logger.debug(`[regenerateJobs] Schedule ${scheduleId} is inactive or not found`)
    return emptySummary
  }

  const now = startOfDay(new Date())
  const startDate = startOfDay(new Date(schedule.startDate))

  // Wrap all delete/update/create operations in a transaction so a crash
  // mid-way doesn't leave the schedule in a broken state
  const summary = await prisma.$transaction(async (tx) => {
    const protectedJobs = await tx.job.findMany({
      where: {
        scheduleId,
        OR: [{ invoiced: true }, { subcontractorPaid: true }, { status: 'CANCELLED' }],
      },
      include: {
        invoiceLineItems: {
          include: { invoice: { select: { id: true, status: true } } },
        },
      },
    })

    const jobsInDraftInvoices = await tx.job.findMany({
      where: {
        scheduleId,
        invoiceLineItems: { some: { invoice: { status: 'DRAFT' } } },
      },
      select: { id: true },
    })

    const protectedJobIds = new Set([
      ...protectedJobs.map(j => j.id),
      ...jobsInDraftInvoices.map(j => j.id),
    ])

    const protectedCount = protectedJobIds.size
    logger.debug(`[regenerateJobs] Found ${protectedCount} protected jobs for schedule ${scheduleId}`)

    const pastDeleted = await tx.job.deleteMany({
      where: {
        scheduleId,
        date: { lt: startDate },
        id: { notIn: Array.from(protectedJobIds) },
      },
    })

    const futureDeleted = await tx.job.deleteMany({
      where: {
        scheduleId,
        date: { gte: now },
        status: 'SCHEDULED',
        invoiced: false,
        subcontractorPaid: false,
        id: { notIn: Array.from(protectedJobIds) },
      },
    })

    const deletedCount = pastDeleted.count + futureDeleted.count

    // Only update FUTURE jobs with the new subcontractor/rate.
    // Past completed jobs keep their original subcontractor assignment
    // so the owed-money calculation stays accurate.
    const updated = await tx.job.updateMany({
      where: { scheduleId, subcontractorPaid: false, invoiced: false, date: { gte: now } },
      data: {
        subcontractorId: schedule.subcontractorId,
        subcontractorRate: schedule.defaultSubcontractorRate,
      },
    })

    // Calculate candidate dates using the shared helper
    const candidateDates = calculateScheduleDates({
      frequency: schedule.frequency,
      startDate: new Date(schedule.startDate),
      daysOfWeek: schedule.daysOfWeek,
      monthlyPattern: schedule.monthlyPattern,
      customDates: schedule.customDates,
      excludedDates: schedule.excludedDates,
      endDate: schedule.endDate,
    })

    let createdCount = 0
    let skippedCount = 0

    if (candidateDates.length > 0) {
      // Find which dates already have jobs for this LOCATION (not just
      // this schedule). This prevents duplicates when a location has
      // multiple schedules covering the same dates.
      const existingJobs = await tx.job.findMany({
        where: { locationId: schedule.locationId, date: { in: candidateDates }, status: { not: 'CANCELLED' } },
        select: { date: true },
      })
      const existingDates = new Set(existingJobs.map((j) => j.date.getTime()))

      const jobsToCreate = candidateDates
        .filter((date) => {
          if (existingDates.has(date.getTime())) {
            skippedCount++
            return false
          }
          return true
        })
        .map((date) => ({
          locationId: schedule.locationId,
          subcontractorId: schedule.subcontractorId,
          scheduleId,
          date,
          startTime: schedule.timeType === 'SPECIFIC' ? schedule.startTime : null,
          startWindowBegin: schedule.timeType === 'WINDOW' ? schedule.startWindowBegin : null,
          startWindowEnd: schedule.timeType === 'WINDOW' ? schedule.startWindowEnd : null,
          clientRate: schedule.defaultClientRate,
          subcontractorRate: schedule.defaultSubcontractorRate,
        }))

      if (jobsToCreate.length > 0) {
        const result = await tx.job.createMany({ data: jobsToCreate })
        createdCount = result.count
        logger.debug(`[regenerateJobs] Created ${result.count} new jobs for schedule ${scheduleId}`)
      } else {
        logger.debug(`[regenerateJobs] All dates already have jobs for schedule ${scheduleId}`)
      }
    } else {
      logger.debug(`[regenerateJobs] No new jobs to create for schedule ${scheduleId}`)
    }

    // Calculate date range for summary
    const futureDates = candidateDates.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime())
    const firstJobDate = futureDates.length > 0 ? futureDates[0].toISOString().split('T')[0] : null
    const lastJobDate = futureDates.length > 0 ? futureDates[futureDates.length - 1].toISOString().split('T')[0] : null

    return {
      deletedCount,
      updatedCount: updated.count,
      createdCount,
      protectedCount,
      skippedCount,
      firstJobDate,
      lastJobDate,
    }
  })

  return summary
}
