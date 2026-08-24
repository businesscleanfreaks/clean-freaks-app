import { describe, it, expect } from "vitest"
import { applyLargePayoutHold, LARGE_PAYOUT_THRESHOLD } from "@/lib/payout-threshold"

describe("applyLargePayoutHold", () => {
  it("lets an ordinary payout through on its normal cadence, unpaid client or not", () => {
    expect(applyLargePayoutHold({ owed: 800, clientHasPaid: false }).held).toBe(false)
  })

  it("holds a large payout until the client pays", () => {
    const r = applyLargePayoutHold({ owed: 3200, clientHasPaid: false })
    expect(r.held).toBe(true)
    expect(r.held && r.reason).toContain("2,600")
  })

  it("releases a large payout once the client has paid", () => {
    expect(applyLargePayoutHold({ owed: 3200, clientHasPaid: true }).held).toBe(false)
  })

  it("treats the threshold itself as under the limit · Josh said 'over'", () => {
    expect(applyLargePayoutHold({ owed: LARGE_PAYOUT_THRESHOLD, clientHasPaid: false }).held).toBe(false)
    expect(applyLargePayoutHold({ owed: LARGE_PAYOUT_THRESHOLD + 0.01, clientHasPaid: false }).held).toBe(true)
  })

  it("says why it is held, so the operator is not left guessing", () => {
    const r = applyLargePayoutHold({ owed: 5000, clientHasPaid: false })
    expect(r.held && r.reason).toBe("Over $2,600 · waiting on the client to pay")
  })

  it("carries no reason when nothing is held", () => {
    const r = applyLargePayoutHold({ owed: 100, clientHasPaid: false })
    expect(r.held).toBe(false)
    expect("reason" in r).toBe(false)
  })
})
