import { describe, it, expect } from "vitest"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { calculateScheduleDates, type ScheduleDateParams } from "@/lib/schedule-dates"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const OCT = utc(2026, 10, 1)

const params = (over: Partial<ScheduleDateParams> = {}): ScheduleDateParams => ({
  frequency: "WEEKLY",
  startDate: utc(2026, 7, 9),
  endDate: null,
  daysOfWeek: JSON.stringify([4]),
  monthlyPattern: null,
  customDates: null,
  excludedDates: null,
  ...over,
})

/** What the calendar actually gets over the same three months, averaged. */
function generatorAverage(p: ScheduleDateParams, anchor: Date) {
  const end = utc(anchor.getUTCFullYear(), anchor.getUTCMonth() + 4, 0)
  const from = utc(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)
  return calculateScheduleDates(p, end).filter(d => d >= from).length / 3
}

describe("the monthly average counts the cleans the calendar gets", () => {
  it("counts a weekly-type schedule saved without days, on its start day", () => {
    // Design Studio: every 4 weeks, no days ticked, started Thu Jul 9. The
    // generator falls back to the start day and books Oct 1, Oct 29, Nov 26.
    // The private copy the averages used had no fallback, so it counted none
    // and the client showed $0 a month.
    const p = params({ frequency: "EVERY_4_WEEKS", daysOfWeek: "[]" })
    const average = getAverageScheduleOccurrencesPerMonth(p, OCT)
    expect(average).toBeGreaterThan(0)
    expect(average).toBe(generatorAverage(p, OCT))
  })

  it("follows the cadence anchor after a split", () => {
    // An every-4-weeks Thursday series that began Jan 22 was split on Mon
    // Sep 14. It keeps its rhythm: Oct 1, Oct 29, Nov 26, Dec 24. The copy
    // counted weeks from Sep 14 instead, got Oct 15, Nov 12, Dec 10, and so
    // one clean short over the quarter.
    const p = params({
      frequency: "EVERY_4_WEEKS",
      startDate: utc(2026, 9, 14),
      cadenceAnchor: utc(2026, 1, 22),
    })
    expect(getAverageScheduleOccurrencesPerMonth(p, OCT)).toBeCloseTo(4 / 3, 5)
    expect(getAverageScheduleOccurrencesPerMonth(p, OCT)).toBe(generatorAverage(p, OCT))
  })

  it("reads a monthly pattern that has the shape but not the label", () => {
    const p = params({ frequency: "2X_MONTHLY", daysOfWeek: null, monthlyPattern: '{"weekday":1,"weeks":[1,3]}' })
    expect(getAverageScheduleOccurrencesPerMonth(p, OCT)).toBe(2)
  })

  it("still counts an ordinary twice-weekly schedule", () => {
    // Oct 9, Nov 8, Dec 9 Tue/Fri visits · 26 over three months.
    const p = params({ daysOfWeek: JSON.stringify([2, 5]) })
    expect(getAverageScheduleOccurrencesPerMonth(p, OCT)).toBeCloseTo(26 / 3, 5)
  })

  it("stops counting at the schedule's end", () => {
    const p = params({ endDate: utc(2026, 10, 31) })
    // Five Thursdays in October, none after.
    expect(getAverageScheduleOccurrencesPerMonth(p, OCT)).toBeCloseTo(5 / 3, 5)
  })
})
