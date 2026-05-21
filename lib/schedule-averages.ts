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

function utcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
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

function calculateScheduleDates(params: ScheduleAverageParams, rangeEnd: Date): Date[] {
  const startDate = parseUtcDateOnly(params.startDate)
  const projectedEndDate = utcDateOnly(rangeEnd)
  const scheduleEndDate = params.endDate ? parseUtcDateOnly(params.endDate) : null
  const endDate = scheduleEndDate && scheduleEndDate < projectedEndDate ? scheduleEndDate : projectedEndDate
  const dates: Date[] = []

  if (endDate < startDate) return []

  const weekInterval = WEEK_INTERVALS[params.frequency]

  if (weekInterval) {
    const daysOfWeek = params.daysOfWeek ? JSON.parse(params.daysOfWeek) : []
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
  } else if (params.frequency === 'MONTHLY') {
    const pattern = params.monthlyPattern ? JSON.parse(params.monthlyPattern) : null

    if (pattern?.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday as number
      const weeks = pattern.weeks as (number | 'last')[]
      let currentMonth = startOfUtcMonth(startDate)

      while (currentMonth <= endDate) {
        for (const week of weeks) {
          const jobDate = week === 'last'
            ? getLastWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday)
            : getNthWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday, week)
          if (jobDate && jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        }
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    } else {
      const dayOfMonth = startDate.getUTCDate()
      let currentMonth = startOfUtcMonth(startDate)

      while (currentMonth <= endDate) {
        const jobDate = utcDayOfMonth(currentMonth, dayOfMonth)
        if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        currentMonth = addUtcMonths(currentMonth, 1)
      }
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
      const weeks = pattern.weeks as (number | 'last')[]
      let currentMonth = startOfUtcMonth(startDate)

      while (currentMonth <= endDate) {
        for (const week of weeks) {
          const jobDate = week === 'last'
            ? getLastWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday)
            : getNthWeekdayOfMonth(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), weekday, week)
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

export function getAverageScheduleOccurrencesPerMonth(
  params: ScheduleAverageParams,
  anchorDate = new Date(),
  months = 3
): number {
  if (months <= 0) return 0

  const anchorMonth = startOfUtcMonth(utcDateOnly(anchorDate))
  const monthStarts = Array.from({ length: months }, (_, offset) => addUtcMonths(anchorMonth, offset))
  const allDates = calculateScheduleDates(params, endOfUtcMonth(monthStarts[monthStarts.length - 1]))

  let totalOccurrences = 0
  for (const monthStart of monthStarts) {
    const monthEnd = endOfUtcMonth(monthStart)
    totalOccurrences += allDates.filter((date) => date >= monthStart && date <= monthEnd).length
  }

  return totalOccurrences / months
}
