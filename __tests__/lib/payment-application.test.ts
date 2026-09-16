import { describe, it, expect } from "vitest"
import {
  applyPaymentToInvoice,
  mayApplyPayment,
  mismatchNote,
} from "@/lib/payment-application"

describe("applyPaymentToInvoice", () => {
  it("settles an exact match", () => {
    const result = applyPaymentToInvoice(1000, 1000)
    expect(result).toMatchObject({ fit: "EXACT", settles: true, difference: 0, reason: null })
  })

  it("refuses to settle a short payment", () => {
    // The reported bug: a $100 notification marked a $1,000 invoice fully PAID,
    // and because cleaner payouts can be gated on the client having paid, it
    // could release a cleaner payment too.
    const result = applyPaymentToInvoice(100, 1000)
    expect(result.fit).toBe("UNDERPAID")
    expect(result.settles).toBe(false)
    expect(result.difference).toBe(900)
    expect(result.reason).toContain("$900.00 short")
  })

  it("refuses to settle an overpayment", () => {
    const result = applyPaymentToInvoice(1500, 1000)
    expect(result.fit).toBe("OVERPAID")
    expect(result.settles).toBe(false)
    expect(result.difference).toBe(500)
    expect(result.reason).toContain("more than owed")
  })

  it("tolerates rounding, not real differences", () => {
    expect(applyPaymentToInvoice(1000.004, 1000).settles).toBe(true)
    expect(applyPaymentToInvoice(999.95, 1000).settles).toBe(false)
  })

  it("survives float arithmetic", () => {
    // 0.1 + 0.2 territory: this must not report a phantom difference.
    expect(applyPaymentToInvoice(0.3, 0.1 + 0.2).settles).toBe(true)
    expect(applyPaymentToInvoice(290, 145 * 2).settles).toBe(true)
  })

  it("names both amounts so the reviewer can see what it compared", () => {
    const reason = applyPaymentToInvoice(100, 1000).reason ?? ""
    expect(reason).toContain("$100.00")
    expect(reason).toContain("$1,000.00")
  })
})

describe("mayApplyPayment", () => {
  it("lets an exact match through without asking", () => {
    expect(mayApplyPayment(applyPaymentToInvoice(1000, 1000), false)).toBe(true)
  })

  it("blocks a mismatch until the reviewer confirms it", () => {
    const short = applyPaymentToInvoice(100, 1000)
    expect(mayApplyPayment(short, false)).toBe(false)
    expect(mayApplyPayment(short, true)).toBe(true)
  })
})

describe("mismatchNote", () => {
  it("records that a difference was applied on purpose", () => {
    expect(mismatchNote(applyPaymentToInvoice(100, 1000))).toContain("$900.00 short")
    expect(mismatchNote(applyPaymentToInvoice(1500, 1000))).toContain("$500.00 over")
  })

  it("adds nothing when the payment matched", () => {
    expect(mismatchNote(applyPaymentToInvoice(1000, 1000))).toBeNull()
  })
})
