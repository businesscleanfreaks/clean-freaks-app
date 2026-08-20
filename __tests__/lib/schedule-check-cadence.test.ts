import { describe, it, expect } from "vitest"
import { cadenceLabel, cellStyle, scheduleSummaryLabel } from "@/lib/schedule-check"

// June 2026: Tuesdays 2,9,16,23,30 · Fridays 5,12,19,26
const JUNE = { year: 2026, month: 6 }

describe("cadenceLabel", () => {
  it("reads Weekly when every occurrence of each weekday was cleaned", () => {
    expect(cadenceLabel({ ...JUNE, cleanDays: [2, 9, 16, 23, 30, 5, 12, 19, 26] }))
      .toBe("Weekly · Tue & Fri")
  })

  it("reads Every other week when the weekday was hit twice but not every time", () => {
    expect(cadenceLabel({ ...JUNE, cleanDays: [2, 16, 5, 19] }))
      .toBe("Every other week · Tue & Fri")
  })

  it("falls back to a visit count when the pattern is irregular", () => {
    expect(cadenceLabel({ ...JUNE, cleanDays: [2, 5, 19] }))
      .toBe("3 visits in June · Tue & Fri")
  })

  it("names a single day without an ampersand", () => {
    expect(cadenceLabel({ ...JUNE, cleanDays: [2, 9, 16, 23, 30] })).toBe("Weekly · Tue")
  })

  it("lists three or more days with commas and a final ampersand", () => {
    // Mondays 1,8,15,22,29 · Wednesdays 3,10,17,24 · Fridays 5,12,19,26
    const all = [1, 8, 15, 22, 29, 3, 10, 17, 24, 5, 12, 19, 26]
    expect(cadenceLabel({ ...JUNE, cleanDays: all })).toBe("Weekly · Mon, Wed & Fri")
  })

  it("collapses a full working week into one phrase", () => {
    const monFri: number[] = []
    for (let d = 1; d <= 30; d++) {
      const w = new Date(2026, 5, d).getDay()
      if (w >= 1 && w <= 5) monFri.push(d)
    }
    expect(cadenceLabel({ ...JUNE, cleanDays: monFri })).toBe("Every weekday (Mon–Fri)")
  })

  it("counts a cancelled day towards the pattern · it still shows which day they are on", () => {
    // Same Tue/Fri weekly pattern, but the 16th was cancelled rather than cleaned.
    expect(cadenceLabel({ ...JUNE, cleanDays: [2, 9, 23, 30, 5, 12, 19, 26], cancelledDays: [16] }))
      .toBe("Weekly · Tue & Fri")
  })

  it("says so when there is nothing scheduled", () => {
    expect(cadenceLabel({ ...JUNE, cleanDays: [] })).toBe("No scheduled cleans")
  })
})

describe("scheduleSummaryLabel", () => {
  it("counts the cleans when none fell out", () => {
    expect(scheduleSummaryLabel(9, 0)).toBe("9 cleans done")
    expect(scheduleSummaryLabel(1, 0)).toBe("1 clean done")
  })

  it("shows the shortfall when some were cancelled", () => {
    expect(scheduleSummaryLabel(7, 2)).toBe("7 of 9 cleans done")
  })
})

describe("cellStyle", () => {
  it("fills a completed clean so the month reads at a glance", () => {
    const s = cellStyle("clean")
    expect(s.background).toBe("#15793f")
    expect(s.color).toBe("#fff")
  })

  it("marks a one-off amber, per the design", () => {
    expect(cellStyle("oneoff").background).toBe("#f59e0b")
  })

  it("keeps a cancelled day visible but struck through", () => {
    const s = cellStyle("cancelled")
    expect(s.textDecoration).toBe("line-through")
    expect(s.color).toBe("#dc2626")
  })

  it("outlines a booked-but-not-done clean so it never looks delivered", () => {
    const s = cellStyle("scheduled")
    expect(s.background).toBe("transparent")
    expect(s.boxShadow).toContain("1.5px")
  })

  it("leaves an ordinary day quiet", () => {
    expect(cellStyle("empty").background).toBe("transparent")
  })
})
