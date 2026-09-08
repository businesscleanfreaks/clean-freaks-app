import { describe, it, expect } from "vitest"
import { calculateScheduleDates, weeksBetweenUtc } from "@/lib/regenerate-schedule-jobs"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const until = utc(2026, 11, 30)

const series = (startDate: Date, cadenceAnchor?: Date | null, frequency = "BI_WEEKLY") =>
  calculateScheduleDates(
    {
      frequency,
      daysOfWeek: JSON.stringify([3]), // Wednesday
      startDate,
      cadenceAnchor: cadenceAnchor ?? null,
      endDate: null,
      excludedDates: null,
      monthlyPattern: null,
      customDates: null,
    },
    until,
  ).map(d => d.toISOString().slice(0, 10))

describe("weeksBetweenUtc", () => {
  it("counts whole weeks from the anchor's week", () => {
    expect(weeksBetweenUtc(utc(2026, 9, 2), utc(2026, 9, 2))).toBe(0)
    expect(weeksBetweenUtc(utc(2026, 9, 2), utc(2026, 9, 9))).toBe(1)
    expect(weeksBetweenUtc(utc(2026, 9, 2), utc(2026, 9, 16))).toBe(2)
  })

  it("treats the whole Sun-Sat week as one step", () => {
    // Sep 6 2026 is a Sunday, Sep 12 the Saturday after.
    expect(weeksBetweenUtc(utc(2026, 9, 2), utc(2026, 9, 6))).toBe(1)
    expect(weeksBetweenUtc(utc(2026, 9, 2), utc(2026, 9, 12))).toBe(1)
  })

  it("goes negative before the anchor", () => {
    expect(weeksBetweenUtc(utc(2026, 9, 16), utc(2026, 9, 2))).toBe(-2)
  })
})

describe("bi-weekly cadence after a change going forward", () => {
  const anchor = utc(2026, 9, 2) // the original series' first clean, a Wednesday
  const original = series(anchor)

  it("runs every other Wednesday from the anchor", () => {
    expect(original.slice(0, 5)).toEqual([
      "2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28",
    ])
  })

  it("keeps the client's rhythm when split on an off-week day", () => {
    // Verified against the live engine before the fix: splitting effective
    // Thursday 09-10 produced 09-23, 10-07, 10-21 · the whole future series a
    // week out, with calendar, cleaner pay and invoices all following it.
    const split = series(utc(2026, 9, 10), anchor)
    expect(split.slice(0, 4)).toEqual(["2026-09-16", "2026-09-30", "2026-10-14", "2026-10-28"])
    expect(split.every(d => original.includes(d))).toBe(true)
  })

  it("keeps the rhythm whatever weekday the change takes effect on", () => {
    for (const day of [10, 11, 12, 13, 14, 15, 16]) {
      const split = series(utc(2026, 9, day), anchor)
      expect(split.every(d => original.includes(d))).toBe(true)
    }
  })

  it("behaves exactly as before when no anchor is recorded", () => {
    // Existing schedules have a null anchor until backfilled; they must not
    // change shape underneath anyone.
    expect(series(anchor, null)).toEqual(original)
  })

  it("leaves weekly schedules untouched", () => {
    const weekly = series(utc(2026, 9, 2), null, "WEEKLY")
    const weeklySplit = series(utc(2026, 9, 10), utc(2026, 9, 2), "WEEKLY")
    expect(weekly.slice(0, 3)).toEqual(["2026-09-02", "2026-09-09", "2026-09-16"])
    expect(weeklySplit.slice(0, 2)).toEqual(["2026-09-16", "2026-09-23"])
  })
})
