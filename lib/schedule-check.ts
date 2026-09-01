/**
 * The schedule check card in the invoice review: what the month was supposed to
 * look like, and whether it went that way.
 *
 * The cadence line is derived from the cleans that actually happened rather
 * than from the schedule's frequency enum. That is deliberate in the design —
 * it describes the month in front of the reviewer ("Weekly · Tue & Fri"),
 * which is the thing they are checking, not the rule it came from.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** How many times a given weekday falls in a month. */
function occurrencesOfWeekday(year: number, month1: number, weekday: number): number {
  const daysInMonth = new Date(year, month1, 0).getDate()
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month1 - 1, d).getDay() === weekday) count++
  }
  return count
}

/** "Tue & Fri", "Mon, Wed & Fri". */
function joinDays(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`
}

export interface CadenceInput {
  /** Day-of-month numbers that were cleaned. */
  cleanDays: number[]
  /** Day-of-month numbers that were cancelled — still part of the pattern. */
  cancelledDays?: number[]
  year: number
  /** 1-12. */
  month: number
}

/**
 * The headline above the mini calendar, e.g. "Weekly · Tue & Fri".
 *
 * Cancelled days count towards the pattern: a clean that was booked and then
 * called off still tells you which day the client is on.
 */
export function cadenceLabel({ cleanDays, cancelledDays = [], year, month }: CadenceInput): string {
  const days = [...cleanDays, ...cancelledDays]
  if (days.length === 0) return "No scheduled cleans"

  const perWeekday = new Map<number, number>()
  for (const d of days) {
    const w = new Date(year, month - 1, d).getDay()
    perWeekday.set(w, (perWeekday.get(w) ?? 0) + 1)
  }
  const weekdays = [...perWeekday.keys()].sort((a, b) => a - b)

  // Mon-Fri gets its own phrasing rather than a five-name list.
  const isEveryWeekday = weekdays.length >= 5 && [1, 2, 3, 4, 5].every(w => weekdays.includes(w))
  if (isEveryWeekday) return "Every weekday (Mon–Fri)"

  const joined = joinDays(weekdays.map(w => DAY_NAMES[w]))
  const hitEvery = weekdays.every(w => (perWeekday.get(w) ?? 0) >= occurrencesOfWeekday(year, month, w))
  if (hitEvery) return `Weekly · ${joined}`

  const everyOther = weekdays.every(w => {
    const hits = perWeekday.get(w) ?? 0
    return hits >= 2 && hits < occurrencesOfWeekday(year, month, w)
  })
  if (everyOther) return `Every other week · ${joined}`

  const monthName = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long" })
  return `${days.length} visit${days.length === 1 ? "" : "s"} in ${monthName} · ${joined}`
}

/** Header count: "9 cleans done", or "7 of 9 cleans done" when some fell out. */
export function scheduleSummaryLabel(cleanCount: number, cancelledCount: number): string {
  if (cancelledCount > 0) return `${cleanCount} of ${cleanCount + cancelledCount} cleans done`
  return `${cleanCount} clean${cleanCount === 1 ? "" : "s"} done`
}

export type CellMark = "clean" | "oneoff" | "cancelled" | "scheduled" | "empty"

export interface CellStyle {
  background: string
  color: string
  fontWeight: number
  boxShadow: string
  textDecoration: string
}

/**
 * A day in the mini calendar. Cleans are solid discs so the month's shape reads
 * at a glance; a cancelled day stays visible but struck through, because the
 * reviewer needs to see that it was supposed to happen.
 */
export function cellStyle(mark: CellMark): CellStyle {
  switch (mark) {
    case "cancelled":
      return {
        background: "#fdecec",
        color: "#dc2626",
        fontWeight: 500,
        boxShadow: "0 0 0 1px #f3b4b4",
        textDecoration: "line-through",
      }
    case "oneoff":
      return { background: "#f59e0b", color: "#fff", fontWeight: 700, boxShadow: "none", textDecoration: "none" }
    case "clean":
      return { background: "#15793f", color: "#fff", fontWeight: 700, boxShadow: "none", textDecoration: "none" }
    case "scheduled":
      // Booked but not yet done — outlined rather than filled, so it never
      // reads as work already delivered.
      return { background: "transparent", color: "#15793f", fontWeight: 700, boxShadow: "0 0 0 1.5px #c9e6d4", textDecoration: "none" }
    default:
      return { background: "transparent", color: "#cbd2d9", fontWeight: 500, boxShadow: "none", textDecoration: "none" }
  }
}

/* -------------------------------------------------------------------------- */
/* How many cleans this month                                                 */
/* -------------------------------------------------------------------------- */

/** The shape the review screen holds a clean in. */
export interface CountableClean {
  date: string | Date
  status: string
  isOneOff?: boolean
}

export interface CleanCounts {
  /** Days that were serviced · what "9 cleans done" means. */
  completed: number
  /** Days scheduled but cancelled or skipped. */
  cancelled: number
  /** Days still ahead, or done but not yet marked. */
  scheduled: number
  oneoff: number
  /** Every day the month touched, whatever happened on it. */
  total: number
}

/**
 * Count a month's cleans, one answer for the whole review screen.
 *
 * This exists because the screen used to have two. The schedule card counted
 * the live cleans and said "9 cleans done"; the service summary above it read
 * `completedCount || jobCount` off the invoice candidate and said "0 cleans",
 * because a sent or manually-written invoice carries no job-derived counts.
 * Both numbers were on screen at once, three lines apart.
 *
 * Counted BY DAY, not by row, matching the calendar the reviewer is looking
 * at: a day carrying both a cancellation and a replacement visit is one day.
 */
export function countCleans(month: string, cleans: CountableClean[]): CleanCounts {
  const [year, month1] = month.split("-").map(Number)
  const priority: Record<string, number> = { completed: 4, oneoff: 3, scheduled: 2, cancelled: 1 }
  const byDay = new Map<number, string>()

  for (const clean of cleans) {
    const d = clean.date instanceof Date ? clean.date : new Date(clean.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() !== month1 - 1) continue

    const mark =
      clean.status === "CANCELLED" || clean.status === "SKIPPED"
        ? "cancelled"
        : clean.isOneOff
          ? "oneoff"
          : clean.status === "COMPLETED"
            ? "completed"
            : "scheduled"

    const prev = byDay.get(d.getDate())
    if (!prev || priority[mark] > priority[prev]) byDay.set(d.getDate(), mark)
  }

  const counts: CleanCounts = { completed: 0, cancelled: 0, scheduled: 0, oneoff: 0, total: byDay.size }
  for (const mark of byDay.values()) {
    counts[mark as keyof Omit<CleanCounts, "total">] += 1
  }
  return counts
}

/**
 * How many cleans this invoice is BILLING · what the total divides by.
 *
 * Every day the month holds except the cancelled ones. Not the same question
 * as "how many are done", which is what the schedule card's "9 cleans done"
 * answers: an invoice sent at the start of the month bills visits that have
 * not happened yet, and counting only completed ones would value a clean at
 * nothing and offer a $0 credit for a missed visit.
 *
 * Falls back to the candidate's own figures only while the live cleans are
 * still loading, so the number never flashes zero.
 */
export function billableCleanCount(
  counts: CleanCounts,
  fallback: { completedCount?: number | null; jobCount?: number | null },
): number {
  if (counts.total > 0) return counts.total - counts.cancelled
  return fallback.completedCount || fallback.jobCount || 0
}
