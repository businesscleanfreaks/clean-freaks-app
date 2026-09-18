import { describe, it, expect } from "vitest"
import {
  describeBlocked,
  jobChangeBlockedReason,
  partitionBulkChange,
  type GuardedJob,
} from "@/lib/job-mutation-guard"

const job = (over: Partial<GuardedJob> = {}): GuardedJob => ({
  id: "j1",
  status: "SCHEDULED",
  scheduleId: "sched-1",
  subcontractorPaid: false,
  vendorPaid: false,
  invoiceLineItems: [],
  ...over,
})

const onSentInvoice = [{ invoice: { status: "SENT" } }]
const onDraftInvoice = [{ invoice: { status: "DRAFT" } }]

describe("rescheduling or repricing", () => {
  it("is allowed on ordinary scheduled work", () => {
    expect(jobChangeBlockedReason(job(), { reschedulesOrReprices: true })).toBeNull()
  })

  it("is refused on a sent invoice", () => {
    expect(jobChangeBlockedReason(job({ invoiceLineItems: onSentInvoice }), { reschedulesOrReprices: true }))
      .toContain("sent or paid invoice")
  })

  it("is allowed on a draft invoice", () => {
    expect(jobChangeBlockedReason(job({ invoiceLineItems: onDraftInvoice }), { reschedulesOrReprices: true }))
      .toBeNull()
  })

  it("is refused once the cleaner has been paid", () => {
    expect(jobChangeBlockedReason(job({ subcontractorPaid: true }), { reschedulesOrReprices: true }))
      .toContain("void the payment")
  })

  it("is refused once the vendor has been paid", () => {
    expect(jobChangeBlockedReason(job({ vendorPaid: true }), { reschedulesOrReprices: true }))
      .toContain("vendor payment")
  })

  it("is refused on a cancelled job", () => {
    expect(jobChangeBlockedReason(job({ status: "CANCELLED" }), { reschedulesOrReprices: true }))
      .toContain("cancelled job")
  })
})

describe("changing who performed the work", () => {
  it("is allowed before anyone is paid", () => {
    expect(jobChangeBlockedReason(job(), { changesWorker: true })).toBeNull()
  })

  it("is refused once the cleaner has been paid", () => {
    // The reported defect: the individual route refused this and the bulk
    // route did it anyway, moving work away from a cleaner already paid for it.
    expect(jobChangeBlockedReason(job({ subcontractorPaid: true }), { changesWorker: true }))
      .toContain("after it has been paid")
  })

  it("is refused once the vendor has been paid", () => {
    expect(jobChangeBlockedReason(job({ vendorPaid: true }), { changesWorker: true }))
      .toContain("after it has been paid")
  })

  it("is allowed on a sent invoice, which is a billing fact, not a payout one", () => {
    expect(jobChangeBlockedReason(job({ invoiceLineItems: onSentInvoice }), { changesWorker: true }))
      .toBeNull()
  })
})

describe("assigning a vendor", () => {
  it("is refused on recurring work", () => {
    expect(jobChangeBlockedReason(job({ scheduleId: "sched-1" }), { assignsVendor: true }))
      .toContain("standalone one-off")
  })

  it("is allowed on a one-off", () => {
    expect(jobChangeBlockedReason(job({ scheduleId: null }), { assignsVendor: true })).toBeNull()
  })
})

describe("an intent that touches nothing guarded", () => {
  it("is allowed however the job stands", () => {
    // Completing or cancelling a paid job is not blocked individually, so it
    // must not be blocked in bulk either. Moving these rules must not tighten
    // them: a bulk action stricter than the single action is its own surprise.
    const paid = job({ subcontractorPaid: true, vendorPaid: true, invoiceLineItems: onSentInvoice })
    expect(jobChangeBlockedReason(paid, {})).toBeNull()
  })
})

describe("a bulk change", () => {
  it("applies to the jobs it may and reports the rest", () => {
    const jobs = [
      job({ id: "ok-1" }),
      job({ id: "paid", subcontractorPaid: true }),
      job({ id: "ok-2" }),
    ]
    const result = partitionBulkChange(jobs, { changesWorker: true })
    expect(result.allowed.map(j => j.id)).toEqual(["ok-1", "ok-2"])
    expect(result.blocked.map(b => b.id)).toEqual(["paid"])
  })

  it("does not refuse the whole batch for one problem", () => {
    // Ticking thirty cleans should not mean finding the one problem by
    // bisection, and the other twenty-nine are not wrong because of it.
    const jobs = [job({ id: "paid", subcontractorPaid: true }), ...Array.from({ length: 29 }, (_, i) => job({ id: `ok-${i}` }))]
    const result = partitionBulkChange(jobs, { changesWorker: true })
    expect(result.allowed).toHaveLength(29)
  })

  it("passes everything through when nothing is guarded", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", subcontractorPaid: true })]
    expect(partitionBulkChange(jobs, {}).blocked).toEqual([])
  })

  it("blocks everything when everything is blocked", () => {
    const jobs = [job({ id: "a", vendorPaid: true }), job({ id: "b", subcontractorPaid: true })]
    expect(partitionBulkChange(jobs, { changesWorker: true }).allowed).toEqual([])
  })
})

describe("what the operator is told", () => {
  it("says how many were left and why", () => {
    const blocked = [
      { id: "a", reason: "Cannot change who performed a job after it has been paid. Please void the payment first." },
    ]
    expect(describeBlocked(blocked)).toContain("1 job left unchanged")
  })

  it("does not repeat the same reason once per job", () => {
    const reason = "Cannot change who performed a job after it has been paid. Please void the payment first."
    const message = describeBlocked([{ id: "a", reason }, { id: "b", reason }])
    expect(message).toContain("2 jobs left unchanged")
    expect(message.split("Cannot change").length - 1).toBe(1)
  })

  it("says nothing when nothing was blocked", () => {
    expect(describeBlocked([])).toBe("")
  })
})
