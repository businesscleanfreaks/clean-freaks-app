import { addDays, addMonths, endOfMonth, getDay, setDate, startOfDay, startOfMonth } from 'date-fns'

export interface ScheduleAverageParams {
  frequency: string
  startDate: Date | string
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

function toNoonUTC(date: Date) {
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

function calculateScheduleDates(params: ScheduleAverageParams, rangeEnd: Date): Date[] {
  const startDate = startOfDay(new Date(params.startDate))
  const projectedEndDate = startOfDay(rangeEnd)
  const scheduleEndDate = params.endDate ? startOfDay(new Date(params.endDate)) : null
  const endDate = scheduleEndDate && scheduleEndDate < projectedEndDate ? scheduleEndDate : projectedEndDate
  const dates: Date[] = []

  if (endDate < startDate) return []

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

export function getAverageScheduleOccurrencesPerMonth(
  params: ScheduleAverageParams,
  anchorDate = new Date(),
  months = 3
): number {
  if (months <= 0) return 0

  const monthStarts = Array.from({ length: months }, (_, offset) =>
    startOfMonth(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + offset, 1))
  )
  const allDates = calculateScheduleDates(params, endOfMonth(monthStarts[monthStarts.length - 1]))

  let totalOccurrences = 0
  for (const monthStart of monthStarts) {
    const monthEnd = endOfMonth(monthStart)
    totalOccurrences += allDates.filter((date) => date >= monthStart && date <= monthEnd).length
  }

  return totalOccurrences / months
}
