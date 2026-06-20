import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { hasFinalInvoice } from '@/lib/invoice-status'

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

export interface EnsureJobsForDateRangeSummary {
  schedulesChecked: number
  createdCount: number
  repairedCount: number
  skippedCount: number
}

const WEEK_INTERVALS: Record<string, number> = {
  WEEKLY: 1,
  BI_WEEKLY: 2,
  EVERY_3_WEEKS: 3,
  EVERY_4_WEEKS: 4,
  EVERY_6_WEEKS: 6,
}

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0))
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12, 0, 0))
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12, 0, 0))
}

function utcDayOfMonth(monthDate: Date, dayOfMonth: number): Date {
  const daysInMonth = endOfUtcMonth(monthDate).getUTCDate()
  const targetDay = Math.min(dayOfMonth, daysInMonth)
  return new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), targetDay, 12, 0, 0))
}

function parseUtcDateOnly(value: Date | string): Date {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) {
      const [, year, month, day] = match
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
    }
  }

  return utcDateOnly(new Date(value))
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date | null {
  const firstOfMonth = new Date(Date.UTC(year, month, 1, 12, 0, 0))
  const lastOfMonth = endOfUtcMonth(firstOfMonth)
  let count = 0
  let current = new Date(firstOfMonth)
  while (current <= lastOfMonth) {
    if (current.getUTCDay() === weekday) {
      count++
      if (count === nth) return current
    }
    current = addUtcDays(current, 1)
  }
  return null
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date | null {
  const lastOfMonth = endOfUtcMonth(new Date(Date.UTC(year, month, 1, 12, 0, 0)))
  let current = new Date(lastOfMonth)
  for (let i = 0; i < 7; i++) {
    if (current.getUTCDay() === weekday) return current
    current = addUtcDays(current, -1)
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
  const now = utcDateOnly(new Date())
  const startDate = parseUtcDateOnly(params.startDate)
  const projectedEndDate = rangeEnd ? utcDateOnly(rangeEnd) : addUtcMonths(now, 3)
  const scheduleEndDate = params.endDate ? parseUtcDateOnly(params.endDate) : null
  const endDate = scheduleEndDate && scheduleEndDate < projectedEndDate ? scheduleEndDate : projectedEndDate
  const dates: Date[] = []

  if (endDate < startDate) {
    return []
  }

  const weekInterval = WEEK_INTERVALS[params.frequency]

  if (weekInterval) {
    const parsedDaysOfWeek = params.daysOfWeek ? JSON.parse(params.daysOfWeek) : []
    const daysOfWeek = parsedDaysOfWeek.length > 0 ? parsedDaysOfWeek : [startDate.getUTCDay()]
    let currentDate = new Date(startDate)
    let weekCount = 0

    while (currentDate <= endDate) {
      if (weekCount % weekInterval === 0 && daysOfWeek.includes(currentDate.getUTCDay())) {
        dates.push(new Date(currentDate))
      }
      const nextDay = addUtcDays(currentDate, 1)
      if (nextDay.getUTCDay() === 0 && currentDate.getUTCDay() === 6) weekCount++
      currentDate = nextDay
    }
  } else if (params.frequency === 'MONTHLY' && params.monthlyPattern) {
    // MONTHLY with NTH_WEEKDAY pattern (e.g., "1st Tuesday" or "1st & 3rd Tuesday")
    const pattern = JSON.parse(params.monthlyPattern)
    if (pattern.type === 'FIXED_DATES' && Array.isArray(pattern.dates) && pattern.dates.length > 0) {
      const dayOfMonth = pattern.dates[0] as number
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        const jobDate = utcDayOfMonth(currentMonth, dayOfMonth)
        if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    } else if (pattern.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday as number
      const ordinals = pattern.weeks as (number | 'last')[]
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        for (const ordinal of ordinals) {
          const jobDate = ordinal === 'last'
            ? getLastWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday)
            : getNthWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday, ordinal as number)
          if (jobDate && jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        }
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    } else {
      // MONTHLY without NTH_WEEKDAY — fixed day of month (original behavior)
      const dayOfMonth = startDate.getUTCDate()
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        const jobDate = utcDayOfMonth(currentMonth, dayOfMonth)
        if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    }
  } else if (params.frequency === 'MONTHLY') {
    const dayOfMonth = startDate.getUTCDate()
    let currentMonth = startOfUtcMonth(startDate)
    while (currentMonth <= endDate) {
      const jobDate = utcDayOfMonth(currentMonth, dayOfMonth)
      if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
      currentMonth = addUtcMonths(currentMonth, 1)
    }
  } else if (params.frequency === '2X_MONTHLY' && params.monthlyPattern) {
    const pattern = JSON.parse(params.monthlyPattern)
    if (pattern.type === 'FIXED_DATES') {
      const fixedDates = pattern.dates as number[]
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        for (const dayOfMonth of fixedDates) {
          const daysInMonth = endOfUtcMonth(currentMonth).getUTCDate()
          if (dayOfMonth <= daysInMonth) {
            const jobDate = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), dayOfMonth, 12, 0, 0))
            if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
          }
        }
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    } else if (pattern.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday as number
      const ordinals = pattern.weeks as (number | 'last')[]
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        for (const ordinal of ordinals) {
          const jobDate = ordinal === 'last'
            ? getLastWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday)
            : getNthWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday, ordinal as number)
          if (jobDate && jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        }
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    }
  } else if (params.frequency === 'CUSTOM' && params.customDates) {
    const customDateStrs = JSON.parse(params.customDates)
    customDateStrs.forEach((dateStr: string) => {
      const date = parseUtcDateOnly(dateStr)
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
    .map((date) => utcDateOnly(date))
}

function getScheduleJobTimeFields(schedule: {
  timeType?: string | null
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
}) {
  if (schedule.timeType === 'WINDOW' && schedule.startWindowBegin) {
    return {
      startTime: null,
      startWindowBegin: schedule.startWindowBegin,
      startWindowEnd: schedule.startWindowEnd ?? null,
    }
  }

  if (schedule.timeType === 'SPECIFIC' && schedule.startTime) {
    return {
      startTime: schedule.startTime,
      startWindowBegin: null,
      startWindowEnd: null,
    }
  }

  return {
    startTime: null,
    startWindowBegin: null,
    startWindowEnd: null,
  }
}

function hasJobTime(job: { startTime?: string | null; startWindowBegin?: string | null }) {
  return Boolean(job.startTime || job.startWindowBegin)
}

function hasScheduleTime(schedule: {
  timeType?: string | null
  startTime?: string | null
  startWindowBegin?: string | null
}) {
  return Boolean(
    (schedule.timeType === 'SPECIFIC' && schedule.startTime) ||
    (schedule.timeType === 'WINDOW' && schedule.startWindowBegin)
  )
}

function dateMatchesSchedulePatternIgnoringStart(schedule: {
  frequency: string
  daysOfWeek?: string | null
}, date: Date) {
  const weeklyFrequencies = new Set(['WEEKLY', 'BI_WEEKLY', 'EVERY_3_WEEKS', 'EVERY_4_WEEKS', 'EVERY_6_WEEKS'])
  if (!weeklyFrequencies.has(schedule.frequency)) return false
  if (!schedule.daysOfWeek) return false
  try {
    const daysOfWeek = JSON.parse(schedule.daysOfWeek) as number[]
    return daysOfWeek.includes(date.getUTCDay())
  } catch {
    return false
  }
}

function getHistoricalScheduleStartDate(schedule: {
  startDate: Date
  location?: {
    client?: {
      startDate?: Date | null
    } | null
  } | null
}) {
  const scheduleStart = utcDateOnly(new Date(schedule.startDate))
  const clientStartValue = schedule.location?.client?.startDate
  if (!clientStartValue) return scheduleStart

  const clientStart = utcDateOnly(new Date(clientStartValue))
  return clientStart < scheduleStart ? clientStart : scheduleStart
}

export async function ensureJobsForDateRange({
  startDate,
  endDate,
}: {
  startDate: Date
  endDate: Date
}): Promise<EnsureJobsForDateRangeSummary> {
  const rangeStart = utcDateOnly(startDate)
  const rangeEnd = utcDateOnly(endDate)

  const [schedules, existingJobs] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [
              { startDate: { lte: rangeEnd } },
              { location: { client: { startDate: { lte: rangeEnd } } } },
            ],
          },
          {
            OR: [
              { endDate: null },
              { endDate: { gte: rangeStart } },
            ],
          },
        ],
      },
      include: {
        location: {
          select: {
            id: true,
            clientId: true,
            client: {
              select: {
                startDate: true,
              },
            },
          },
        },
      },
    }),
    prisma.job.findMany({
      where: {
        scheduleId: { not: null },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        id: true,
        scheduleId: true,
        date: true,
        startTime: true,
        startWindowBegin: true,
        startWindowEnd: true,
        invoiceLineItems: {
          select: {
            invoice: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    }),
  ])

  const jobsBySchedule = new Map<string, typeof existingJobs>()
  for (const job of existingJobs) {
    if (!job.scheduleId) continue
    const jobs = jobsBySchedule.get(job.scheduleId) ?? []
    jobs.push(job)
    jobsBySchedule.set(job.scheduleId, jobs)
  }

  let createdCount = 0
  let repairedCount = 0
  let skippedCount = 0
  const jobsToCreate: Array<{
    locationId: string
    subcontractorId: string | null
    scheduleId: string
    date: Date
    startTime: string | null
    startWindowBegin: string | null
    startWindowEnd: string | null
    clientRate: number
    subcontractorRate: number
  }> = []

  for (const schedule of schedules) {
    const effectiveStartDate = getHistoricalScheduleStartDate(schedule)
    const candidateDates = calculateScheduleDates({
      frequency: schedule.frequency,
      startDate: effectiveStartDate,
      daysOfWeek: schedule.daysOfWeek,
      monthlyPattern: schedule.monthlyPattern,
      customDates: schedule.customDates,
      excludedDates: schedule.excludedDates,
      endDate: schedule.endDate,
    }, rangeEnd).filter(date => date >= rangeStart && date <= rangeEnd)

    if (candidateDates.length === 0) continue

    const scheduleJobs = jobsBySchedule.get(schedule.id) ?? []
    const existingByTime = new Map(scheduleJobs.map(job => [job.date.getTime(), job]))
    const timeFields = getScheduleJobTimeFields(schedule)

    const repairableJobIds = hasScheduleTime(schedule)
      ? scheduleJobs
          .filter(job => !hasJobTime(job) && !hasFinalInvoice(job.invoiceLineItems))
          .map(job => job.id)
      : []

    if (repairableJobIds.length > 0) {
      const updated = await prisma.job.updateMany({
        where: { id: { in: repairableJobIds } },
        data: {
          ...timeFields,
          subcontractorId: schedule.subcontractorId,
          clientRate: schedule.defaultClientRate,
          subcontractorRate: schedule.defaultSubcontractorRate,
        },
      })
      repairedCount += updated.count
    }

    for (const date of candidateDates) {
      const exists = existingByTime.has(date.getTime())
      if (exists) {
        skippedCount++
        continue
      }
      jobsToCreate.push({
        locationId: schedule.locationId,
        subcontractorId: schedule.subcontractorId,
        scheduleId: schedule.id,
        date,
        ...timeFields,
        clientRate: schedule.defaultClientRate,
        subcontractorRate: schedule.defaultSubcontractorRate,
      })
    }
  }

  if (jobsToCreate.length > 0) {
    const result = await prisma.job.createMany({
      data: jobsToCreate,
      skipDuplicates: true,
    })
    createdCount = result.count
    skippedCount += jobsToCreate.length - result.count
  }

  if (createdCount || repairedCount) {
    logger.info('[ensureJobsForDateRange] Ensured jobs', {
      rangeStart: rangeStart.toISOString().split('T')[0],
      rangeEnd: rangeEnd.toISOString().split('T')[0],
      schedulesChecked: schedules.length,
      createdCount,
      repairedCount,
      skippedCount,
    })
  }

  return {
    schedulesChecked: schedules.length,
    createdCount,
    repairedCount,
    skippedCount,
  }
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
  const now = utcDateOnly(new Date())
  const startDate = utcDateOnly(new Date(merged.startDate))

  // Count protected jobs. Only SENT/PAID invoices and recorded cleaner payments
  // freeze a clean — a DRAFT invoice does not (a schedule change rebuilds it).
  const totalProtected = await prisma.job.count({
    where: {
      scheduleId,
      OR: [
        { subcontractorPaid: true },
        { status: 'CANCELLED' },
        { invoiceLineItems: { some: { invoice: { status: { in: ['SENT', 'PAID'] } } } } },
      ],
    },
  })

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

export async function regenerateJobsForSchedule(
  scheduleId: string,
  options?: { effectiveDate?: Date; rebuildDraftInvoicedJobs?: boolean }
): Promise<RegenerationSummary> {
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

  const now = utcDateOnly(options?.effectiveDate ?? new Date())
  const startDate = utcDateOnly(new Date(schedule.startDate))
  // On an explicit schedule change, this month's cleans must rebuild even if a
  // DRAFT invoice was auto-generated for them (which marks them `invoiced`). The
  // nightly cron leaves this false so it never churns draft-attached cleans.
  const rebuildDraftInvoicedJobs = options?.rebuildDraftInvoicedJobs ?? false

  // Wrap all delete/update/create operations in a transaction so a crash
  // mid-way doesn't leave the schedule in a broken state
  const summary = await prisma.$transaction(async (tx) => {
    if (rebuildDraftInvoicedJobs) {
      // SENT/PAID cleans are frozen forever — collect them so we never un-freeze.
      const sentPaidJobIds = (await tx.invoiceLineItem.findMany({
        where: { job: { scheduleId }, invoice: { status: { in: ['SENT', 'PAID'] } } },
        select: { jobId: true },
      })).map((li) => li.jobId).filter((x): x is string => !!x)

      // DRAFT invoices for this schedule are regenerable (the candidate recomputes
      // them live from the rebuilt cleans), so delete them and un-invoice their
      // cleans — letting the rebuild below replace them to match the new schedule.
      const draftInvoiceIds = Array.from(new Set(
        (await tx.invoiceLineItem.findMany({
          where: { job: { scheduleId }, invoice: { status: 'DRAFT' } },
          select: { invoiceId: true },
        })).map((li) => li.invoiceId)
      ))
      if (draftInvoiceIds.length > 0) {
        await tx.invoice.deleteMany({ where: { id: { in: draftInvoiceIds }, status: 'DRAFT' } })
      }
      await tx.job.updateMany({
        where: {
          scheduleId,
          invoiced: true,
          subcontractorPaid: false,
          ...(sentPaidJobIds.length > 0 ? { id: { notIn: sentPaidJobIds } } : {}),
        },
        data: { invoiced: false },
      })
    }

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
        status: { in: ['SCHEDULED', 'CANCELLED'] },
        invoiced: false,
        subcontractorPaid: false,
        id: { notIn: Array.from(protectedJobIds) },
      },
    })

    const deletedCount = pastDeleted.count + futureDeleted.count

    // Only update FUTURE editable jobs with the new subcontractor/rate/clientRate.
    // Past completed jobs keep their original assignment & rates
    // so invoices and cleaner-pay calculations stay accurate.
    const updated = await tx.job.updateMany({
      where: {
        scheduleId,
        subcontractorPaid: false,
        invoiced: false,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        date: { gte: now },
      },
      data: {
        subcontractorId: schedule.subcontractorId,
        subcontractorRate: schedule.defaultSubcontractorRate,
        clientRate: schedule.defaultClientRate,
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

    const futureCandidateDates = candidateDates.filter((date) => date >= now)

    if (futureCandidateDates.length > 0) {
      // Find dates already occupied by this schedule. Different schedules at
      // the same location may legitimately create separate jobs on the same day.
      const existingJobs = await tx.job.findMany({
        where: {
          date: { in: futureCandidateDates },
          scheduleId,
        },
        select: { date: true },
      })
      const existingDates = new Set(existingJobs.map((j) => j.date.getTime()))

      const jobsToCreate = futureCandidateDates
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
  }, { maxWait: 10000, timeout: 30000 })

  logger.info(`[regenerateJobs] Schedule ${scheduleId} regeneration complete:`, {
    deleted: summary.deletedCount,
    created: summary.createdCount,
    updated: summary.updatedCount,
    protected: summary.protectedCount,
    skipped: summary.skippedCount,
    dateRange: summary.firstJobDate && summary.lastJobDate
      ? `${summary.firstJobDate} → ${summary.lastJobDate}`
      : 'none',
  })

  return summary
}

export type ScheduleChangeDiffKind = 'added' | 'removed' | 'modified' | 'kept'

export interface ScheduleChangeDiffRow {
  iso: string
  kind: ScheduleChangeDiffKind
  cleaner: string | null
  clientRate: number | null
  protectedJob: boolean
}

export interface ScheduleChangeDiffResult {
  rows: ScheduleChangeDiffRow[]
  addedCount: number
  removedCount: number
  modifiedCount: number
  keptCount: number
  windowFrom: string
  windowTo: string
}

export interface ScheduleChangeUpdates {
  frequency?: string
  daysOfWeek?: string | null
  monthlyPattern?: string | null
  startDate?: Date | string // the change's effectiveFrom (new interval start)
  endDate?: Date | string | null
  defaultClientRate?: number
  defaultSubcontractorRate?: number
  subcontractorId?: string | null
  timeType?: string
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
}

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Per-date diff of a proposed "going forward" schedule change, computed without
 * writing anything. Mirrors how the change actually applies (old pattern stops
 * at the change date, new pattern starts there; past + protected jobs untouched),
 * so the modal preview matches reality. Reuses `calculateScheduleDates`.
 */
export async function diffScheduleChange(
  scheduleId: string,
  updates: ScheduleChangeUpdates,
  windowOpts?: { from?: Date; to?: Date },
): Promise<ScheduleChangeDiffResult> {
  const empty: ScheduleChangeDiffResult = {
    rows: [], addedCount: 0, removedCount: 0, modifiedCount: 0, keptCount: 0, windowFrom: '', windowTo: '',
  }

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { subcontractor: { select: { id: true, name: true } } },
  })
  if (!schedule) return empty

  const today = utcDateOnly(new Date())
  const effectiveFrom = updates.startDate ? parseUtcDateOnly(updates.startDate) : today
  const mergedEndDate = updates.endDate !== undefined ? updates.endDate : schedule.endDate

  const windowFrom = windowOpts?.from ? utcDateOnly(windowOpts.from) : startOfUtcMonth(today)
  const farRef = mergedEndDate ? parseUtcDateOnly(mergedEndDate) : effectiveFrom
  const windowTo = windowOpts?.to
    ? utcDateOnly(windowOpts.to)
    : endOfUtcMonth(addUtcMonths(farRef > effectiveFrom ? farRef : effectiveFrom, 2))

  const oldDates = calculateScheduleDates({
    frequency: schedule.frequency,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    daysOfWeek: schedule.daysOfWeek,
    monthlyPattern: schedule.monthlyPattern,
    customDates: schedule.customDates,
    excludedDates: schedule.excludedDates,
  }, windowTo).filter((d) => d >= windowFrom && d <= windowTo)

  const newDates = calculateScheduleDates({
    frequency: String(updates.frequency ?? schedule.frequency),
    startDate: effectiveFrom,
    endDate: mergedEndDate ?? null,
    daysOfWeek: updates.daysOfWeek !== undefined ? updates.daysOfWeek : schedule.daysOfWeek,
    monthlyPattern: updates.monthlyPattern !== undefined ? updates.monthlyPattern : schedule.monthlyPattern,
    customDates: schedule.customDates,
    excludedDates: schedule.excludedDates,
  }, windowTo).filter((d) => d >= effectiveFrom && d <= windowTo)

  const oldSet = new Set(oldDates.map((d) => d.getTime()))
  const newSet = new Set(newDates.map((d) => d.getTime()))

  // Same-date "modified" detection: did cleaner / rate / time change?
  const cleanerChanged = updates.subcontractorId !== undefined && (updates.subcontractorId ?? null) !== (schedule.subcontractorId ?? null)
  const rateChanged = (updates.defaultClientRate !== undefined && updates.defaultClientRate !== schedule.defaultClientRate)
    || (updates.defaultSubcontractorRate !== undefined && updates.defaultSubcontractorRate !== schedule.defaultSubcontractorRate)
  const timeChanged = (updates.startTime !== undefined && (updates.startTime ?? null) !== (schedule.startTime ?? null))
    || (updates.timeType !== undefined && updates.timeType !== schedule.timeType)
  const attrsChanged = cleanerChanged || rateChanged || timeChanged

  // Protected cleans won't actually change: only a SENT/PAID invoice, a recorded
  // cleaner payment, or a cancellation freezes a clean. A DRAFT invoice does not —
  // a schedule change rebuilds it.
  const protectedJobs = await prisma.job.findMany({
    where: {
      scheduleId,
      date: { gte: windowFrom, lte: windowTo },
      OR: [
        { subcontractorPaid: true },
        { status: 'CANCELLED' },
        { invoiceLineItems: { some: { invoice: { status: { in: ['SENT', 'PAID'] } } } } },
      ],
    },
    select: { date: true },
  })
  const protectedSet = new Set(protectedJobs.map((j) => utcDateOnly(j.date).getTime()))

  const oldCleaner = schedule.subcontractor?.name ?? null
  const oldClientRate = schedule.defaultClientRate
  let newCleaner = oldCleaner
  if (cleanerChanged) {
    newCleaner = null
    if (updates.subcontractorId) {
      const sub = await prisma.subcontractor.findUnique({ where: { id: updates.subcontractorId }, select: { name: true } })
      newCleaner = sub?.name ?? null
    }
  }
  const newClientRate = updates.defaultClientRate ?? schedule.defaultClientRate

  // Boundary: dates before max(today, effectiveFrom) are unaffected (past, or the
  // old interval still running until the change date).
  const classifyMs = Math.max(effectiveFrom.getTime(), today.getTime())

  const allMs = Array.from(new Set([...oldSet, ...newSet])).sort((a, b) => a - b)
  const rows: ScheduleChangeDiffRow[] = []
  for (const ms of allMs) {
    const isProtected = protectedSet.has(ms)
    if (ms < classifyMs) {
      rows.push({ iso: isoOf(ms), kind: 'kept', cleaner: oldCleaner, clientRate: oldClientRate, protectedJob: isProtected })
      continue
    }
    const inOld = oldSet.has(ms)
    const inNew = newSet.has(ms)
    let kind: ScheduleChangeDiffKind
    let cleaner = newCleaner
    let clientRate: number | null = newClientRate
    if (inOld && inNew) {
      kind = attrsChanged ? 'modified' : 'kept'
    } else if (inOld) {
      kind = 'removed'; cleaner = oldCleaner; clientRate = oldClientRate
    } else {
      kind = 'added'
    }
    // Protected jobs are never removed/modified by regeneration.
    if (isProtected && (kind === 'removed' || kind === 'modified')) kind = 'kept'
    rows.push({ iso: isoOf(ms), kind, cleaner, clientRate, protectedJob: isProtected })
  }

  return {
    rows,
    addedCount: rows.filter((r) => r.kind === 'added').length,
    removedCount: rows.filter((r) => r.kind === 'removed').length,
    modifiedCount: rows.filter((r) => r.kind === 'modified').length,
    keptCount: rows.filter((r) => r.kind === 'kept').length,
    windowFrom: isoOf(windowFrom.getTime()),
    windowTo: isoOf(windowTo.getTime()),
  }
}
