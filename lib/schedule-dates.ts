/**
 * The dates a schedule produces. The one generator.
 *
 * Pure: no Prisma, no logger, so both the server and the browser can use it.
 * It lived inside regenerate-schedule-jobs.ts, which imports the database, so
 * code that runs in the browser (the monthly averages on the client pages)
 * kept its own copy · and the copy drifted: it had no fallback for a weekly
 * schedule saved without days, ignored the cadence anchor, and read monthly
 * patterns by label only. A client on such a schedule showed $0 a month while
 * the calendar had its cleans. One generator, imported everywhere, ends that.
 */

import { normaliseMonthlyPattern } from './monthly-pattern'

export interface ScheduleDateParams {
  frequency: string
  startDate: Date | string
  /**
   * The first clean of the ORIGINAL series, for every-N-weeks cadences.
   *
   * Week parity used to be counted from `startDate`. Splitting a bi-weekly
   * schedule ("change going forward") gives the new half a start date that is
   * usually not one of the client's clean days, and counting from there
   * re-phases the whole future series by a week · every later clean lands on
   * the wrong date, and calendar, cleaner pay and invoices all follow it.
   *
   * Null for schedules created before this was recorded, which fall back to
   * `startDate` and so behave exactly as they did.
   */
  cadenceAnchor?: Date | string | null
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

export function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

/** Sunday of the week containing `date`, matching the old Sat→Sun rollover. */
function startOfUtcWeek(date: Date): Date {
  const day = utcDateOnly(date)
  return new Date(day.getTime() - day.getUTCDay() * 86400000)
}

/** Whole weeks from `anchor` to `date`; negative when `date` is earlier. */
export function weeksBetweenUtc(anchor: Date, date: Date): number {
  const from = startOfUtcWeek(anchor).getTime()
  const to = startOfUtcWeek(date).getTime()
  return Math.round((to - from) / (7 * 86400000))
}

/** Modulo that stays non-negative, so an anchor after the start still works. */
function mod(value: number, by: number): number {
  return ((value % by) + by) % by
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0))
}

export function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12, 0, 0))
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12, 0, 0))
}

function utcDayOfMonth(monthDate: Date, dayOfMonth: number): Date {
  const daysInMonth = endOfUtcMonth(monthDate).getUTCDate()
  const targetDay = Math.min(dayOfMonth, daysInMonth)
  return new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), targetDay, 12, 0, 0))
}

export function parseUtcDateOnly(value: Date | string): Date {
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
    // Parity comes from the original series, so a split keeps the client's
    // existing rhythm instead of restarting it on the effective date.
    const anchor = params.cadenceAnchor ? parseUtcDateOnly(params.cadenceAnchor) : startDate
    let currentDate = new Date(startDate)

    while (currentDate <= endDate) {
      const week = weeksBetweenUtc(anchor, currentDate)
      if (mod(week, weekInterval) === 0 && daysOfWeek.includes(currentDate.getUTCDay())) {
        dates.push(new Date(currentDate))
      }
      currentDate = addUtcDays(currentDate, 1)
    }
  } else if (params.frequency === 'MONTHLY' && params.monthlyPattern) {
    // MONTHLY with NTH_WEEKDAY pattern (e.g., "1st Tuesday" or "1st & 3rd Tuesday").
    // Read by SHAPE as well as by label: a pattern carrying a weekday and a
    // list of weeks but no `type` used to fall through to day-of-month, and a
    // "first Tuesday" schedule that started on the 10th generated the 10th of
    // every month instead. See lib/monthly-pattern.ts.
    const pattern = normaliseMonthlyPattern(params.monthlyPattern)
    if (pattern?.type === 'FIXED_DATES') {
      const dayOfMonth = pattern.dates[0] as number
      let currentMonth = startOfUtcMonth(startDate)
      while (currentMonth <= endDate) {
        const jobDate = utcDayOfMonth(currentMonth, dayOfMonth)
        if (jobDate >= startDate && jobDate <= endDate) dates.push(jobDate)
        currentMonth = addUtcMonths(currentMonth, 1)
      }
    } else if (pattern?.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday
      const ordinals = pattern.weeks
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
      // The pattern says nothing usable · day of month is then a decision, not
      // a guess about a pattern that was really something else.
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
    // Read by shape as well as by label, as above.
    const pattern = normaliseMonthlyPattern(params.monthlyPattern)
    if (pattern?.type === 'FIXED_DATES') {
      const fixedDates = pattern.dates
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
    } else if (pattern?.type === 'NTH_WEEKDAY') {
      const weekday = pattern.weekday
      const ordinals = pattern.weeks
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
