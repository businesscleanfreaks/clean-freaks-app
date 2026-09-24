import { describe, it, expect } from "vitest"
import { effectiveRecipients, recipientWrite, splitEmails, type RecipientClientFields } from "@/lib/invoice-recipients"

const contacts = [
  { id: "c1", name: "Naz Habib", email: "naz@1440.com", billingRole: "Owner" },
  { id: "c2", name: "Amber Pineda", email: "APineda@sfv.com", billingRole: "Property Manager" },
  { id: "c3", name: "No Email", email: null },
]

const fields = (over: Partial<RecipientClientFields> = {}): RecipientClientFields => ({
  invoicingEmail: "naz@1440.com",
  invoicingContactName: "Naz",
  invoicingCcEmail: null,
  communicationEmail: "front@1440.com",
  communicationContactName: "Front desk",
  ...over,
})

describe("who invoices go to today", () => {
  it("is the invoicing email, named from the matching contact", () => {
    expect(effectiveRecipients(fields(), contacts)).toEqual([
      { email: "naz@1440.com", name: "Naz Habib", contactId: "c1", billingRole: "Owner", tag: "TO" },
    ])
  })

  it("adds the CC list, matching contacts whatever the case", () => {
    const r = effectiveRecipients(fields({ invoicingCcEmail: "apineda@sfv.com; books@x.com" }), contacts)
    expect(r.map(x => [x.email, x.tag, x.contactId])).toEqual([
      ["naz@1440.com", "TO", "c1"],
      ["apineda@sfv.com", "CC", "c2"],
      ["books@x.com", "CC", null],
    ])
  })

  it("falls back to the communication email, as sending does", () => {
    const r = effectiveRecipients(fields({ invoicingEmail: null }), contacts)
    expect(r).toEqual([{ email: "front@1440.com", name: "Front desk", contactId: null, billingRole: null, tag: "TO" }])
  })

  it("does not list the same address twice", () => {
    expect(effectiveRecipients(fields({ invoicingCcEmail: "NAZ@1440.com" }), contacts)).toHaveLength(1)
  })

  it("is empty with no address at all", () => {
    expect(effectiveRecipients(fields({ invoicingEmail: null, communicationEmail: null }), contacts)).toEqual([])
  })
})

describe("saving the card", () => {
  it("writes the first as the greeted address and the rest as CC", () => {
    const w = recipientWrite([{ email: "apineda@sfv.com" }, { email: "naz@1440.com", contactId: "c1" }, { email: "books@x.com" }], contacts)
    expect(w.client).toEqual({
      invoicingEmail: "apineda@sfv.com",
      invoicingContactName: "Amber Pineda",
      invoicingCcEmail: "naz@1440.com, books@x.com",
    })
  })

  it("mirrors the order onto the contacts and clears everyone else", () => {
    const w = recipientWrite([{ email: "apineda@sfv.com" }, { email: "naz@1440.com" }], contacts)
    expect(w.flags).toEqual([
      { contactId: "c1", billingOrder: 1 },
      { contactId: "c2", billingOrder: 0 },
      { contactId: "c3", billingOrder: null },
    ])
  })

  it("collapses duplicates and keeps a typed name for an address with no contact", () => {
    const w = recipientWrite([{ email: "ap@x.com", name: "Accounts" }, { email: "AP@x.com" }], contacts)
    expect(w.client).toEqual({ invoicingEmail: "ap@x.com", invoicingContactName: "Accounts", invoicingCcEmail: null })
  })

  it("splits a pasted list", () => {
    expect(splitEmails("a@x.com, b@x.com;c@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"])
  })
})
