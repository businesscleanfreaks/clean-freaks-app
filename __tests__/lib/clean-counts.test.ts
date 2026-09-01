import { describe, it, expect } from "vitest"
import { billableCleanCount, countCleans, scheduleSummaryLabel } from "@/lib/schedule-check"

const clean = (day: number, over: { status?: string; isOneOff?: boolean } = {}) => ({
  date: `2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  status: "COMPLETED",
  ...over,
})

describe("countCleans", () => {
  it("counts a straightforward month", () => {
    const counts = countCleans("2026-08", [clean(3), clean(6), clean(10)])
    expect(counts).toEqual({ completed: 3, cancelled: 0, scheduled: 0, oneoff: 0, total: 3 })
  })

  it("separates cancelled and still-scheduled days", () => {
    const counts = countCleans("2026-08", [
      clean(3), clean(6, { status: "CANCELLED" }), clean(10, { status: "SCHEDULED" }),
    ])
    expect(counts).toMatchObject({ completed: 1, cancelled: 1, scheduled: 1, total: 3 })
  })

  it("counts a day once when it holds both a cancellation and a visit", () => {
    // The calendar draws one square per day; the count has to agree with it.
    const counts = countCleans("2026-08", [clean(3, { status: "CANCELLED" }), clean(3)])
    expect(counts).toMatchObject({ completed: 1, cancelled: 0, total: 1 })
  })

  it("ignores cleans from another month", () => {
    const counts = countCleans("2026-08", [
      clean(3),
      { date: "2026-07-28T12:00:00.000Z", status: "COMPLETED" },
      { date: "2026-09-02T12:00:00.000Z", status: "COMPLETED" },
    ])
    expect(counts.total).toBe(1)
  })

  it("ignores an unreadable date rather than counting it", () => {
    expect(countCleans("2026-08", [clean(3), { date: "nonsense", status: "COMPLETED" }]).total).toBe(1)
  })

  it("counts nothing for an empty month", () => {
    expect(countCleans("2026-08", [])).toEqual({ completed: 0, cancelled: 0, scheduled: 0, oneoff: 0, total: 0 })
  })
})

describe("billableCleanCount", () => {
  const counts = countCleans("2026-08", [clean(3), clean(6), clean(10, { isOneOff: true })])

  it("uses the live month once it has loaded", () => {
    // The bug this replaces: a SENT invoice carries completedCount 0, so the
    // screen showed "0 cleans" three lines above "9 cleans done".
    expect(billableCleanCount(counts, { completedCount: 0, jobCount: 0 })).toBe(3)
  })

  it("counts one-off visits as billable", () => {
    expect(billableCleanCount(counts, {})).toBe(3)
  })

  it("bills visits that have not happened yet", () => {
    // An invoice sent at the start of the month bills the whole month. Counting
    // only completed visits values a clean at $0, so crediting a missed one
    // would offer nothing.
    const upcoming = countCleans("2026-08", [
      clean(3, { status: "SCHEDULED" }), clean(6, { status: "SCHEDULED" }),
    ])
    expect(upcoming.completed).toBe(0)
    expect(billableCleanCount(upcoming, {})).toBe(2)
  })

  it("does not bill a cancelled visit", () => {
    const withCancel = countCleans("2026-08", [clean(3), clean(6), clean(10, { status: "CANCELLED" })])
    expect(billableCleanCount(withCancel, {})).toBe(2)
  })

  it("falls back to the candidate only while the month is still loading", () => {
    const empty = countCleans("2026-08", [])
    expect(billableCleanCount(empty, { completedCount: 7, jobCount: 9 })).toBe(7)
    expect(billableCleanCount(empty, { completedCount: 0, jobCount: 9 })).toBe(9)
    expect(billableCleanCount(empty, {})).toBe(0)
  })

  it("agrees with the label the schedule card prints", () => {
    const withCancel = countCleans("2026-08", [clean(3), clean(6), clean(10, { status: "CANCELLED" })])
    expect(scheduleSummaryLabel(withCancel.completed, withCancel.cancelled)).toBe("2 of 3 cleans done")
    // "done" and "billable" are different questions with the same answer here.
    expect(billableCleanCount(withCancel, { completedCount: 0, jobCount: 0 })).toBe(2)
  })
})
