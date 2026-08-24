import { describe, it, expect } from "vitest"
import {
  auditRecipient,
  buildRecipientWorklist,
  outstandingCount,
  type RecipientAuditClient,
} from "@/lib/recipient-audit"

const c = (over: Partial<RecipientAuditClient>): RecipientAuditClient => ({
  id: "c1",
  name: "Acme",
  ...over,
})

describe("auditRecipient", () => {
  it("is done when an invoicing address is set", () => {
    const r = auditRecipient(c({ invoicingEmail: "ap@acme.com", invoicingContactName: "Dana" }))
    expect(r.state).toBe("designated")
    expect(r.effectiveEmail).toBe("ap@acme.com")
    expect(r.effectiveContactName).toBe("Dana")
  })

  it("flags a client silently relying on the general contact", () => {
    const r = auditRecipient(c({ communicationEmail: "office@acme.com", communicationContactName: "Sam" }))
    expect(r.state).toBe("fallback")
    expect(r.effectiveEmail).toBe("office@acme.com")
    expect(r.effectiveContactName).toBe("Sam")
    expect(r.note).toContain("general contact")
  })

  it("flags a client that cannot be invoiced at all", () => {
    const r = auditRecipient(c({}))
    expect(r.state).toBe("missing")
    expect(r.effectiveEmail).toBeNull()
  })

  it("treats a whitespace-only address as no address", () => {
    expect(auditRecipient(c({ invoicingEmail: "   " })).state).toBe("missing")
    expect(auditRecipient(c({ invoicingEmail: "  ", communicationEmail: "o@acme.com" })).state).toBe("fallback")
  })

  it("does not borrow the general contact's NAME for a designated address", () => {
    const r = auditRecipient(c({ invoicingEmail: "ap@acme.com", communicationContactName: "Sam" }))
    expect(r.effectiveContactName).toBeNull()
  })
})

describe("buildRecipientWorklist", () => {
  it("puts the un-invoiceable first, then fallbacks, then the done ones", () => {
    const rows = buildRecipientWorklist([
      c({ id: "done", invoicingEmail: "a@x.com" }),
      c({ id: "fallback", communicationEmail: "b@x.com" }),
      c({ id: "missing" }),
    ])
    expect(rows.map(r => r.id)).toEqual(["missing", "fallback", "done"])
  })

  it("chases the clients you bill most within a group", () => {
    const rows = buildRecipientWorklist([
      c({ id: "rare", name: "Rare", communicationEmail: "b@x.com", activeInvoiceCount: 1 }),
      c({ id: "often", name: "Often", communicationEmail: "c@x.com", activeInvoiceCount: 12 }),
    ])
    expect(rows.map(r => r.id)).toEqual(["often", "rare"])
  })

  it("falls back to name order so the list is stable", () => {
    const rows = buildRecipientWorklist([
      c({ id: "z", name: "Zed" }),
      c({ id: "a", name: "Acme" }),
    ])
    expect(rows.map(r => r.id)).toEqual(["a", "z"])
  })
})

describe("outstandingCount", () => {
  it("counts everything still needing attention", () => {
    const rows = buildRecipientWorklist([
      c({ id: "done", invoicingEmail: "a@x.com" }),
      c({ id: "fallback", communicationEmail: "b@x.com" }),
      c({ id: "missing" }),
    ])
    expect(outstandingCount(rows)).toBe(2)
  })

  it("is zero once every client is designated", () => {
    expect(outstandingCount(buildRecipientWorklist([c({ invoicingEmail: "a@x.com" })]))).toBe(0)
  })
})
