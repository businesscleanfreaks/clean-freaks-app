import { describe, it, expect } from "vitest"
import { unmatchedExpectedDates } from "@/lib/proration-matching"

const utc = (d: number) => new Date(Date.UTC(2026, 4, d, 12, 0, 0))
const days = (dates: Date[]) => dates.map(d => d.getUTCDate())

describe("cleans that happened on the day they were expected", () => {
  it("leave nothing missed", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    expect(unmatchedExpectedDates(expected, expected)).toEqual([])
  })
})

describe("a clean moved to a different day", () => {
  it("covers the visit it replaced", () => {
    // The reported defect: matching by exact date left the 11th unmatched and
    // credited the client for a clean they actually received.
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    const actual = [utc(4), utc(12), utc(18), utc(25)]
    expect(unmatchedExpectedDates(expected, actual)).toEqual([])
  })

  it("covers it even when moved several days", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    const actual = [utc(4), utc(15), utc(18), utc(25)]
    expect(unmatchedExpectedDates(expected, actual)).toEqual([])
  })

  it("settles against the nearest owed visit, not an arbitrary one", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    const actual = [utc(4), utc(12)]
    // The 12th is nearest the 11th, so the 18th and 25th are what went undone.
    expect(days(unmatchedExpectedDates(expected, actual))).toEqual([18, 25])
  })
})

describe("cleans that genuinely did not happen", () => {
  it("counts each one", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    expect(days(unmatchedExpectedDates(expected, [utc(4), utc(12), utc(18)]))).toEqual([25])
  })

  it("counts them all when nothing happened", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    expect(days(unmatchedExpectedDates(expected, []))).toEqual([4, 11, 18, 25])
  })

  it("never reports more missed than were expected", () => {
    const expected = [utc(4), utc(11)]
    const actual = [utc(4), utc(5), utc(6), utc(11), utc(20)]
    expect(unmatchedExpectedDates(expected, actual)).toEqual([])
  })
})

describe("the shape of the answer", () => {
  it("keeps the expected dates in the order they were given", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    expect(days(unmatchedExpectedDates(expected, [utc(11)]))).toEqual([4, 18, 25])
  })

  it("does not depend on the order the cleans arrived in", () => {
    const expected = [utc(4), utc(11), utc(18), utc(25)]
    const forwards = unmatchedExpectedDates(expected, [utc(5), utc(19)])
    const backwards = unmatchedExpectedDates(expected, [utc(19), utc(5)])
    expect(days(forwards)).toEqual(days(backwards))
  })

  it("returns nothing when nothing was expected", () => {
    expect(unmatchedExpectedDates([], [utc(4)])).toEqual([])
  })
})
