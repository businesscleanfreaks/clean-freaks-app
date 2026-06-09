import { prisma } from '@/lib/db'
import { calculateScheduleDates } from '@/lib/regenerate-schedule-jobs'

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
export async function computeClientProration(
  clientId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<LocationProration[]> {
  const mStart = utcDateOnly(monthStart)
  const mEnd = utcDateOnly(monthEnd)

  const locations = await prisma.location.findMany({
    where: { clientId },
    include: {
      schedules: {
        where: { isActive: true, clientPayType: 'FLAT_RATE' },
      },
      jobs: {
        where: { date: { gte: mStart, lte: mEnd }, status: { not: 'CANCELLED' } },
        select: { id: true, date: true, scheduleId: true },
      },
    },
  })

  const out: LocationProration[] = []

  for (const loc of locations) {
    const flatScheds = loc.schedules
    if (flatScheds.length === 0) continue

    // Shared cadence across a pause-split (intervals share frequency/days). Use
    // the most recent as the representative pattern + rate.
    const rep = [...flatScheds].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0]
    const flatRate = rep.defaultClientRate || 0

    // Service span this month = earliest interval start … latest interval end.
    const starts = flatScheds.map((s) => utcDateOnly(new Date(s.startDate)))
    const ends = flatScheds.map((s) => (s.endDate ? utcDateOnly(new Date(s.endDate)) : mEnd))
    const serviceStart = starts.reduce((a, b) => (a < b ? a : b))
    const serviceEnd = ends.reduce((a, b) => (a > b ? a : b))
    const spanStart = serviceStart > mStart ? serviceStart : mStart
    const spanEnd = serviceEnd < mEnd ? serviceEnd : mEnd
    if (spanStart > spanEnd) continue

    const expectedDates = calculateScheduleDates(
      {
        frequency: rep.frequency,
        startDate: spanStart,
        endDate: spanEnd,
        daysOfWeek: rep.daysOfWeek,
        monthlyPattern: rep.monthlyPattern,
        customDates: rep.customDates,
        excludedDates: null, // ignore excludedDates so a pause shows as missed, not as "expected was lower"
      },
      spanEnd,
    ).filter((d) => d >= spanStart && d <= spanEnd)

    const expected = expectedDates.length
    const flatSchedIds = new Set(flatScheds.map((s) => s.id))
    const actual = loc.jobs.filter((j) => j.scheduleId && flatSchedIds.has(j.scheduleId)).length
    const missed = Math.max(0, expected - actual)
    if (missed === 0 || expected === 0) continue

    const perClean = flatRate / expected
    const credit = Math.round(missed * perClean)
    if (credit <= 0) continue

    out.push({
      locationId: loc.id,
      locationName: loc.name || loc.address?.split(',')[0] || 'Location',
      scheduleId: rep.id,
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
