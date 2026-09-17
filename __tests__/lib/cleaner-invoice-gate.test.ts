import { describe, it, expect } from "vitest"
import {
  checkInvoiceGate,
  describeGaps,
  type PayableUnit,
  type ReceiptRecord,
} from "@/lib/cleaner-invoice-gate"

const clean = (over: Partial<PayableUnit> & { id: string }): PayableUnit => ({
  kind: "JOB",
  locationId: "loc-a",
  locationName: "Bigco Offices",
  period: "2026-09",
  ...over,
})

const accountReceipt = (over: Partial<ReceiptRecord> = {}): ReceiptRecord => ({
  locationId: "loc-a",
  period: "2026-09",
  jobId: null,
  addOnServiceId: null,
  ...over,
})

describe("an account-wide receipt", () => {
  it("covers every clean on that account that month", () => {
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2" })],
      [accountReceipt()],
    )
    expect(result.satisfied).toBe(true)
  })

  it("covers nothing on a different account", () => {
    // The reported defect: the gate matched on cleaner and month only, so one
    // account's invoice released payment for every account that month.
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2", locationId: "loc-b", locationName: "Corner Cafe" })],
      [accountReceipt()],
    )
    expect(result.satisfied).toBe(false)
    expect(result.uncovered.map(u => u.id)).toEqual(["j2"])
  })

  it("covers nothing in a different month", () => {
    const result = checkInvoiceGate(
      [clean({ id: "j1", period: "2026-10" })],
      [accountReceipt({ period: "2026-09" })],
    )
    expect(result.satisfied).toBe(false)
  })
})

describe("a receipt for one clean", () => {
  it("covers that clean", () => {
    const result = checkInvoiceGate([clean({ id: "j1" })], [accountReceipt({ jobId: "j1" })])
    expect(result.satisfied).toBe(true)
  })

  it("does not cover another clean on the same account", () => {
    // This was the widest version of the hole: recording receipts per clean,
    // which is the careful thing to do, opened the entire month.
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2" })],
      [accountReceipt({ jobId: "j1" })],
    )
    expect(result.satisfied).toBe(false)
    expect(result.uncovered.map(u => u.id)).toEqual(["j2"])
  })

  it("does not cover an add-on", () => {
    const result = checkInvoiceGate(
      [clean({ id: "ao-1", kind: "ADDON" })],
      [accountReceipt({ jobId: "ao-1" })],
    )
    expect(result.satisfied).toBe(false)
  })
})

describe("a receipt for one add-on", () => {
  it("covers that add-on", () => {
    const result = checkInvoiceGate(
      [clean({ id: "ao-1", kind: "ADDON" })],
      [accountReceipt({ addOnServiceId: "ao-1" })],
    )
    expect(result.satisfied).toBe(true)
  })

  it("does not cover a clean that happens to share the id space", () => {
    const result = checkInvoiceGate([clean({ id: "ao-1" })], [accountReceipt({ addOnServiceId: "ao-1" })])
    expect(result.satisfied).toBe(false)
  })

  it("is covered by the account-wide receipt too", () => {
    // An add-on belongs to an account, so invoicing the account covers it.
    const result = checkInvoiceGate([clean({ id: "ao-1", kind: "ADDON" })], [accountReceipt()])
    expect(result.satisfied).toBe(true)
  })
})

describe("a matched invoice for the month", () => {
  it("covers everything that month, across accounts", () => {
    // The older intake was one invoice per cleaner per month, so it genuinely
    // does cover the month. That shape is not the defect.
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2", locationId: "loc-b", locationName: "Corner Cafe" })],
      [],
      new Set(["2026-09"]),
    )
    expect(result.satisfied).toBe(true)
  })

  it("covers nothing in another month", () => {
    const result = checkInvoiceGate([clean({ id: "j1", period: "2026-10" })], [], new Set(["2026-09"]))
    expect(result.satisfied).toBe(false)
  })
})

describe("what the refusal says", () => {
  it("names each account and month that is missing an invoice", () => {
    const result = checkInvoiceGate(
      [
        clean({ id: "j1" }),
        clean({ id: "j2" }),
        clean({ id: "j3", locationId: "loc-b", locationName: "Corner Cafe" }),
      ],
      [],
    )
    expect(describeGaps(result.gaps)).toBe("Bigco Offices · 2026-09, Corner Cafe · 2026-09")
  })

  it("counts the work behind each gap", () => {
    const result = checkInvoiceGate([clean({ id: "j1" }), clean({ id: "j2" })], [])
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0].count).toBe(2)
  })

  it("still reports the bare months, for callers that only showed those", () => {
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2", period: "2026-10" })],
      [],
    )
    expect(result.periods).toEqual(["2026-09", "2026-10"])
  })

  it("names an account once however many cleans are uncovered on it", () => {
    const result = checkInvoiceGate(
      [clean({ id: "j1" }), clean({ id: "j2" }), clean({ id: "j3" })],
      [],
    )
    expect(result.gaps).toHaveLength(1)
  })
})

describe("edge cases", () => {
  it("passes when there is nothing to pay for", () => {
    expect(checkInvoiceGate([], []).satisfied).toBe(true)
  })

  it("refuses when there are no receipts at all", () => {
    expect(checkInvoiceGate([clean({ id: "j1" })], []).satisfied).toBe(false)
  })

  it("ignores a receipt whose account is not being paid", () => {
    const result = checkInvoiceGate(
      [clean({ id: "j1" })],
      [accountReceipt({ locationId: "loc-z" })],
    )
    expect(result.satisfied).toBe(false)
  })

  it("accepts a mix of shapes covering different work", () => {
    const result = checkInvoiceGate(
      [
        clean({ id: "j1" }),
        clean({ id: "j2", locationId: "loc-b", locationName: "Corner Cafe" }),
        clean({ id: "ao-1", kind: "ADDON", locationId: "loc-b", locationName: "Corner Cafe" }),
      ],
      [
        accountReceipt({ jobId: "j1" }),
        accountReceipt({ locationId: "loc-b" }),
      ],
    )
    expect(result.satisfied).toBe(true)
  })
})
