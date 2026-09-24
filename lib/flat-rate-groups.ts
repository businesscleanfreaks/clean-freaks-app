/**
 * Which flat-rate schedule intervals are one monthly service, and what that
 * service is billed in a given month.
 *
 * A flat-rate client is billed one "Monthly Cleaning" line per service per
 * month. Two things split one service into several schedule rows:
 *
 *   - a pause ends the interval and starts a resumed one after the pause, and
 *   - "change going forward" (a new price, cleaner or pattern from a date)
 *     ends the interval the day before and starts a new one on that date.
 *
 * Only pauses were joined back together, so a price change made mid-month
 * billed the client two full months: the old price for the month and the new
 * price for the same month (bug review A4).
 *
 * Josh's rule (2026-09-24): when a flat monthly price changes partway through a
 * month, the NEW price applies to the whole month. It is rare, and when it
 * should not, the draft invoice is edited before it goes out · so the month is
 * flagged for review rather than decided silently.
 *
 * Joining is kept narrow on purpose. Two flat-rate schedules at one location
 * can be genuinely separate services (a weekly clean and a monthly deep
 * clean), billed separately. A continuation is recognised by what "change
 * going forward" writes: it starts the day after the other ended, and carries
 * the original series' cadence anchor.
 *
 * Pure: no Prisma, no clock.
 */

export interface FlatInterval {
  id: string
  startDate: Date
  endDate: Date | null
  cadenceAnchor?: Date | null
  pauseFrom?: Date | null
  pauseTo: Date | null
  frequency: string
  daysOfWeek: string | null
  monthlyPattern: string | null
  customDates: string | null
  defaultClientRate: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Calendar day of a date-only value stored at noon UTC. */
const dayKey = (date: Date) => date.toISOString().slice(0, 10)
const nextDayKey = (date: Date) => dayKey(new Date(date.getTime() + DAY_MS))

/** The resumed interval after a pause: same service, same terms. */
function resumesAfterPause(earlier: FlatInterval, later: FlatInterval): boolean {
  if (!earlier.pauseTo) return false
  return nextDayKey(earlier.pauseTo) === dayKey(later.startDate)
    && earlier.frequency === later.frequency
    && earlier.daysOfWeek === later.daysOfWeek
    && earlier.monthlyPattern === later.monthlyPattern
    && earlier.customDates === later.customDates
    && earlier.defaultClientRate === later.defaultClientRate
}

/**
 * The new interval "change going forward" created: it starts the day after
 * the earlier one ended and belongs to the same series. Rows split before the
 * cadence anchor was recorded carry none, and are recognised by the dates.
 */
function continuesAfterChange(earlier: FlatInterval, later: FlatInterval): boolean {
  if (!earlier.endDate || nextDayKey(earlier.endDate) !== dayKey(later.startDate)) return false
  if (!later.cadenceAnchor) return true
  return dayKey(later.cadenceAnchor) === dayKey(earlier.cadenceAnchor ?? earlier.startDate)
}

/**
 * How a later interval follows an earlier one at the same location, if it
 * does: the resumption after a pause, or the new terms from a change made
 * going forward. The client history names these instead of "schedule started".
 */
export function continuationKind(earlier: FlatInterval, later: FlatInterval): "resumed" | "changed" | null {
  if (resumesAfterPause(earlier, later)) return "resumed"
  if (continuesAfterChange(earlier, later)) return "changed"
  return null
}

/**
 * Billing group for each of ONE location's flat-rate schedules: the id of the
 * first interval of the service it belongs to.
 */
export function flatBillingGroups(schedules: FlatInterval[]): Map<string, string> {
  const ordered = [...schedules].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  const groupOf = new Map<string, string>()
  ordered.forEach((schedule, index) => {
    const predecessor = ordered
      .slice(0, index)
      .reverse()
      .find(earlier => resumesAfterPause(earlier, schedule) || continuesAfterChange(earlier, schedule))
    groupOf.set(schedule.id, predecessor ? groupOf.get(predecessor.id) ?? predecessor.id : schedule.id)
  })
  return groupOf
}

const servesPeriod = (s: FlatInterval, from: Date, to: Date) =>
  s.startDate <= to && (!s.endDate || s.endDate >= from)

const pausedInPeriod = (s: FlatInterval, from: Date, to: Date) =>
  !!s.pauseFrom && s.pauseFrom <= to && (!s.pauseTo || s.pauseTo >= from)

/** The service has anything to bill in the period: work, or a pause to account for. */
export function groupOverlapsPeriod(group: FlatInterval[], from: Date, to: Date): boolean {
  return group.some(s => servesPeriod(s, from, to) || pausedInPeriod(s, from, to))
}

/**
 * The interval whose terms bill this month: the latest one running in it, so
 * a price that changed mid-month bills the whole month at the new price. A
 * month spent entirely paused bills on the terms that were paused.
 */
export function intervalForPeriod<T extends FlatInterval>(group: T[], from: Date, to: Date): T {
  const latest = (list: T[]) => [...list].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0]
  const serving = group.filter(s => servesPeriod(s, from, to))
  if (serving.length > 0) return latest(serving)
  const paused = group.filter(s => pausedInPeriod(s, from, to))
  if (paused.length > 0) return latest(paused)
  return latest(group)
}

export interface MidMonthPriceChange {
  from: number
  to: number
  /** The day the new price took effect. */
  effective: Date
}

/**
 * The price change inside this month, if there was one, so the reviewer sees
 * that the whole month is billed at the new price.
 */
export function midMonthPriceChange(group: FlatInterval[], from: Date, to: Date): MidMonthPriceChange | null {
  const serving = group
    .filter(s => servesPeriod(s, from, to))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  for (let i = serving.length - 1; i > 0; i--) {
    const later = serving[i]
    const earlier = serving[i - 1]
    if (later.startDate > from && later.defaultClientRate !== earlier.defaultClientRate) {
      return { from: earlier.defaultClientRate, to: later.defaultClientRate, effective: later.startDate }
    }
  }
  return null
}
