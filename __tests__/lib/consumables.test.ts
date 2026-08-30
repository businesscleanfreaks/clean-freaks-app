import { describe, it, expect } from "vitest"
import {
  adhocPaybackTotal,
  cleanerAllowance,
  consumableLinesFor,
  mirroredPayback,
  RECURRING_LABEL,
  validateConsumable,
  type ConsumableRecord,
} from "@/lib/consumables"

const rec = (over: Partial<ConsumableRecord> = {}): ConsumableRecord => ({
  id: "r1",
  kind: "RECURRING",
  clientId: "c1",
  subcontractorId: "s1",
  billAmount: 20,
  paybackAmount: 20,
  ...over,
})

describe("consumableLinesFor · sent invoices never change", () => {
  it("returns null for a SENT invoice, meaning leave it alone", () => {
    expect(consumableLinesFor("SENT", rec(), [])).toBeNull()
  })

  it("returns null for a PAID invoice too", () => {
    expect(consumableLinesFor("PAID", rec(), [])).toBeNull()
  })

  it("distinguishes 'leave alone' from 'remove the lines'", () => {
    // A draft with nothing configured returns [] — the sync should strip lines.
    expect(consumableLinesFor("DRAFT", null, [])).toEqual([])
    // A sent one returns null — the sync must not touch it.
    expect(consumableLinesFor("SENT", null, [])).toBeNull()
  })

  it("puts the recurring charge on a draft", () => {
    const lines = consumableLinesFor("DRAFT", rec({ billAmount: 20 }), [])
    expect(lines).toEqual([
      { label: RECURRING_LABEL, amount: 20, recurring: true, consumableId: "r1" },
    ])
  })

  it("leaves a stopped recurring charge off", () => {
    expect(consumableLinesFor("DRAFT", rec({ isActive: false }), [])).toEqual([])
  })

  it("leaves a payback-only record off the invoice · nothing is charged", () => {
    expect(consumableLinesFor("DRAFT", rec({ billAmount: 0, paybackAmount: 15 }), [])).toEqual([])
  })

  it("adds ad-hoc entries under their own description", () => {
    const lines = consumableLinesFor("DRAFT", null, [
      rec({ id: "a1", kind: "ADHOC", description: "Bin liners", billAmount: 12 }),
    ])
    expect(lines).toEqual([
      { label: "Bin liners", amount: 12, recurring: false, consumableId: "a1" },
    ])
  })

  it("falls back to a plain label when an ad-hoc entry has no description", () => {
    const lines = consumableLinesFor("DRAFT", null, [
      rec({ id: "a1", kind: "ADHOC", description: "  ", billAmount: 12 }),
    ])
    expect(lines?.[0].label).toBe("Consumables")
  })

  it("skips an ad-hoc entry that is payback-only", () => {
    const lines = consumableLinesFor("DRAFT", null, [
      rec({ id: "a1", kind: "ADHOC", billAmount: 0, paybackAmount: 30 }),
    ])
    expect(lines).toEqual([])
  })

  it("carries the recurring line and ad-hoc entries together", () => {
    const lines = consumableLinesFor("DRAFT", rec(), [
      rec({ id: "a1", kind: "ADHOC", description: "Mop heads", billAmount: 8 }),
    ])
    expect(lines).toHaveLength(2)
    expect(lines?.[0].recurring).toBe(true)
    expect(lines?.[1].recurring).toBe(false)
  })
})

describe("cleanerAllowance", () => {
  it("sums the slices", () => {
    const a = cleanerAllowance([
      rec({ id: "x", kind: "ALLOWANCE", clientId: null, paybackAmount: 25 }),
      rec({ id: "y", clientId: "c1", paybackAmount: 20 }),
    ])
    expect(a.total).toBe(45)
  })

  it("puts the standalone slice first · it is the one editable here", () => {
    const a = cleanerAllowance(
      [
        rec({ id: "y", clientId: "c1", paybackAmount: 20 }),
        rec({ id: "x", kind: "ALLOWANCE", clientId: null, paybackAmount: 25 }),
      ],
      { c1: "Acme" },
    )
    expect(a.slices[0].clientId).toBeNull()
    expect(a.slices[0].editableHere).toBe(true)
    expect(a.slices[1].editableHere).toBe(false)
  })

  it("names the client on a linked slice", () => {
    const a = cleanerAllowance([rec({ clientId: "c1", paybackAmount: 20 })], { c1: "Acme" })
    expect(a.slices[0].clientName).toBe("Acme")
  })

  it("ignores charge-only records · nothing is paid back", () => {
    expect(cleanerAllowance([rec({ paybackAmount: 0 })]).total).toBe(0)
  })

  it("ignores stopped records", () => {
    expect(cleanerAllowance([rec({ isActive: false })]).total).toBe(0)
  })

  it("leaves ad-hoc out of the monthly allowance · it is not recurring money", () => {
    expect(cleanerAllowance([rec({ kind: "ADHOC", paybackAmount: 30 })]).total).toBe(0)
  })
})

describe("adhocPaybackTotal", () => {
  it("adds up what the cleaner spent on visits", () => {
    expect(adhocPaybackTotal([
      rec({ kind: "ADHOC", paybackAmount: 30 }),
      rec({ kind: "ADHOC", paybackAmount: 12.5 }),
    ])).toBe(42.5)
  })

  it("counts only ad-hoc, not the recurring allowance", () => {
    expect(adhocPaybackTotal([rec({ paybackAmount: 20 })])).toBe(0)
  })
})

describe("validateConsumable", () => {
  it("accepts a charge with a matching payback", () => {
    expect(validateConsumable({ bill: 20, payback: 20 })).toBeNull()
  })

  it("accepts charge-only and payback-only", () => {
    expect(validateConsumable({ bill: 20, payback: 0 })).toBeNull()
    expect(validateConsumable({ bill: 0, payback: 15 })).toBeNull()
  })

  it("allows paying back more than is charged · the business may absorb it", () => {
    expect(validateConsumable({ bill: 10, payback: 25 })).toBeNull()
  })

  it("refuses both sides empty", () => {
    expect(validateConsumable({ bill: 0, payback: 0 })).toBe("Enter a charge, a payback, or both.")
  })

  it("refuses negatives", () => {
    expect(validateConsumable({ bill: -5, payback: 0 })).toBe("Amounts cannot be negative.")
  })

  it("refuses an unreadable amount rather than saving NaN", () => {
    expect(validateConsumable({ bill: NaN, payback: 0 })).toBe("Enter an amount.")
  })
})

describe("mirroredPayback", () => {
  it("follows the charge until someone edits it", () => {
    expect(mirroredPayback(20, false, 0)).toBe(20)
  })

  it("stops following once touched, including down to zero", () => {
    expect(mirroredPayback(20, true, 5)).toBe(5)
    expect(mirroredPayback(20, true, 0)).toBe(0)
  })
})
