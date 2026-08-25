import { describe, it, expect } from "vitest"
import {
  confirmBlockedReason,
  confirmationText,
  needsConfirmation,
} from "@/lib/invoice-confirmation"
import type { Adjustment } from "@/lib/invoice-adjustments"

const adj = (over: Partial<Adjustment> = {}): Adjustment => ({
  id: "a1",
  mode: "CREDIT",
  label: "Courtesy credit",
  amount: -50,
  serviceDay: null,
  approved: true,
  ...over,
})

describe("needsConfirmation", () => {
  it("is not needed for a routine invoice with no changes", () => {
    expect(needsConfirmation([])).toBe(false)
  })

  it("is needed as soon as anything changed", () => {
    expect(needsConfirmation([adj()])).toBe(true)
  })
})

describe("confirmationText", () => {
  it("names the single change rather than counting it", () => {
    expect(confirmationText([adj({ label: "Courtesy credit", amount: -50 })]))
      .toBe("I confirm the courtesy credit · credit of $50.00 is correct.")
  })

  it("says charge for a positive amount", () => {
    expect(confirmationText([adj({ label: "Extra clean", amount: 120 })]))
      .toBe("I confirm the extra clean · charge of $120.00 is correct.")
  })

  it("includes the service day when there is one", () => {
    expect(confirmationText([adj({ label: "Comped clean", amount: -80, serviceDay: 14 })]))
      .toContain("on day 14")
  })

  it("counts them once there is more than one", () => {
    expect(confirmationText([adj({ id: "a" }), adj({ id: "b" }), adj({ id: "c" })]))
      .toBe("I confirm the 3 changes above are correct.")
  })

  it("is empty when there is nothing to confirm", () => {
    expect(confirmationText([])).toBe("")
  })

  it("survives a blank label without printing an empty gap", () => {
    expect(confirmationText([adj({ label: "", amount: -20 })]))
      .toBe("I confirm the change · credit of $20.00 is correct.")
  })
})

describe("confirmBlockedReason · Josh chose the blocking version", () => {
  it("lets a routine invoice through with no confirmation asked", () => {
    expect(confirmBlockedReason([], false)).toBeNull()
  })

  it("blocks an invoice with changes until the box is ticked", () => {
    expect(confirmBlockedReason([adj()], false)).toBe("Confirm the changes above before sending")
  })

  it("releases it once ticked", () => {
    expect(confirmBlockedReason([adj()], true)).toBeNull()
  })

  it("asks for approval first · ticking is meaningless while rows are unreviewed", () => {
    expect(confirmBlockedReason([adj({ approved: false })], true))
      .toBe("Approve 1 change before sending")
  })

  it("counts the unapproved rows", () => {
    const list = [adj({ id: "a", approved: false }), adj({ id: "b", approved: false }), adj({ id: "c" })]
    expect(confirmBlockedReason(list, false)).toBe("Approve 2 changes before sending")
  })
})
