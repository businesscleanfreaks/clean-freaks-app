import { describe, it, expect } from 'vitest'
import { calculateScheduleDates } from '@/lib/regenerate-schedule-jobs'

// Helpers that mirror how the function builds dates (UTC, noon) so the
// assertions stay correct regardless of the machine's timezone or today's date.
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dow = (d: Date) => d.getUTCDay()
const DAY = 24 * 60 * 60 * 1000

// A weekly schedule whose day-of-week is derived from the start date, so the
// start clean is always included no matter which date we anchor on.
function weeklyParams(start: Date, frequency = 'WEEKLY') {
  return {
    frequency,
    startDate: start,
    endDate: null as Date | null,
    daysOfWeek: JSON.stringify([dow(start)]),
    monthlyPattern: null as string | null,
    customDates: null as string | null,
    excludedDates: null as string | null,
  }
}

describe('calculateScheduleDates — weekly cadence', () => {
  it('generates cleans on the right weekday, 7 days apart, starting on the start date', () => {
    const start = utc(2026, 5, 4)
    const dates = calculateScheduleDates(weeklyParams(start), utc(2026, 7, 1))

    expect(dates.length).toBeGreaterThan(0)
    expect(iso(dates[0])).toBe(iso(start))
    for (const d of dates) {
      expect(dow(d)).toBe(dow(start)) // always the same weekday
      expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime()) // never before start
    }
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(7 * DAY)
    }
  })
})

describe('calculateScheduleDates — weekly <-> bi-weekly change', () => {
  it('bi-weekly produces ~half the cleans of weekly, spaced 14 days apart', () => {
    const start = utc(2026, 5, 4)
    const end = utc(2026, 8, 1)
    const weekly = calculateScheduleDates(weeklyParams(start, 'WEEKLY'), end)
    const biweekly = calculateScheduleDates(weeklyParams(start, 'BI_WEEKLY'), end)

    expect(biweekly.length).toBeLessThan(weekly.length)
    expect(iso(biweekly[0])).toBe(iso(start)) // both still start on the start date
    for (let i = 1; i < biweekly.length; i++) {
      expect(biweekly[i].getTime() - biweekly[i - 1].getTime()).toBe(14 * DAY)
    }
  })
})

describe('calculateScheduleDates — cleaning-day change', () => {
  it('moving the day of week moves every clean to the new day', () => {
    const start = utc(2026, 5, 4) // a Monday-ish anchor
    const newDay = (dow(start) + 2) % 7
    const dates = calculateScheduleDates(
      { ...weeklyParams(start), daysOfWeek: JSON.stringify([newDay]) },
      utc(2026, 7, 1),
    )
    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) expect(dow(d)).toBe(newDay)
  })
})

describe('calculateScheduleDates — a single skipped/cancelled clean', () => {
  it('removes exactly the excluded date and nothing else', () => {
    const start = utc(2026, 5, 4)
    const base = calculateScheduleDates(weeklyParams(start), utc(2026, 7, 1))
    const skip = iso(base[1])

    const withSkip = calculateScheduleDates(
      { ...weeklyParams(start), excludedDates: JSON.stringify([skip]) },
      utc(2026, 7, 1),
    )
    expect(withSkip.map(iso)).not.toContain(skip)
    expect(withSkip.length).toBe(base.length - 1)
  })
})

describe('calculateScheduleDates — split schedule cannot create pre-start duplicates', () => {
  it('never emits a date before the start, even with a wide window', () => {
    const newIntervalStart = utc(2026, 6, 11) // a schedule split that begins mid-June
    const dates = calculateScheduleDates(weeklyParams(newIntervalStart), utc(2026, 9, 1))

    expect(dates.length).toBeGreaterThan(0)
    expect(iso(dates[0])).toBe(iso(newIntervalStart))
    for (const d of dates) expect(d.getTime()).toBeGreaterThanOrEqual(newIntervalStart.getTime())
  })
})

describe('calculateScheduleDates — month boundaries', () => {
  it('a May window only ever yields May cleans (no bleed into April/June)', () => {
    const start = utc(2026, 5, 1)
    const mayDates = calculateScheduleDates(
      { ...weeklyParams(start), daysOfWeek: JSON.stringify([dow(start)]) },
      utc(2026, 5, 31),
    )
    expect(mayDates.length).toBeGreaterThan(0)
    for (const d of mayDates) expect(d.getUTCMonth()).toBe(4) // 4 === May
  })

  it('honors an end date — no cleans generated past it', () => {
    const start = utc(2026, 5, 4)
    const end = utc(2026, 5, 20)
    const dates = calculateScheduleDates(
      { ...weeklyParams(start), endDate: end },
      utc(2026, 8, 1),
    )
    for (const d of dates) expect(d.getTime()).toBeLessThanOrEqual(end.getTime())
  })
})

describe('calculateScheduleDates — monthly "nth weekday" pattern', () => {
  it('"1st & 3rd Tuesday" yields two Tuesdays per month', () => {
    const dates = calculateScheduleDates(
      {
        frequency: 'MONTHLY',
        startDate: utc(2026, 5, 1),
        endDate: null,
        daysOfWeek: null,
        monthlyPattern: JSON.stringify({ type: 'NTH_WEEKDAY', weekday: 2, weeks: [1, 3] }),
        customDates: null,
        excludedDates: null,
      },
      utc(2026, 7, 31),
    )
    expect(dates.length).toBe(6) // 3 months x 2 Tuesdays
    for (const d of dates) expect(dow(d)).toBe(2) // Tuesday
  })
})
