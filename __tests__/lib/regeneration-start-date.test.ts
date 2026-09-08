import { describe, it, expect } from "vitest"
import { regenerationStartDate } from "@/lib/regenerate-schedule-jobs"

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe("regenerationStartDate", () => {
  it("never reaches back before today", () => {
    // The bug: the schedule route passed the schedule's own start date, so an
    // ordinary edit rebuilt every unbilled clean since the account opened.
    const start = utc(2026, 1, 5)
    expect(iso(regenerationStartDate(start, utc(2026, 9, 8)))).toBe("2026-09-08")
  })

  it("starts at the schedule's start when it has not begun yet", () => {
    // Nothing in front of it to protect.
    const start = utc(2026, 11, 2)
    expect(iso(regenerationStartDate(start, utc(2026, 9, 8)))).toBe("2026-11-02")
  })

  it("uses today when the schedule started today", () => {
    expect(iso(regenerationStartDate(utc(2026, 9, 8), utc(2026, 9, 8)))).toBe("2026-09-08")
  })

  it("still honours an explicit effective date ahead of today", () => {
    // "Change going forward" from a chosen date keeps working.
    expect(iso(regenerationStartDate(utc(2026, 1, 5), utc(2026, 9, 8), utc(2026, 10, 1))))
      .toBe("2026-10-01")
  })

  it("refuses an explicit effective date in the past", () => {
    // The floor is enforced here rather than trusted to every call site: a
    // caller passing a past date is exactly how history got rewritten.
    expect(iso(regenerationStartDate(utc(2026, 6, 1), utc(2026, 9, 8), utc(2026, 2, 1))))
      .toBe("2026-09-08")
    expect(iso(regenerationStartDate(utc(2026, 1, 5), utc(2026, 9, 8), utc(2026, 8, 1))))
      .toBe("2026-09-08")
  })

  it("normalises to the codebase's UTC-noon day marker", () => {
    // Dates are stored at noon UTC so a timezone behind UTC cannot shift the
    // day; the boundary has to land on the same marker as the job dates it is
    // compared against.
    const out = regenerationStartDate(utc(2026, 1, 5), new Date(Date.UTC(2026, 8, 8, 23, 45)))
    expect(out.toISOString()).toBe("2026-09-08T12:00:00.000Z")
  })
})
