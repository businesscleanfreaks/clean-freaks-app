import { describe, it, expect } from "vitest"
import { buildPayoutSummary, cleanerLabelFor, shouldShowPayout } from "@/lib/invoice-payout"

const clean = (over: Partial<{ status: string; subcontractorRate: number | null; subcontractorPaid: boolean; cleanerName: string }> = {}) => ({
  status: "COMPLETED", subcontractorRate: 100, subcontractorPaid: false, cleanerName: "Amy", ...over,
})

describe("cleanerLabelFor", () => {
  it("names the cleaner when the month is theirs", () => {
    expect(cleanerLabelFor([clean(), clean()])).toBe("Amy")
  })

  it("counts them when the month is shared", () => {
    expect(cleanerLabelFor([clean(), clean({ cleanerName: "Juan" })])).toBe("2 cleaners")
  })

  it("falls back when nobody is named", () => {
    expect(cleanerLabelFor([clean({ cleanerName: "" })])).toBe("the cleaner")
  })
})

describe("buildPayoutSummary", () => {
  it("is nothing to show when no cleaner is owed anything", () => {
    expect(buildPayoutSummary({ cleans: [] })).toBeNull()
    expect(buildPayoutSummary({ cleans: [clean({ subcontractorRate: 0 })] })).toBeNull()
  })

  it("does not owe for a cancelled clean", () => {
    const s = buildPayoutSummary({ cleans: [clean(), clean({ status: "CANCELLED" })], invoiceStatus: "PAID" })
    expect(s!.amount).toBe(100)
  })

  it("stays locked until the client pays", () => {
    const s = buildPayoutSummary({ cleans: [clean()], invoiceStatus: "SENT" })!
    expect(s.state).toBe("locked")
    expect(s.title).toBe("You owe Amy $100.00")
    expect(s.sub).toBe("Unlocks when the client pays")
    expect(s.actionable).toBe(false)
    expect(shouldShowPayout(s)).toBe(false)
  })

  it("becomes payable once the client has paid", () => {
    const s = buildPayoutSummary({ cleans: [clean(), clean()], invoiceStatus: "PAID" })!
    expect(s.state).toBe("ready")
    expect(s.title).toBe("Amy · ready to pay")
    expect(s.sub).toBe("Client paid · settle now")
    expect(s.amount).toBe(200)
    expect(shouldShowPayout(s)).toBe(true)
  })

  it("says pay anyway when the client is late · the cleaner should not wait", () => {
    const s = buildPayoutSummary({ cleans: [clean()], invoiceStatus: "SENT", overdue: true })!
    expect(s.state).toBe("ready")
    expect(s.sub).toBe("Client is late · pay anyway so they don't wait")
  })

  it("reports settled once every clean is paid", () => {
    const s = buildPayoutSummary({ cleans: [clean({ subcontractorPaid: true })], invoiceStatus: "PAID" })!
    expect(s.state).toBe("paid")
    expect(s.title).toBe("Amy paid")
    expect(s.amount).toBe(0)
    expect(s.actionable).toBe(false)
    expect(shouldShowPayout(s)).toBe(true)
  })

  it("only counts what is still outstanding when the month is part-settled", () => {
    const s = buildPayoutSummary({
      cleans: [clean({ subcontractorPaid: true }), clean()],
      invoiceStatus: "PAID",
    })!
    expect(s.state).toBe("ready")
    expect(s.amount).toBe(100)
  })
})
