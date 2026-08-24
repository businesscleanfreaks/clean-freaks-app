import { describe, it, expect } from "vitest"
import {
  cleanerOwedForCancellation,
  isSameDayCancellation,
  parseFeeInput,
  STANDARD_GAS_FEE,
  suggestedCancellationFee,
} from "@/lib/cancellation-fee"

const at = (s: string) => new Date(s)

describe("isSameDayCancellation", () => {
  it("is same-day when the clean is called off on the day", () => {
    expect(isSameDayCancellation(at("2026-08-24T09:00:00"), at("2026-08-24T06:30:00"))).toBe(true)
  })

  it("is not same-day the night before, however close", () => {
    expect(isSameDayCancellation(at("2026-08-24T09:00:00"), at("2026-08-23T23:50:00"))).toBe(false)
  })

  it("is not same-day across a month or year boundary", () => {
    expect(isSameDayCancellation(at("2026-09-01T09:00:00"), at("2026-08-31T09:00:00"))).toBe(false)
    expect(isSameDayCancellation(at("2027-01-01T09:00:00"), at("2026-12-31T09:00:00"))).toBe(false)
  })
})

describe("suggestedCancellationFee", () => {
  it("offers the standard fee for a same-day cancellation", () => {
    expect(suggestedCancellationFee(at("2026-08-24T09:00:00"), at("2026-08-24T07:00:00")))
      .toBe(String(STANDARD_GAS_FEE))
  })

  it("leaves the box empty when cancelled in advance · no fee has been decided", () => {
    expect(suggestedCancellationFee(at("2026-08-26T09:00:00"), at("2026-08-24T07:00:00"))).toBe("")
  })

  it("offers a value that parses back to the standard amount", () => {
    expect(Number(suggestedCancellationFee(at("2026-08-24T09:00:00"), at("2026-08-24T07:00:00"))))
      .toBe(20)
  })
})

describe("cleanerOwedForCancellation", () => {
  it("passes the whole fee to the cleaner", () => {
    expect(cleanerOwedForCancellation(20)).toBe(20)
    expect(cleanerOwedForCancellation(35.5)).toBe(35.5)
  })

  it("owes nothing when no fee was charged", () => {
    expect(cleanerOwedForCancellation(null)).toBe(0)
    expect(cleanerOwedForCancellation(undefined)).toBe(0)
    expect(cleanerOwedForCancellation(0)).toBe(0)
  })

  it("never returns a negative amount from bad stored data", () => {
    expect(cleanerOwedForCancellation(-15)).toBe(0)
  })
})

describe("parseFeeInput", () => {
  it("reads money the way people type it", () => {
    expect(parseFeeInput("20")).toBe(20)
    expect(parseFeeInput("$20")).toBe(20)
    expect(parseFeeInput(" 27.50 ")).toBe(27.5)
    expect(parseFeeInput("1,200")).toBe(1200)
  })

  it("treats an empty or unreadable box as no fee, never NaN", () => {
    expect(parseFeeInput("")).toBe(0)
    expect(parseFeeInput("$")).toBe(0)
    expect(parseFeeInput("abc")).toBe(0)
  })

  it("refuses a negative fee · that would pay the cleaner backwards", () => {
    expect(parseFeeInput("-20")).toBe(0)
  })
})
