import { describe, it, expect } from "vitest"
import { buildServiceSummary, frequencyLabel } from "@/lib/invoice-service-summary"

describe("frequencyLabel", () => {
  it("turns the schedule enums into English", () => {
    expect(frequencyLabel("EVERY_4_WEEKS")).toBe("Every 4 weeks")
    expect(frequencyLabel("BI_WEEKLY")).toBe("Every 2 weeks")
    expect(frequencyLabel("2X_MONTHLY")).toBe("Twice a month")
    expect(frequencyLabel("WEEKLY")).toBe("Weekly")
  })

  it("never shows a raw enum, even one nobody has mapped", () => {
    expect(frequencyLabel("EVERY_9_WEEKS")).toBe("Every 9 weeks")
    expect(frequencyLabel("SOME_NEW_CADENCE")).toBe("Some new cadence")
  })

  it("leaves text that is already written for humans alone", () => {
    expect(frequencyLabel("Mon, Thu")).toBe("Mon, Thu")
    expect(frequencyLabel("Every other Tuesday")).toBe("Every other Tuesday")
  })

  it("returns null when there is no cadence", () => {
    expect(frequencyLabel(null)).toBeNull()
    expect(frequencyLabel("   ")).toBeNull()
  })
})

describe("buildServiceSummary", () => {
  const base = { cleanCount: 4, monthLabel: "August", scheduleSummary: "WEEKLY" }

  it("says a flat rate is the same every month", () => {
    expect(buildServiceSummary({ ...base, billingType: "FLAT_RATE" })).toEqual({
      title: "Flat monthly service",
      sub: "Same price every month",
    })
  })

  it("names a one-off job after the work, not the cadence", () => {
    expect(buildServiceSummary({
      ...base, billingType: "ONE_TIME", firstLineDescription: "Post-construction clean",
    })).toEqual({ title: "Post-construction clean", sub: "One-time job · not recurring" })
  })

  it("falls back to a generic name for a one-off with no description", () => {
    expect(buildServiceSummary({ ...base, billingType: "ONE_TIME" }).title).toBe("One-off clean")
  })

  it("counts the cleans and names the cadence for per-clean", () => {
    const s = buildServiceSummary({ ...base, billingType: "PER_CLEAN", cleanCount: 4, cancelledCount: 1 })
    expect(s.title).toBe("4 cleans · Weekly")
    expect(s.sub).toBe("4 of 5 scheduled cleans found in August.")
  })

  it("explains a light total on the same line · cancelled cleans are counted in", () => {
    const s = buildServiceSummary({ ...base, billingType: "PER_CLEAN", cleanCount: 2, cancelledCount: 2 })
    expect(s.sub).toBe("2 of 4 scheduled cleans found in August.")
  })

  it("says clean, not cleans, for exactly one", () => {
    expect(buildServiceSummary({ ...base, billingType: "PER_CLEAN", cleanCount: 1 }).title)
      .toBe("1 clean · Weekly")
  })

  it("drops the cadence when there is none rather than printing an empty separator", () => {
    expect(buildServiceSummary({ ...base, billingType: "PER_CLEAN", scheduleSummary: null }).title)
      .toBe("4 cleans")
  })

  it("never leaks an enum into the title", () => {
    const s = buildServiceSummary({ ...base, billingType: "PER_CLEAN", scheduleSummary: "EVERY_4_WEEKS" })
    expect(s.title).toBe("4 cleans · Every 4 weeks")
    expect(s.title).not.toContain("_")
  })
})
