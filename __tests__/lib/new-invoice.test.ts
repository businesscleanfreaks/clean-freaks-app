import { describe, it, expect } from "vitest"
import {
  billsAutomatically,
  draftTotal,
  INVOICE_PRESETS,
  parseAmount,
  toApiLineItems,
  validateDraft,
  type DraftLine,
} from "@/lib/new-invoice"

const line = (name: string, amount: string): DraftLine => ({ id: name, name, amount })

describe("parseAmount", () => {
  it("reads money the way people type it", () => {
    expect(parseAmount("300")).toBe(300)
    expect(parseAmount("$300")).toBe(300)
    expect(parseAmount("1,250.50")).toBe(1250.5)
    expect(parseAmount(" $1,250.50 ")).toBe(1250.5)
  })

  it("treats a half-typed or empty amount as zero, never NaN", () => {
    expect(parseAmount("")).toBe(0)
    expect(parseAmount("$")).toBe(0)
    expect(parseAmount("abc")).toBe(0)
    expect(parseAmount(".")).toBe(0)
  })
})

describe("draftTotal", () => {
  it("adds the lines up", () => {
    expect(draftTotal([line("Deep clean", "350"), line("Supplies", "25.50")])).toBe(375.5)
  })

  it("ignores lines with nothing typed yet", () => {
    expect(draftTotal([line("Deep clean", "350"), line("Supplies", "")])).toBe(350)
  })

  it("is zero for an empty draft", () => {
    expect(draftTotal([])).toBe(0)
  })
})

describe("validateDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateDraft("c1", [line("Deep clean", "350")])).toEqual([])
  })

  it("needs a client", () => {
    expect(validateDraft(null, [line("Deep clean", "350")])[0].code).toBe("NO_CLIENT")
  })

  it("needs at least one line, and says so without piling on", () => {
    const problems = validateDraft("c1", [])
    expect(problems.map(p => p.code)).toEqual(["NO_LINES"])
  })

  it("needs a description on every line", () => {
    expect(validateDraft("c1", [line("", "350")]).map(p => p.code)).toContain("EMPTY_LINE")
  })

  it("refuses a zero total · an invoice for nothing helps nobody", () => {
    expect(validateDraft("c1", [line("Supplies", "")]).map(p => p.code)).toContain("ZERO_TOTAL")
  })

  it("reports a missing client and a bad line together", () => {
    const codes = validateDraft(null, [line("", "")]).map(p => p.code)
    expect(codes).toContain("NO_CLIENT")
    expect(codes).toContain("EMPTY_LINE")
    expect(codes).toContain("ZERO_TOTAL")
  })
})

describe("toApiLineItems", () => {
  it("trims descriptions and carries no job link · this work never hit the calendar", () => {
    const [item] = toApiLineItems([line("  Deep clean  ", "$350")])
    expect(item.description).toBe("Deep clean")
    expect(item.amount).toBe(350)
    expect(item.jobId).toBeNull()
    expect(item.addOnServiceId).toBeNull()
  })
})

describe("presets", () => {
  it("offers the office's standard extras", () => {
    expect(INVOICE_PRESETS.map(p => p.name)).toEqual([
      "Deep clean", "Move-out clean", "Carpet shampoo", "Window cleaning",
      "Post-construction", "Post-event clean", "Strip & wax", "Supplies",
    ])
  })

  it("leaves Supplies unpriced · it is always per case", () => {
    expect(INVOICE_PRESETS.find(p => p.name === "Supplies")?.amount).toBeNull()
  })
})

describe("billsAutomatically", () => {
  it("warns for clients already on a billing cadence", () => {
    expect(billsAutomatically("FLAT_RATE")).toBe(true)
    expect(billsAutomatically("PER_CLEAN")).toBe(true)
  })

  it("stays quiet for one-time clients, who have no cadence to duplicate", () => {
    expect(billsAutomatically("ONE_TIME")).toBe(false)
    expect(billsAutomatically(null)).toBe(false)
  })
})
