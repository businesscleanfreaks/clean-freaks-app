/**
 * How many cleans a schedule averages a month, for the monthly figures on the
 * clients list, the client page and the dashboard.
 *
 * It counts the dates the real generator (lib/schedule-dates.ts) produces. It
 * used to count a private copy of that generator, which drifted: a weekly
 * schedule saved without days produced nothing here while the calendar had its
 * cleans, so the client showed $0 a month.
 */

import {
  addUtcMonths,
  calculateScheduleDates,
  endOfUtcMonth,
  startOfUtcMonth,
  utcDateOnly,
  type ScheduleDateParams,
} from './schedule-dates'

export type ScheduleAverageParams = ScheduleDateParams

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
