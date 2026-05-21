import { parseDateOnly } from '@/lib/date-only'

type ScheduleTimingLike = {
  startDate?: Date | string | null
  endDate?: Date | string | null
}

export type ScheduleLifecycle = "current" | "upcoming" | "ended"

function normalizeStartDate(value?: Date | string | null) {
  const date = parseDateOnly(value)
  if (!date) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function normalizeEndDate(value?: Date | string | null) {
  const date = parseDateOnly(value)
  if (!date) return null
  date.setHours(23, 59, 59, 999)
  return date
}

export function getScheduleLifecycle<T extends ScheduleTimingLike>(
  schedule: T,
  referenceDate: Date = new Date()
): ScheduleLifecycle {
  const today = new Date(referenceDate)
  today.setHours(12, 0, 0, 0)

  const startDate = normalizeStartDate(schedule.startDate)
  const endDate = normalizeEndDate(schedule.endDate)

  if (startDate && startDate > today) return "upcoming"
  if (endDate && endDate < today) return "ended"
  return "current"
}

function getScheduleSortValue<T extends ScheduleTimingLike>(schedule: T) {
  return (
    normalizeEndDate(schedule.endDate)?.getTime() ??
    normalizeStartDate(schedule.startDate)?.getTime() ??
    0
  )
}

export function sortSchedulesForDisplay<T extends ScheduleTimingLike>(
  schedules: T[],
  referenceDate: Date = new Date()
): T[] {
  const rank: Record<ScheduleLifecycle, number> = {
    current: 0,
    upcoming: 1,
    ended: 2,
  }

  return [...schedules].sort((a, b) => {
    const aLifecycle = getScheduleLifecycle(a, referenceDate)
    const bLifecycle = getScheduleLifecycle(b, referenceDate)

    if (rank[aLifecycle] !== rank[bLifecycle]) {
      return rank[aLifecycle] - rank[bLifecycle]
    }

    const aValue = getScheduleSortValue(a)
    const bValue = getScheduleSortValue(b)

    if (aLifecycle === "upcoming") {
      return aValue - bValue
    }

    return bValue - aValue
  })
}

export function getPrimaryScheduleForDisplay<T extends ScheduleTimingLike>(
  schedules: T[],
  referenceDate: Date = new Date()
): T | undefined {
  return sortSchedulesForDisplay(schedules, referenceDate)[0]
}
