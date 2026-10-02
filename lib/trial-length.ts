/**
 * How long a trial runs, as the New booking window sets it (trials handoff,
 * Calendar Main.dc.html): a `[−] 1 month [+]` stepper with a Weeks | Months
 * toggle, defaulting to 1 month.
 *
 * The end date is EXCLUSIVE: a trial generates cleans from its start up to,
 * not including, its end, so a 1-week trial on one weekday is a single clean.
 * A schedule's endDate is inclusive (lib/schedule-dates.ts), so the schedule
 * is saved ending the day before. It used to be saved ending ON the end date,
 * which booked one clean too many whenever the end fell on a service day.
 *
 * Pure: date-fns only.
 */

import { addMonths, addWeeks, format, subDays } from "date-fns"

export type TrialUnit = "weeks" | "months"

export interface TrialLength {
  n: number
  unit: TrialUnit
}

export const DEFAULT_TRIAL_LENGTH: TrialLength = { n: 1, unit: "months" }

const LIMITS: Record<TrialUnit, number> = { weeks: 12, months: 6 }

/** The day the trial ends: n weeks later, or the same day of the month n months later. No clean on it. */
export function trialEndDate(start: Date, length: TrialLength): Date {
  return length.unit === "weeks" ? addWeeks(start, length.n) : addMonths(start, length.n)
}

/** The schedule's (inclusive) end date for a trial, as yyyy-MM-dd: the day before it ends. */
export function trialScheduleEnd(start: Date, length: TrialLength): string {
  return format(subDays(trialEndDate(start, length), 1), "yyyy-MM-dd")
}

/** One step of the stepper: never below 1, never above the unit's limit. */
export function stepTrialLength(length: TrialLength, delta: 1 | -1): TrialLength {
  const n = Math.min(LIMITS[length.unit], Math.max(1, length.n + delta))
  return { ...length, n }
}

export const canStepTrial = (length: TrialLength, delta: 1 | -1) =>
  delta < 0 ? length.n > 1 : length.n < LIMITS[length.unit]

/** Switching the unit starts again at 4 weeks or 1 month, as the design does. */
export function switchTrialUnit(unit: TrialUnit): TrialLength {
  return unit === "weeks" ? { n: 4, unit } : { n: 1, unit }
}

/** "1 month", "4 weeks". */
export function trialLengthLabel(length: TrialLength): string {
  const word = length.unit === "weeks" ? "week" : "month"
  return `${length.n} ${word}${length.n === 1 ? "" : "s"}`
}

/** "Trial runs Jun 11 – Jul 9". */
export function trialRunsLabel(start: Date, length: TrialLength): string {
  return `Trial runs ${format(start, "MMM d")} – ${format(trialEndDate(start, length), "MMM d")}`
}
