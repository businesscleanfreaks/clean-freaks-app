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
