import { describe, it, expect } from "vitest"
import {
  inRangePhrase,
  isAtPresent,
  rangeBounds,
  rangeLabel,
  showsSteppers,
  stepRange,
} from "@/lib/profile-range"

describe("rangeBounds", () => {
  it("covers exactly the month", () => {
    expect(rangeBounds("2026-08", "month")).toEqual({ start: "2026-08-01", end: "2026-08-31" })
  })

  it("handles a short month", () => {
    expect(rangeBounds("2026-02", "month").end).toBe("2026-02-28")
  })

  it("covers the quarter containing the month", () => {
    expect(rangeBounds("2026-08", "quarter")).toEqual({ start: "2026-07-01", end: "2026-09-30" })
    expect(rangeBounds("2026-01", "quarter")).toEqual({ start: "2026-01-01", end: "2026-03-31" })
    expect(rangeBounds("2026-12", "quarter")).toEqual({ start: "2026-10-01", end: "2026-12-31" })
  })

  it("is unbounded for all time", () => {
    expect(rangeBounds("2026-08", "all")).toEqual({ start: null, end: null })
  })
})

describe("rangeLabel", () => {
  it("names the month", () => {
    expect(rangeLabel("2026-08", "month")).toBe("August 2026")
  })

  it("names the quarter, not the month", () => {
    expect(rangeLabel("2026-08", "quarter")).toBe("Q3 2026")
    expect(rangeLabel("2026-03", "quarter")).toBe("Q1 2026")
  })

  it("says all time", () => {
    expect(rangeLabel("2026-08", "all")).toBe("All time")
  })
})

describe("stepRange", () => {
  it("steps one month at a time in month mode", () => {
    expect(stepRange("2026-08", "month", -1)).toBe("2026-07")
    expect(stepRange("2026-12", "month", 1)).toBe("2027-01")
  })

  it("steps a whole quarter in quarter mode", () => {
    // Q3 back one lands in Q2, not earlier in Q3.
    expect(rangeLabel(stepRange("2026-08", "quarter", -1), "quarter")).toBe("Q2 2026")
    expect(rangeLabel(stepRange("2026-11", "quarter", 1), "quarter")).toBe("Q1 2027")
  })

  it("rolls the year over correctly", () => {
    expect(stepRange("2026-01", "month", -1)).toBe("2025-12")
  })
})

describe("showsSteppers", () => {
  it("hides the arrows on all time · there is nothing to step", () => {
    expect(showsSteppers("all")).toBe(false)
    expect(showsSteppers("month")).toBe(true)
    expect(showsSteppers("quarter")).toBe(true)
  })
})

describe("isAtPresent", () => {
  const today = new Date("2026-08-15T12:00:00")

  it("stops the month stepper at this month", () => {
    expect(isAtPresent("2026-08", "month", today)).toBe(true)
    expect(isAtPresent("2026-07", "month", today)).toBe(false)
  })

  it("lets a quarter run to its end even past today", () => {
    // September is still Q3, which is the current quarter.
    expect(isAtPresent("2026-07", "quarter", today)).toBe(true)
    expect(isAtPresent("2026-04", "quarter", today)).toBe(false)
  })

  it("is always current for all time", () => {
    expect(isAtPresent("2020-01", "all", today)).toBe(true)
  })
})

describe("inRangePhrase", () => {
  it("names the month or quarter it looked in", () => {
    expect(inRangePhrase("2026-08", "month")).toBe("in August 2026")
    expect(inRangePhrase("2026-08", "quarter")).toBe("in Q3 2026")
  })

  it("reads as a sentence for all time", () => {
    // "No one-off jobs in All time" is not English.
    expect(inRangePhrase("2026-08", "all")).toBe("on record")
  })
})
