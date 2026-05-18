import { differenceInCalendarDays, startOfMonth, endOfMonth } from 'date-fns'
import { calculateScheduleDates, type ScheduleDateParams } from '@/lib/regenerate-schedule-jobs'
import { getAvgOccurrencesPerMonth } from '@/lib/frequency-utils'

/**
 * Shape of a schedule with its recurring add-ons, as returned by Prisma.
 * Keeps this module independent of Prisma-generated types.
 */
export interface ProjectableSchedule {
  id: string
  frequency: string
  startDate: Date | string
  endDate?: Date | string | null
  daysOfWeek: string | null
  monthlyPattern: string | null
  customDates: string | null
  excludedDates: string | null
  defaultClientRate: number
  defaultSubcontractorRate: number
  clientPayType: string
  subcontractorPayType: string
  isActive: boolean
  recurringAddOnServices: Array<{
    clientRate: number
    subcontractorRate: number
    frequency: string | null
    isRecurring: boolean
  }>
}

export interface MonthlyProjection {
  revenue: number
  workerPayments: number
  addOnRevenue: number
  addOnWorkerPayments: number
  jobCount: number
}

function getActiveMonthRatio(schedule: ProjectableSchedule, monthStart: Date, monthEnd: Date): number {
  const scheduleStart = new Date(schedule.startDate)
  const scheduleEnd = schedule.endDate ? new Date(schedule.endDate) : monthEnd
  const activeStart = scheduleStart > monthStart ? scheduleStart : monthStart
  const activeEnd = scheduleEnd < monthEnd ? scheduleEnd : monthEnd

  if (activeEnd < activeStart) return 0

  const activeDays = differenceInCalendarDays(activeEnd, activeStart) + 1
  const totalDays = differenceInCalendarDays(monthEnd, monthStart) + 1
  return Math.max(0, Math.min(1, activeDays / totalDays))
}

/**
 * Calculate exact financial projections for a set of schedules in a specific month.
 *
 * Uses real schedule date math (calculateScheduleDates) to determine the exact
 * number of job occurrences in the target month, then multiplies by rates.
 * Works for any month — past, present, or far future.
 */
export function projectSchedulesForMonth(
  schedules: ProjectableSchedule[],
  year: number,
  month: number
): MonthlyProjection {
  const monthStart = startOfMonth(new Date(year, month, 1))
  const monthEnd = endOfMonth(new Date(year, month, 1))

  let revenue = 0
  let workerPayments = 0
  let addOnRevenue = 0
  let addOnWorkerPayments = 0
  let totalJobCount = 0

  for (const schedule of schedules) {
    if (!schedule.isActive) continue

    // Calculate exact dates that fall in this month
    const dateParams: ScheduleDateParams = {
      frequency: schedule.frequency,
      startDate: new Date(schedule.startDate),
      endDate: schedule.endDate ?? null,
      daysOfWeek: schedule.daysOfWeek,
      monthlyPattern: schedule.monthlyPattern,
      customDates: schedule.customDates,
      excludedDates: schedule.excludedDates,
    }

    const allDates = calculateScheduleDates(dateParams, monthEnd)
    const monthDates = allDates.filter(d => d >= monthStart && d <= monthEnd)
    const jobCount = monthDates.length

    if (jobCount === 0) continue

    totalJobCount += jobCount

    // Revenue
    const clientPayType = schedule.clientPayType || 'PER_CLEAN'
    if (clientPayType === 'FLAT_RATE') {
      // Flat rate: charge once per month regardless of job count
      revenue += schedule.defaultClientRate
    } else {
      // Per clean: charge per job
      revenue += schedule.defaultClientRate * jobCount
    }

    // Worker payments
    const subPayType = schedule.subcontractorPayType || 'PER_CLEAN'
    if (subPayType === 'FLAT_RATE') {
      workerPayments += schedule.defaultSubcontractorRate * getActiveMonthRatio(schedule, monthStart, monthEnd)
    } else {
      workerPayments += schedule.defaultSubcontractorRate * jobCount
    }

    // Recurring add-ons
    if (schedule.recurringAddOnServices) {
      for (const addon of schedule.recurringAddOnServices) {
        if (!addon.isRecurring) continue

        // Use getAvgOccurrencesPerMonth for add-on frequency since add-ons
        // don't have their own daysOfWeek/pattern (just a frequency string)
        const addonFreq = addon.frequency || 'MONTHLY'
        const addonOccurrences = getAvgOccurrencesPerMonth(addonFreq, null)

        addOnRevenue += addon.clientRate * addonOccurrences
        addOnWorkerPayments += addon.subcontractorRate * addonOccurrences
      }
    }
  }

  return {
    revenue: revenue + addOnRevenue,
    workerPayments: workerPayments + addOnWorkerPayments,
    addOnRevenue,
    addOnWorkerPayments,
    jobCount: totalJobCount,
  }
}

/**
 * Project a single schedule for a specific month.
 * Convenience wrapper for per-client calculations.
 */
export function projectSingleScheduleForMonth(
  schedule: ProjectableSchedule,
  year: number,
  month: number
): MonthlyProjection {
  return projectSchedulesForMonth([schedule], year, month)
}
