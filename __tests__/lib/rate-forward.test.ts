import { describe, it, expect } from "vitest"
import { rateForwardRefusal } from "@/lib/rate-forward"

describe("carrying a change forward from one clean", () => {
  it("allows a client rate change on a per-clean account", () => {
    // Each clean carries its own rate and past months were invoiced from the
    // rates their own cleans held, so forward really is forward.
    expect(rateForwardRefusal({ billsMonthly: false, changesClientRate: true })).toBeNull()
  })

  it("refuses a client rate change on a flat monthly account", () => {
    // The reported defect: the monthly line is priced from the schedule for
    // whatever month is being reviewed, so moving that default re-priced every
    // month not yet sent. A clean in September changed what July would bill.
    const refusal = rateForwardRefusal({ billsMonthly: true, changesClientRate: true })
    expect(refusal?.code).toBe("FLAT_RATE_NEEDS_SCHEDULE_CHANGE")
  })

  it("points at the operation that does this correctly", () => {
    const refusal = rateForwardRefusal({ billsMonthly: true, changesClientRate: true })
    expect(refusal?.message).toContain("change going forward")
  })

  it("still allows changing the cleaner on a flat monthly account", () => {
    // Who does the work says nothing about what the client is charged.
    expect(rateForwardRefusal({ billsMonthly: true, changesClientRate: false })).toBeNull()
  })

  it("still allows changing the cleaner's pay on a flat monthly account", () => {
    // Cleaner payouts are computed from each clean's own rate, so the schedule
    // default cannot reach a month that has already happened.
    expect(rateForwardRefusal({ billsMonthly: true, changesClientRate: false })).toBeNull()
  })

  it("allows a change that touches neither", () => {
    expect(rateForwardRefusal({ billsMonthly: false, changesClientRate: false })).toBeNull()
  })
})
