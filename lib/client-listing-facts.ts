/**
 * Working out a client's list facts from its schedules and visits.
 *
 * The API queries; this decides. It is kept apart from the route so the rules
 * that are easy to get subtly wrong · which schedule is current, whether a
 * pause covers today, what a per-clean client is worth a month · are tested
 * rather than trusted.
 *
 * Pure: no Prisma, no clock (today is passed in).
 */

import { getScheduleLifecycle, getPrimaryScheduleForDisplay } from "./schedule-timing"
import { getAverageScheduleOccurrencesPerMonth } from "./schedule-averages"
import { normaliseMonthlyPattern } from "./monthly-pattern"
import type { ClientListFacts } from "./client-listing"

export interface FactSchedule {
  isActive: boolean
  startDate: Date
  endDate: Date | null
  pauseFrom: Date | null
  pauseTo: Date | null
  frequency: string
  daysOfWeek: string | null
  monthlyPattern: string | null
  customDates: string | null
  excludedDates: string | null
  cadenceAnchor?: Date | null
  defaultClientRate: number
  clientPayType: string | null
  cleanerName: string | null
}

/** A visit that was not cancelled. */
export interface FactVisit {
  date: Date
  clientRate: number
  cleanerName: string | null
}

export interface FactInput {
  isActive: boolean
  notes: string | null
  billingType: string | null
  schedules: FactSchedule[]
  /** Latest non-cancelled visit before today, however long ago. */
  lastVisit: Date | null
  /** Earliest non-cancelled visit from today onward, however far ahead. */
  nextVisit: Date | null
  /** Non-cancelled visits in a window around today, for rates and the 90-day total. */
  nearbyVisits: FactVisit[]
}

export interface ClientListFactResult {
  facts: ClientListFacts
  /** Who cleans it: one name, "Mixed", or "Unassigned". */
  cleaner: string
}

/** The trial marker the add-client flow stamps into notes. */
export const TRIAL_MARKER = "TRIAL CLIENT"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKLY_KINDS = new Set(["WEEKLY", "BI_WEEKLY", "EVERY_3_WEEKS", "EVERY_4_WEEKS", "EVERY_6_WEEKS"])

function parseDays(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]
      : []
  } catch {
    return []
  }
}

/** "1st", "2nd", "3rd", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"
  return `${n}${suffix}`
}

/** "Mon–Fri" for a run, "Mon, Wed, Fri" otherwise. */
function dayList(days: number[]): string {
  const ordered = [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
  const positions = ordered.map(d => WEEK_ORDER.indexOf(d))
  const isRun = ordered.length >= 3 && positions.every((p, i) => i === 0 || p === positions[i - 1] + 1)
  if (isRun) return `${DAY_NAMES[ordered[0]]}–${DAY_NAMES[ordered[ordered.length - 1]]}`
  return ordered.map(d => DAY_NAMES[d]).join(", ")
}

function monthlyPatternText(raw: string | null): string | null {
  const pattern = normaliseMonthlyPattern(raw)
  if (!pattern) return null
  if (pattern.type === "FIXED_DATES") return pattern.dates.map(ordinal).join(" & ")
  const weeks = pattern.weeks.map(w => (w === "last" ? "last" : ordinal(w))).join(" & ")
  return `${weeks} ${DAY_NAMES[pattern.weekday]}`
}

/**
 * The schedule in the page's words: "1x Weekly: Thu", "5x Weekly: Mon–Fri",
 * "Bi-Weekly: Wed", "2x Monthly: 1st & 3rd Mon", "Daily: Mon–Sun".
 *
 * A schedule saved without days, or a monthly one without a pattern, is booked
 * by the generator on its start date's weekday or day of month. Given the
 * start date, the wording names that same day rather than leaving it blank.
 */
export function scheduleWording(
  frequency: string,
  daysOfWeek: string | null,
  monthlyPattern: string | null,
  startDate?: Date | null,
): string {
  const saved = parseDays(daysOfWeek)
  const days = saved.length === 0 && startDate && WEEKLY_KINDS.has(frequency) ? [startDate.getUTCDay()] : saved
  const list = days.length > 0 ? dayList(days) : ""
  const withDays = (label: string) => (list ? `${label}: ${list}` : label)

  switch (frequency) {
    case "DAILY":
      return "Daily: Mon–Sun"
    case "WEEKLY":
      if (days.length === 7) return "Daily: Mon–Sun"
      return withDays(`${Math.max(days.length, 1)}x Weekly`)
    case "BI_WEEKLY":
      return withDays("Bi-Weekly")
    case "EVERY_3_WEEKS":
      return withDays("Every 3 Weeks")
    case "EVERY_4_WEEKS":
      return withDays("Every 4 Weeks")
    case "EVERY_6_WEEKS":
      return withDays("Every 6 Weeks")
    case "MONTHLY": {
      const pattern = monthlyPatternText(monthlyPattern) ?? (startDate ? ordinal(startDate.getUTCDate()) : null)
      return pattern ? `1x Monthly: ${pattern}` : "1x Monthly"
    }
    case "2X_MONTHLY":
    case "BI_MONTHLY": {
      const pattern = monthlyPatternText(monthlyPattern)
      return pattern ? `2x Monthly: ${pattern}` : "2x Monthly"
    }
    case "CUSTOM":
      return "Custom dates"
    default:
      return frequency
  }
}

const isFlat = (schedule: FactSchedule, billingType: string | null) =>
  (schedule.clientPayType ?? billingType) === "FLAT_RATE"

/**
 * What one schedule is worth a month. A flat rate is the month; a per-clean
 * rate is multiplied by how many visits its pattern produces in an average
 * month · which is how "$167.50 a clean, twice a week" becomes about $1,449.
 */
export function scheduleMonthlyValue(
  schedule: FactSchedule,
  billingType: string | null,
  today: Date,
  opts: { ignoreEnd?: boolean } = {},
): number {
  const rate = schedule.defaultClientRate || 0
  if (rate <= 0) return 0
  if (isFlat(schedule, billingType)) return rate

  const perMonth = getAverageScheduleOccurrencesPerMonth(
    {
      frequency: schedule.frequency,
      startDate: schedule.startDate,
      cadenceAnchor: schedule.cadenceAnchor ?? null,
      endDate: opts.ignoreEnd ? null : schedule.endDate,
      daysOfWeek: schedule.daysOfWeek,
      monthlyPattern: schedule.monthlyPattern,
      customDates: schedule.customDates,
      excludedDates: schedule.excludedDates,
    },
    today,
  )
  return rate * perMonth
}

/** A pause window covers today. An open-ended pause (no end) always does once started. */
export function pauseCoversToday(schedule: FactSchedule, today: Date): boolean {
  if (!schedule.pauseFrom) return false
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const from = schedule.pauseFrom.getTime()
  if (from > dayStart + DAY_MS - 1) return false
  if (!schedule.pauseTo) return true
  return schedule.pauseTo.getTime() >= dayStart
}

function cleanerOf(names: (string | null)[]): string {
  const unique = [...new Set(names.filter((n): n is string => !!n))]
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) return "Mixed"
  return "Unassigned"
}

export function buildClientListFacts(input: FactInput, today: Date): ClientListFactResult {
  // A schedule the client is on: active, and not over. One starting soon counts ·
  // a new client whose first clean is next week is a recurring client already.
  const current = input.schedules.filter(
    s => s.isActive && getScheduleLifecycle(s, today) !== "ended",
  )
  const paused = input.schedules.filter(s => pauseCoversToday(s, today))
  const pausedNow = paused.length > 0

  // The row names one schedule. For a client with several (two locations, or
  // a weekly clean plus a monthly deep clean) that is the one the money mostly
  // comes from, so the schedule line and the rate beside it describe the bulk
  // of the figure. The display order breaks ties and covers unpriced ones.
  const biggest = (list: FactSchedule[], value: (s: FactSchedule) => number) => {
    if (list.length === 0) return null
    const top = Math.max(...list.map(value))
    if (top <= 0) return getPrimaryScheduleForDisplay(list, today)
    return getPrimaryScheduleForDisplay(list.filter(s => value(s) === top), today)
  }
  const currentValue = (s: FactSchedule) => scheduleMonthlyValue(s, input.billingType, today)
  const pausedValue = (s: FactSchedule) => scheduleMonthlyValue(s, input.billingType, today, { ignoreEnd: true })

  const describing = pausedNow ? biggest(paused, pausedValue) : biggest(current, currentValue)

  const monthlyRecurring = current.reduce((sum, s) => sum + currentValue(s), 0)
  // What the client was worth before the pause. The paused interval has
  // already been ended by the pause, so its end date is ignored here.
  const pausedMonthly = paused.reduce((sum, s) => sum + pausedValue(s), 0)

  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const ninetyDaysAgo = dayStart - 90 * DAY_MS
  const trailing90 = input.nearbyVisits
    .filter(v => v.date.getTime() >= ninetyDaysAgo && v.date.getTime() < dayStart)
    .reduce((sum, v) => sum + (v.clientRate || 0), 0)

  const sameDay = (a: Date, b: Date | null) =>
    !!b &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  const nextVisitRow = input.nearbyVisits.find(v => sameDay(v.date, input.nextVisit))
  const lastVisitRow = input.nearbyVisits.find(v => sameDay(v.date, input.lastVisit))
  const visitRow = nextVisitRow ?? lastVisitRow ?? null

  // Who cleans it. From the schedules when there are any; for a client without
  // one, from the visit the row is talking about.
  const scheduleCleaners = (current.length > 0 ? current : paused).map(s => s.cleanerName)
  const cleaner = scheduleCleaners.length > 0
    ? cleanerOf(scheduleCleaners)
    : cleanerOf([visitRow?.cleanerName ?? null])

  const facts: ClientListFacts = {
    isActive: input.isActive,
    isTrial: (input.notes ?? "").trim().startsWith(TRIAL_MARKER),
    pausedNow,
    hasRecurringSchedule: current.length > 0,
    monthlyRecurring,
    pausedMonthly,
    payType: describing ? (describing.clientPayType ?? input.billingType) : input.billingType,
    rate: describing ? describing.defaultClientRate : null,
    scheduleText: describing
      ? scheduleWording(describing.frequency, describing.daysOfWeek, describing.monthlyPattern, describing.startDate)
      : "",
    lastVisit: input.lastVisit,
    nextVisit: input.nextVisit,
    visitRate: visitRow ? visitRow.clientRate : null,
    trailing90,
    hasAnyVisits: !!(input.lastVisit || input.nextVisit),
  }

  return { facts, cleaner }
}
