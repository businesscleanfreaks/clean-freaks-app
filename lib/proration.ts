import { prisma } from '@/lib/db'
import { calculateScheduleDates } from '@/lib/regenerate-schedule-jobs'
import { pausePolicyForDate } from '@/lib/pause-billing'
import { calculateVisitPauseCredit } from '@/lib/pause-credit'
import { unmatchedExpectedDates } from './proration-matching'

export interface LocationProration {
  locationId: string
  locationName: string
  scheduleId: string // representative flat-rate schedule (for scoping the credit on split candidates)
  flatRate: number
  expected: number
  actual: number
  missed: number
  perClean: number
  credit: number
}

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

/**
 * Per-location proration for a flat-rate client over a billing month.
 *
 * "Missed" cleans can't be read off CANCELLED jobs — a pause *deletes* the jobs.
 * So we compare the pattern over the location's actual service span this month
 * (which spans any pause gap, since a pause is a gap between same-cadence
 * intervals) against the cleans actually scheduled. Using the service span, not
 * the raw month, means a schedule that legitimately starts/ends mid-month does
 * NOT produce a spurious credit.
 *
 *   credit = round( missed × (flatRate ÷ expected) )
 */
const prorationInclude = (mStart: Date, mEnd: Date) => ({
  schedules: {
    where: { isActive: true, clientPayType: 'FLAT_RATE' as const },
  },
  jobs: {
    where: { date: { gte: mStart, lte: mEnd }, status: { not: 'CANCELLED' } },
    select: { id: true, date: true, scheduleId: true },
  },
})

type ProrationLocation = Awaited<ReturnType<typeof loadProrationLocations>>[number]

async function loadProrationLocations(where: { clientId: string | { in: string[] } }, mStart: Date, mEnd: Date) {
  return prisma.location.findMany({ where, include: prorationInclude(mStart, mEnd) })
}

export async function computeClientProration(
  clientId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<LocationProration[]> {
  const mStart = utcDateOnly(monthStart)
  const mEnd = utcDateOnly(monthEnd)
  const locations = await loadProrationLocations({ clientId }, mStart, mEnd)
  return prorationForLocations(locations, mStart, mEnd)
}

/**
 * The same computation for many clients in ONE query.
 *
 * The invoice workspace needs this per client; calling the single-client
 * version inside its loop meant one round trip per client, which was the
 * slowest part of building the candidate list.
 */
export async function computeClientProrationBatch(
  clientIds: string[],
  monthStart: Date,
  monthEnd: Date,
): Promise<Map<string, LocationProration[]>> {
  const byClient = new Map<string, LocationProration[]>()
  if (clientIds.length === 0) return byClient

  const mStart = utcDateOnly(monthStart)
  const mEnd = utcDateOnly(monthEnd)
  const locations = await loadProrationLocations({ clientId: { in: clientIds } }, mStart, mEnd)

  const grouped = new Map<string, ProrationLocation[]>()
  for (const loc of locations) {
    const list = grouped.get(loc.clientId) ?? []
    list.push(loc)
    grouped.set(loc.clientId, list)
  }
  for (const [clientId, locs] of grouped) {
    byClient.set(clientId, prorationForLocations(locs, mStart, mEnd))
  }
  return byClient
}

function prorationForLocations(
  locations: ProrationLocation[],
  mStart: Date,
  mEnd: Date,
): LocationProration[] {
  const out: LocationProration[] = []

  for (const loc of locations) {
    const flatScheds = loc.schedules
    if (flatScheds.length === 0) continue

    // A pause split keeps one logical cadence. Anchor interval frequencies
    // (biweekly/every-N-weeks) to the earliest interval so the resumed record
    // does not reset the cadence, while using the latest configured rate.
    const sortedSchedules = [...flatScheds].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )
    const cadenceSchedule = sortedSchedules[0]
    const representativeSchedule = sortedSchedules[sortedSchedules.length - 1]
    const flatRate = representativeSchedule.defaultClientRate || 0

    // Service span this month = earliest interval start … latest interval end.
    // How far an interval's service reaches. A paused interval reaches to the
    // end of its pause, because the visits inside a pause are still expected ·
    // that is what makes them creditable. Used for the month's span AND for
    // each interval's own segment below, so the two cannot disagree.
    const effectiveEnd = (schedule: (typeof flatScheds)[number]): Date => {
      const intervalEnd = schedule.endDate ? utcDateOnly(new Date(schedule.endDate)) : mEnd
      if (!schedule.pauseFrom) return intervalEnd

      const pauseStart = utcDateOnly(new Date(schedule.pauseFrom))
      const pauseEnd = schedule.pauseTo ? utcDateOnly(new Date(schedule.pauseTo)) : mEnd
      const pauseOverlapsMonth = pauseStart <= mEnd && pauseEnd >= mStart
      return pauseOverlapsMonth && pauseEnd > intervalEnd ? pauseEnd : intervalEnd
    }

    const starts = flatScheds.map((s) => utcDateOnly(new Date(s.startDate)))
    const ends = flatScheds.map(effectiveEnd)
    const serviceStart = starts.reduce((a, b) => (a < b ? a : b))
    const serviceEnd = ends.reduce((a, b) => (a > b ? a : b))
    const spanStart = serviceStart > mStart ? serviceStart : mStart
    const spanEnd = serviceEnd < mEnd ? serviceEnd : mEnd
    if (spanStart > spanEnd) continue

    // Expected dates come from EACH interval's own pattern, over its own range.
    //
    // They used to come from the earliest interval for the whole month. A
    // "change going forward" · weekly Monday until the 14th, weekly Tuesday
    // from the 15th · therefore expected Mondays all month, while the work
    // after the change happened on Tuesdays. Every one of those was counted as
    // a missed visit and credited, for a month that was fully served.
    //
    // A GAP between intervals still has to be expected, though: that is what a
    // pause is, and the visits inside it are exactly the ones a credit is for.
    // So a gap is covered by the interval that was running when it began · the
    // cadence that would have continued had the pause not happened.
    //
    // The cadence ANCHOR always comes from the earliest interval, so a split
    // keeps the client's existing every-other-week rhythm instead of
    // restarting it. That is what the anchor is for; the pattern is not.
    const oneDay = 24 * 60 * 60 * 1000
    const segments: Array<{ schedule: (typeof sortedSchedules)[number]; from: Date; to: Date }> = []
    let cursor = spanStart

    for (const schedule of sortedSchedules) {
      const intervalStart = utcDateOnly(new Date(schedule.startDate))
      const intervalEnd = effectiveEnd(schedule)
      const from = intervalStart > spanStart ? intervalStart : spanStart
      const to = intervalEnd < spanEnd ? intervalEnd : spanEnd
      if (from > to) continue

      // The gap before this interval belongs to whatever was running before it.
      if (from > cursor && segments.length > 0) {
        const previous = segments[segments.length - 1]
        segments.push({
          schedule: previous.schedule,
          from: cursor,
          to: new Date(from.getTime() - oneDay),
        })
      }

      segments.push({ schedule, from, to })
      const next = new Date(to.getTime() + oneDay)
      if (next > cursor) cursor = next
    }

    // Service continuing past the last interval's end (a pause with no resumed
    // record yet) is still expected, on the last interval's cadence.
    if (segments.length > 0 && cursor <= spanEnd) {
      segments.push({ schedule: segments[segments.length - 1].schedule, from: cursor, to: spanEnd })
    }

    const expectedDateKeys = new Set<string>()
    const expectedDates: Date[] = []
    for (const segment of segments) {
      const dates = calculateScheduleDates(
        {
          frequency: segment.schedule.frequency,
          cadenceAnchor: cadenceSchedule.cadenceAnchor ?? cadenceSchedule.startDate,
          startDate: segment.schedule.startDate,
          endDate: segment.to,
          daysOfWeek: segment.schedule.daysOfWeek,
          monthlyPattern: segment.schedule.monthlyPattern,
          customDates: segment.schedule.customDates,
          excludedDates: null, // ignore excludedDates so a pause shows as missed, not as "expected was lower"
        },
        segment.to,
      ).filter((d) => d >= segment.from && d <= segment.to)

      for (const date of dates) {
        const key = utcDateOnly(date).toISOString().slice(0, 10)
        if (expectedDateKeys.has(key)) continue
        expectedDateKeys.add(key)
        expectedDates.push(date)
      }
    }
    expectedDates.sort((a, b) => a.getTime() - b.getTime())

    const expected = expectedDates.length
    const flatSchedIds = new Set(flatScheds.map((s) => s.id))
    const actualJobs = loc.jobs.filter((j) => j.scheduleId && flatSchedIds.has(j.scheduleId))

    // A clean that happened covers a visit that was owed, even if it happened
    // on a different day. Matching by exact date credited the client for a
    // clean moved from Tuesday to Wednesday · they got the visit, and were
    // refunded for it. See lib/proration-matching.ts.
    const missingDates = unmatchedExpectedDates(
      expectedDates,
      actualJobs.map((job) => utcDateOnly(job.date)),
    )
    const creditableMissingDates = missingDates.filter((date) => {
      const pausePolicy = pausePolicyForDate(flatScheds, date)
      if (!pausePolicy) return true

      const billing = pausePolicy.pauseBilling ?? 'REDUCE'
      const creditMode = pausePolicy.pauseCreditMode ?? 'VISITS'
      return billing === 'REDUCE' && creditMode === 'VISITS'
    })
    const actual = actualJobs.length
    const missed = creditableMissingDates.length
    if (missed === 0 || expected === 0) continue

    const perClean = flatRate / expected
    const credit = calculateVisitPauseCredit(flatRate, missed, expected)
    if (credit <= 0) continue

    out.push({
      locationId: loc.id,
      locationName: loc.name || loc.address?.split(',')[0] || 'Location',
      scheduleId: representativeSchedule.id,
      flatRate,
      expected,
      actual,
      missed,
      perClean,
      credit,
    })
  }

  return out
}
