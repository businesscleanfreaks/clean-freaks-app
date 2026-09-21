/**
 * Reading a monthly schedule pattern, including ones that never said what kind
 * they were.
 *
 * Patterns are stored as JSON and the date generator branched on `pattern.type`.
 * The final `else` was "no NTH_WEEKDAY, so fixed day of month, taken from the
 * schedule's start date" · which is a reasonable default for a pattern that
 * carries no shape at all, and quietly wrong for one that carries the shape but
 * not the label:
 *
 *     { "weekday": 2, "weeks": [1] }        // first Tuesday, no `type`
 *
 * That fell through to the else and produced the 10th of every month, because
 * the schedule happened to start on the 10th. The cleans were generated on the
 * wrong days and everything downstream · invoices, payables, the calendar ·
 * simply agreed with them.
 *
 * A pattern with a weekday and a list of weeks IS an nth-weekday pattern
 * whether or not anyone wrote that down, and a pattern with a list of dates is
 * a fixed-dates one. So the shape is read, and the label is only believed when
 * it is there.
 *
 * Null means the pattern genuinely says nothing · then the caller's
 * day-of-month fallback is the right answer rather than a guess.
 *
 * Pure: no Prisma, no clock.
 */

export type MonthlyPatternType = "FIXED_DATES" | "NTH_WEEKDAY"

export interface FixedDatesPattern {
  type: "FIXED_DATES"
  dates: number[]
}

export interface NthWeekdayPattern {
  type: "NTH_WEEKDAY"
  weekday: number
  weeks: (number | "last")[]
}

export type MonthlyPattern = FixedDatesPattern | NthWeekdayPattern

const isDayOfMonth = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31

const isWeekday = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6

const isOrdinal = (value: unknown): value is number | "last" =>
  value === "last" || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)

/**
 * A stored pattern, read into something the generator can branch on.
 *
 * Accepts the raw JSON string or an already-parsed object. Returns null for
 * anything unreadable, so a malformed pattern falls back rather than throwing
 * in the middle of generating a calendar.
 */
export function normaliseMonthlyPattern(raw: unknown): MonthlyPattern | null {
  let pattern: unknown = raw
  if (typeof raw === "string") {
    try {
      pattern = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!pattern || typeof pattern !== "object") return null

  const p = pattern as Record<string, unknown>
  const declared = typeof p.type === "string" ? p.type : null

  const dates = Array.isArray(p.dates) ? p.dates.filter(isDayOfMonth) : []
  const weeks = Array.isArray(p.weeks) ? p.weeks.filter(isOrdinal) : []
  const hasWeekday = isWeekday(p.weekday)

  // A declared type is believed, as long as it carries the data it needs.
  if (declared === "FIXED_DATES" && dates.length > 0) {
    return { type: "FIXED_DATES", dates }
  }
  if (declared === "NTH_WEEKDAY" && hasWeekday && weeks.length > 0) {
    return { type: "NTH_WEEKDAY", weekday: p.weekday as number, weeks }
  }

  // No usable label: read the shape. A weekday plus a list of weeks is an
  // nth-weekday pattern however it was written down.
  if (hasWeekday && weeks.length > 0) {
    return { type: "NTH_WEEKDAY", weekday: p.weekday as number, weeks }
  }
  if (dates.length > 0) {
    return { type: "FIXED_DATES", dates }
  }

  return null
}
