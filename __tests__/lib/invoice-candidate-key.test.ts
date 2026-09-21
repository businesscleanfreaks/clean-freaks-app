import { describe, it, expect } from "vitest"
import { invoiceCandidateKey, periodFromWorkDates, periodRange } from "@/lib/invoice-candidate-key"

describe("invoiceCandidateKey", () => {
  it("is stable regardless of the order the jobs came back in", () => {
    expect(invoiceCandidateKey("2026-08", ["loc-b", "loc-a"]))
      .toBe(invoiceCandidateKey("2026-08", ["loc-a", "loc-b"]))
  })

  it("collapses duplicates · many cleans at one location is still one location", () => {
    expect(invoiceCandidateKey("2026-08", ["loc-a", "loc-a", "loc-a"])).toBe("2026-08|loc-a")
  })

  it("separates the same client's locations, which are invoiced separately", () => {
    expect(invoiceCandidateKey("2026-08", ["office-1"]))
      .not.toBe(invoiceCandidateKey("2026-08", ["office-2"]))
  })

  it("separates a combined invoice from a single-location one", () => {
    expect(invoiceCandidateKey("2026-08", ["a", "b"])).not.toBe(invoiceCandidateKey("2026-08", ["a"]))
  })

  it("separates the same location across periods", () => {
    expect(invoiceCandidateKey("2026-08", ["a"])).not.toBe(invoiceCandidateKey("2026-09", ["a"]))
  })

  it("returns null when there is nothing to key on, so the caller skips the check", () => {
    expect(invoiceCandidateKey("2026-08", [])).toBeNull()
    expect(invoiceCandidateKey("august", ["a"])).toBeNull()
    expect(invoiceCandidateKey("", ["a"])).toBeNull()
  })
})

describe("periodRange", () => {
  it("covers the whole month, first day to last", () => {
    const r = periodRange("2026-08")!
    expect(r.start.toISOString()).toBe("2026-08-01T12:00:00.000Z")
    expect(r.end.toISOString()).toBe("2026-08-31T12:00:00.000Z")
  })

  it("is built at noon UTC, so reading it back in UTC gives the right month", () => {
    // These become billingPeriodStart, which lib/invoice-month.ts reads with
    // UTC accessors. Built at LOCAL midnight, the 1st read back in UTC is the
    // last day of the month before, and the invoice files itself a month early
    // for everyone ahead of UTC.
    const r = periodRange("2026-08")!
    expect(r.start.getUTCMonth()).toBe(7)
    expect(r.start.getUTCDate()).toBe(1)
  })

  it("handles a short month", () => {
    expect(periodRange("2026-02")!.end.toISOString()).toBe("2026-02-28T12:00:00.000Z")
  })

  it("handles a leap February", () => {
    expect(periodRange("2028-02")!.end.toISOString()).toBe("2028-02-29T12:00:00.000Z")
  })

  it("handles December, where the next month is a new year", () => {
    expect(periodRange("2026-12")!.end.toISOString()).toBe("2026-12-31T12:00:00.000Z")
  })

  it("refuses anything that is not a period", () => {
    expect(periodRange("2026-13")).toBeNull()
    expect(periodRange("2026-00")).toBeNull()
    expect(periodRange("August")).toBeNull()
    expect(periodRange("")).toBeNull()
  })
})

describe("periodFromWorkDates", () => {
  it("reads the month from the work when every line is in one month", () => {
    expect(periodFromWorkDates([
      new Date(Date.UTC(2026, 7, 5, 12)),
      new Date(Date.UTC(2026, 7, 26, 12)),
    ])).toBe("2026-08")
  })

  it("holds work on the first and last day in that month", () => {
    expect(periodFromWorkDates([
      new Date(Date.UTC(2026, 7, 1, 12)),
      new Date(Date.UTC(2026, 7, 31, 12)),
    ])).toBe("2026-08")
  })

  it("says nothing when the lines span months · that is a judgement, not an inference", () => {
    expect(periodFromWorkDates([
      new Date(Date.UTC(2026, 7, 26, 12)),
      new Date(Date.UTC(2026, 8, 2, 12)),
    ])).toBeNull()
  })

  it("says nothing when there are no dates to read", () => {
    expect(periodFromWorkDates([])).toBeNull()
    expect(periodFromWorkDates([null, undefined])).toBeNull()
  })

  it("ignores dates that will not parse rather than guessing", () => {
    expect(periodFromWorkDates(["not-a-date", new Date(Date.UTC(2026, 7, 5, 12))])).toBe("2026-08")
  })
})
