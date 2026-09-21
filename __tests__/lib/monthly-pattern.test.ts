import { describe, it, expect } from "vitest"
import { normaliseMonthlyPattern } from "@/lib/monthly-pattern"

describe("a pattern that says what it is", () => {
  it("reads fixed dates", () => {
    expect(normaliseMonthlyPattern('{"type":"FIXED_DATES","dates":[7,21]}'))
      .toEqual({ type: "FIXED_DATES", dates: [7, 21] })
  })

  it("reads an nth weekday", () => {
    expect(normaliseMonthlyPattern('{"type":"NTH_WEEKDAY","weekday":1,"weeks":[1,3]}'))
      .toEqual({ type: "NTH_WEEKDAY", weekday: 1, weeks: [1, 3] })
  })

  it("reads 'last' as an ordinal", () => {
    expect(normaliseMonthlyPattern('{"type":"NTH_WEEKDAY","weekday":5,"weeks":["last"]}'))
      .toEqual({ type: "NTH_WEEKDAY", weekday: 5, weeks: ["last"] })
  })
})

describe("a pattern that carries the shape but not the label", () => {
  it("is read as an nth weekday from its weekday and weeks", () => {
    // The reported defect: this fell through to "fixed day of month", taken
    // from the schedule's start date. A schedule starting on the 10th
    // generated the 10th of every month instead of the first Tuesday.
    expect(normaliseMonthlyPattern('{"weekday":2,"weeks":[1]}'))
      .toEqual({ type: "NTH_WEEKDAY", weekday: 2, weeks: [1] })
  })

  it("is read as fixed dates from its dates", () => {
    expect(normaliseMonthlyPattern('{"dates":[7,21]}'))
      .toEqual({ type: "FIXED_DATES", dates: [7, 21] })
  })

  it("reads Sunday, which is weekday zero and must not look absent", () => {
    expect(normaliseMonthlyPattern('{"weekday":0,"weeks":[2]}'))
      .toEqual({ type: "NTH_WEEKDAY", weekday: 0, weeks: [2] })
  })
})

describe("a pattern with a label it cannot honour", () => {
  it("falls back to its shape when the declared type has no data", () => {
    // Says fixed dates, carries a weekday. The shape is the honest signal.
    expect(normaliseMonthlyPattern('{"type":"FIXED_DATES","weekday":2,"weeks":[1]}'))
      .toEqual({ type: "NTH_WEEKDAY", weekday: 2, weeks: [1] })
  })

  it("gives nothing when the declared type has no data and no shape either", () => {
    expect(normaliseMonthlyPattern('{"type":"NTH_WEEKDAY"}')).toBeNull()
  })
})

describe("a pattern that says nothing usable", () => {
  it("gives null, so the caller's day-of-month fallback is a decision not a guess", () => {
    expect(normaliseMonthlyPattern("{}")).toBeNull()
    expect(normaliseMonthlyPattern('{"dates":[]}')).toBeNull()
    expect(normaliseMonthlyPattern('{"weeks":[1]}')).toBeNull()
  })

  it("survives malformed JSON rather than throwing mid-calendar", () => {
    expect(normaliseMonthlyPattern("{not json")).toBeNull()
    expect(normaliseMonthlyPattern(null)).toBeNull()
    expect(normaliseMonthlyPattern(undefined)).toBeNull()
    expect(normaliseMonthlyPattern("")).toBeNull()
  })

  it("rejects values outside the ranges they have to be in", () => {
    expect(normaliseMonthlyPattern('{"weekday":9,"weeks":[1]}')).toBeNull()
    expect(normaliseMonthlyPattern('{"dates":[0,45]}')).toBeNull()
    expect(normaliseMonthlyPattern('{"weekday":1,"weeks":[8]}')).toBeNull()
  })
})

describe("taking an already-parsed object", () => {
  it("reads it the same way as the string", () => {
    expect(normaliseMonthlyPattern({ weekday: 2, weeks: [1] }))
      .toEqual(normaliseMonthlyPattern('{"weekday":2,"weeks":[1]}'))
  })
})
