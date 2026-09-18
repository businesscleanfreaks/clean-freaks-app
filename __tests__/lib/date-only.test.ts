import { describe, it, expect } from "vitest"
import {
  dateInputValue,
  formatDateOnly,
  parseDateOnly,
  parseDateOnlyForStorage,
} from "@/lib/date-only"
import { BUSINESS_TIME_ZONE, businessDayKey, formatBusinessDate } from "@/lib/business-time"

/**
 * These two modules divide every date in the app between them, and getting the
 * division wrong is what produced the timezone failures: a SERVICE DAY has no
 * time and must read the same everywhere, while a RECORDED MOMENT is an instant
 * and belongs to the business's timezone.
 */

describe("a service day given as a string", () => {
  it("reads as the day that was written", () => {
    // `new Date("2026-06-10")` is UTC midnight, which is the 9th anywhere
    // behind UTC. This is the bug that put every clean a day early in Pacific.
    const d = parseDateOnly("2026-06-10")!
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 10])
  })

  it("holds the first of the month, which is where a shift is most visible", () => {
    const d = parseDateOnly("2026-06-01")!
    expect(d.getMonth() + 1).toBe(6)
    expect(d.getDate()).toBe(1)
  })

  it("holds the last of the month", () => {
    const d = parseDateOnly("2026-08-31")!
    expect([d.getMonth() + 1, d.getDate()]).toEqual([8, 31])
  })

  it("ignores a time that came along with it", () => {
    const d = parseDateOnly("2026-06-10T23:30:00Z")!
    expect(d.getDate()).toBe(10)
  })

  it("returns null rather than throwing on nonsense", () => {
    expect(parseDateOnly("not-a-date")).toBeNull()
    expect(parseDateOnly(null)).toBeNull()
    expect(parseDateOnly(undefined)).toBeNull()
    expect(parseDateOnly("")).toBeNull()
  })
})

describe("a service day given as a stored Date", () => {
  it("reads the noon-UTC instant as its own day", () => {
    // Service days are stored at noon UTC precisely so they cannot slide.
    const d = parseDateOnly(new Date(Date.UTC(2026, 5, 10, 12, 0, 0)))!
    expect([d.getMonth() + 1, d.getDate()]).toEqual([6, 10])
  })

  it("reads a midnight-UTC legacy value as that UTC day", () => {
    // Older rows were stored at midnight UTC. Reading them in UTC keeps them on
    // the day they were meant to be, rather than the day before.
    const d = parseDateOnly(new Date(Date.UTC(2026, 5, 10, 0, 0, 0)))!
    expect(d.getDate()).toBe(10)
  })
})

describe("storing a service day", () => {
  it("writes noon UTC, so no timezone can move it", () => {
    const stored = parseDateOnlyForStorage("2026-06-10")!
    expect(stored.toISOString()).toBe("2026-06-10T12:00:00.000Z")
  })

  it("survives a round trip through storage", () => {
    const stored = parseDateOnlyForStorage("2026-06-01")!
    expect(dateInputValue(stored)).toBe("2026-06-01")
  })

  it("round-trips a month end too", () => {
    const stored = parseDateOnlyForStorage("2026-12-31")!
    expect(dateInputValue(stored)).toBe("2026-12-31")
  })
})

describe("showing a service day", () => {
  it("prints the day that was written", () => {
    expect(formatDateOnly("2026-06-10", "MMM d, yyyy")).toBe("Jun 10, 2026")
  })

  it("prints a stored noon-UTC day as itself", () => {
    expect(formatDateOnly(new Date(Date.UTC(2026, 5, 10, 12, 0, 0)), "MMM d, yyyy"))
      .toBe("Jun 10, 2026")
  })

  it("gives null rather than 'Invalid Date'", () => {
    expect(formatDateOnly("nope")).toBeNull()
  })
})

describe("a recorded moment", () => {
  it("is shown as its day in the business's timezone", () => {
    // 7pm UTC is noon in Pacific, so this is the 19th for the business.
    expect(formatBusinessDate("2026-08-19T19:00:00Z")).toBe("Aug 19")
  })

  it("is the previous day when it happened late in the evening Pacific", () => {
    // Midnight UTC on the 19th is 5pm Pacific on the 18th · which day it falls
    // on genuinely depends on where you stand, and the business stands here.
    expect(formatBusinessDate("2026-08-19T00:00:00Z")).toBe("Aug 18")
  })

  it("does not depend on where the code runs", () => {
    // The whole point: this answered differently on the server and in the
    // browser, so one record could show two days.
    const fixed = formatBusinessDate("2026-08-19T19:00:00Z")
    expect(fixed).toBe("Aug 19")
    expect(BUSINESS_TIME_ZONE).toBe("America/Los_Angeles")
  })

  it("gives a sortable key for the business day", () => {
    expect(businessDayKey("2026-08-19T19:00:00Z")).toBe("2026-08-19")
    expect(businessDayKey("2026-08-19T00:00:00Z")).toBe("2026-08-18")
  })

  it("returns null rather than throwing on nonsense", () => {
    expect(formatBusinessDate("nope")).toBeNull()
    expect(formatBusinessDate(null)).toBeNull()
    expect(businessDayKey("nope")).toBeNull()
  })
})
