/**
 * The Month / Quarter / All time range on a cleaner's profile.
 *
 * One anchor month drives all three: a quarter is the one containing it, and
 * all-time ignores it. Keeping a single anchor means switching Month → Quarter
 * → Month lands you back where you were rather than resetting to today.
 */

export type RangeKind = "month" | "quarter" | "all"

export const RANGE_LABELS: Record<RangeKind, string> = {
  month: "Month",
  quarter: "Quarter",
  all: "All time",
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export interface RangeBounds {
  /** Inclusive, or null for all time. */
  start: string | null
  /** Inclusive, or null for all time. */
  end: string | null
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** The first and last day the range covers, as yyyy-MM-dd. */
export function rangeBounds(period: string, kind: RangeKind): RangeBounds {
  if (kind === "all") return { start: null, end: null }
  const [y, m] = period.split("-").map(Number)
  if (kind === "quarter") {
    const firstMonth = Math.floor((m - 1) / 3) * 3
    return {
      start: iso(new Date(y, firstMonth, 1)),
      end: iso(new Date(y, firstMonth + 3, 0)),
    }
  }
  return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) }
}

/** What the range reads as on screen. */
export function rangeLabel(period: string, kind: RangeKind): string {
  if (kind === "all") return "All time"
  const [y, m] = period.split("-").map(Number)
  if (kind === "quarter") return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
  return `${FULL_MONTHS[m - 1]} ${y}`
}

/**
 * How an empty state names the range it found nothing in.
 *
 * "No one-off jobs in All time" is not a sentence, so all-time gets its own
 * wording rather than being dropped into the same slot.
 */
export function inRangePhrase(period: string, kind: RangeKind): string {
  return kind === "all" ? "on record" : `in ${rangeLabel(period, kind)}`
}

/**
 * Step the anchor. A quarter steps three months so the label moves Q1 → Q2,
 * not Q1 → Q1 twice.
 */
export function stepRange(period: string, kind: RangeKind, by: number): string {
  const months = kind === "quarter" ? by * 3 : by
  const [y, m] = period.split("-").map(Number)
  const d = new Date(y, m - 1 + months, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** All time has nothing to step through, so the arrows come off. */
export function showsSteppers(kind: RangeKind): boolean {
  return kind !== "all"
}

/**
 * Whether stepping forward would leave the present behind. A quarter counts as
 * current for the whole quarter, so you can still reach its later months.
 */
export function isAtPresent(period: string, kind: RangeKind, today = new Date()): boolean {
  if (kind === "all") return true
  const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  if (kind === "month") return period >= now
  const q = (p: string) => {
    const [y, m] = p.split("-").map(Number)
    return y * 4 + Math.floor((m - 1) / 3)
  }
  return q(period) >= q(now)
}
