import { describe, it, expect } from "vitest"
import { candidateToRow, isPendingRow, mergeCandidates, type CandidateSource } from "@/lib/ledger-candidates"
import type { LedgerRow } from "@/lib/invoice-ledger"

const cand = (over: Partial<CandidateSource> = {}): CandidateSource => ({
  candidateId: "cand-1",
  clientId: "c1",
  clientName: "Acme",
  billingType: "PER_CLEAN",
  total: 290,
  jobCount: 2,
  ...over,
})

const stored = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "inv-1",
  invoiceNumber: "INV-1",
  clientName: "Existing",
  status: "SENT",
  totalAmount: 100,
  dateDue: null,
  datePaid: null,
  scheduledSendAt: null,
  billingType: "PER_CLEAN",
  isOneOff: false,
  paymentMethod: null,
  paymentReference: null,
  clearingSince: null,
  trackOnly: false,
  ledgerStatus: "Sent: Unpaid",
  statusLabel: "Sent: Unpaid",
  clearing: false,
  kind: "Per clean",
  daysLate: 0,
  subtext: null,
  ...over,
} as LedgerRow)

describe("candidateToRow", () => {
  it("files a candidate under To send", () => {
    expect(candidateToRow(cand()).ledgerStatus).toBe("To send")
  })

  it("carries the money and the client through", () => {
    const r = candidateToRow(cand({ total: 2050, clientName: "1440 23rd Street" }))
    expect(r.totalAmount).toBe(2050)
    expect(r.clientName).toBe("1440 23rd Street")
  })

  it("is marked pending so a click can open the workspace", () => {
    const r = candidateToRow(cand())
    expect(isPendingRow(r)).toBe(true)
    expect(r.candidateId).toBe("cand-1")
  })

  it("leaves the due date empty · there are no agreed terms until it exists", () => {
    expect(candidateToRow(cand()).dateDue).toBeNull()
  })

  it("never reads as late", () => {
    expect(candidateToRow(cand()).daysLate).toBe(0)
  })

  it("reads the kind from the billing type", () => {
    expect(candidateToRow(cand({ billingType: "FLAT_RATE" })).kind).toBe("Flat rate")
    expect(candidateToRow(cand({ billingType: "PER_CLEAN" })).kind).toBe("Per clean")
  })

  it("says how many cleans it covers", () => {
    expect(candidateToRow(cand({ jobCount: 9 })).subtext).toBe("9 cleans this month")
    expect(candidateToRow(cand({ jobCount: 1 })).subtext).toBe("1 clean this month")
  })
})

describe("mergeCandidates", () => {
  it("adds pending candidates alongside stored invoices", () => {
    const out = mergeCandidates([stored()], [cand()])
    expect(out).toHaveLength(2)
    expect(out.filter(isPendingRow)).toHaveLength(1)
  })

  it("drops a candidate whose invoice already exists · never double-count", () => {
    const out = mergeCandidates([stored({ id: "inv-9" })], [cand({ existingInvoiceId: "inv-9" })])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("inv-9")
  })

  it("drops a finalised candidate even when its invoice is outside this period", () => {
    const out = mergeCandidates([], [cand({ existingInvoiceId: "inv-elsewhere" })])
    expect(out).toHaveLength(0)
  })

  it("leaves stored rows untouched", () => {
    const rows = [stored()]
    const out = mergeCandidates(rows, [])
    expect(out).toEqual(rows)
  })

  it("handles an empty ledger with a full queue", () => {
    const out = mergeCandidates([], [cand({ candidateId: "a" }), cand({ candidateId: "b" })])
    expect(out.map(r => r.id)).toEqual(["a", "b"])
  })
})
