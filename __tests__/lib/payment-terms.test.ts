import { describe, it, expect } from "vitest"
import {
  CUSTOM_TERM,
  daysBetween,
  dueDateForTerm,
  resolveDueDate,
  selectedTerm,
} from "@/lib/payment-terms"

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)
const iso = (x: Date | null) => (x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}` : null)

describe("dueDateForTerm", () => {
  it("counts the term's days from the issue date", () => {
    expect(iso(dueDateForTerm(d(2026, 9, 1), "NET_7"))).toBe("2026-09-08")
    expect(iso(dueDateForTerm(d(2026, 9, 1), "NET_15"))).toBe("2026-09-16")
    expect(iso(dueDateForTerm(d(2026, 9, 1), "NET_30"))).toBe("2026-10-01")
  })

  it("crosses a month end correctly", () => {
    expect(iso(dueDateForTerm(d(2026, 1, 25), "NET_15"))).toBe("2026-02-09")
  })

  it("returns null for a term it does not offer", () => {
    expect(dueDateForTerm(d(2026, 9, 1), "NET_45")).toBeNull()
    expect(dueDateForTerm(d(2026, 9, 1), "")).toBeNull()
  })
})

describe("daysBetween", () => {
  it("ignores the time of day", () => {
    expect(daysBetween(new Date(2026, 8, 1, 23, 50), new Date(2026, 8, 8, 0, 10))).toBe(7)
  })
})

describe("selectedTerm", () => {
  it("uses the client's recorded term", () => {
    expect(selectedTerm("NET_30", d(2026, 9, 1), d(2026, 9, 10))).toBe("NET_30")
  })

  it("reads the gap when nothing is recorded", () => {
    // Every client's paymentTerms is empty, so this is the common case.
    expect(selectedTerm(null, d(2026, 9, 1), d(2026, 9, 16))).toBe("NET_15")
  })

  it("says Custom rather than leaving the control looking unset", () => {
    // Josh's screenshot: issued Sep 1, due Sep 10, nothing highlighted.
    expect(selectedTerm(null, d(2026, 9, 1), d(2026, 9, 10))).toBe(CUSTOM_TERM)
  })

  it("returns null only when there is nothing to read at all", () => {
    expect(selectedTerm(null, null, null)).toBeNull()
  })

  it("accepts a lowercase recorded term", () => {
    expect(selectedTerm("net_7", d(2026, 9, 1), d(2026, 9, 8))).toBe("NET_7")
  })
})

describe("resolveDueDate", () => {
  it("derives the date from a recorded term", () => {
    expect(iso(resolveDueDate("NET_30", d(2026, 9, 1), d(2026, 9, 10)))).toBe("2026-10-01")
  })

  it("leaves an existing date alone when no term is recorded", () => {
    // These invoices may already have gone out carrying this date; re-dating
    // them to fit a default nobody chose changes what a client was told.
    expect(iso(resolveDueDate(null, d(2026, 9, 1), d(2026, 9, 10)))).toBe("2026-09-10")
  })

  it("falls back to the issue date when there is nothing else", () => {
    expect(iso(resolveDueDate(null, d(2026, 9, 1), null))).toBe("2026-09-01")
  })
})
