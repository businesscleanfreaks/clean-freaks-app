import { describe, it, expect } from "vitest"
import {
  formatInvoiceNumber,
  isUniqueViolation,
  nextInvoiceNumber,
  parseInvoiceNumber,
} from "@/lib/invoice-number"

describe("formatInvoiceNumber", () => {
  it("writes the design's format", () => {
    expect(formatInvoiceNumber(2026, 131)).toBe("INV-2026-131")
  })

  it("pads short sequences to three digits", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-001")
  })

  it("does not truncate once past a thousand", () => {
    expect(formatInvoiceNumber(2026, 1042)).toBe("INV-2026-1042")
  })
})

describe("parseInvoiceNumber", () => {
  it("reads the current format", () => {
    expect(parseInvoiceNumber("INV-2026-131")).toEqual({ year: 2026, sequence: 131 })
  })

  it("ignores the old date-stamped format", () => {
    // INV-20260907-0001 must not be read as sequence 1 of year 20260907, or a
    // single legacy number would push every new sequence into the millions.
    expect(parseInvoiceNumber("INV-20260907-0001")).toBeNull()
  })

  it("ignores anything else", () => {
    expect(parseInvoiceNumber("INV-TEST-1")).toBeNull()
    expect(parseInvoiceNumber("2026-131")).toBeNull()
    expect(parseInvoiceNumber("")).toBeNull()
  })
})

describe("nextInvoiceNumber", () => {
  it("starts at 001 for a year with nothing in it", () => {
    expect(nextInvoiceNumber(2026, [])).toBe("INV-2026-001")
  })

  it("continues from the highest in use", () => {
    expect(nextInvoiceNumber(2026, ["INV-2026-001", "INV-2026-007", "INV-2026-003"]))
      .toBe("INV-2026-008")
  })

  it("does not fill a gap left by a deleted invoice", () => {
    // A number that has been on a client's invoice must never appear on a
    // different one, even after a void or a delete.
    expect(nextInvoiceNumber(2026, ["INV-2026-001", "INV-2026-005"])).toBe("INV-2026-006")
  })

  it("counts only its own year", () => {
    expect(nextInvoiceNumber(2027, ["INV-2026-412", "INV-2027-002"])).toBe("INV-2027-003")
  })

  it("is unaffected by legacy numbers", () => {
    // The old format restarted at 0001 daily and is still on live invoices.
    expect(nextInvoiceNumber(2026, ["INV-20260907-0001", "INV-20260908-0001"]))
      .toBe("INV-2026-001")
  })

  it("survives junk in the list", () => {
    expect(nextInvoiceNumber(2026, ["", "INV-TEST-9", "INV-2026-004"])).toBe("INV-2026-005")
  })
})

describe("isUniqueViolation", () => {
  it("recognises the Prisma code, so a clash can be retried", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true)
    expect(isUniqueViolation({ code: "P2025" })).toBe(false)
    expect(isUniqueViolation(new Error("boom"))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
