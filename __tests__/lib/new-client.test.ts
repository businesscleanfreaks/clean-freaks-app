import { describe, it, expect } from "vitest"
import { newClientRecords, validateNewClient, type NewClientInput } from "@/lib/new-client"
import { payTypesFromFirstSchedule } from "@/lib/first-schedule-pay-types"

const input = (over: Partial<NewClientInput> = {}): NewClientInput => ({
  name: "Bad Ladder",
  address: "1917 Hillhurst Ave, Los Angeles, CA 90027",
  contactName: "Ian Movius",
  role: "Owner",
  email: "ian@badladder.com",
  phone: "310-555-0100",
  pays: "invoice",
  separateBillingEmail: false,
  billingEmail: "",
  ...over,
})

describe("what the modal will accept", () => {
  it("needs only a name, as the design does", () => {
    expect(validateNewClient({ name: "Bad Ladder" })).toEqual([])
  })

  it("refuses a blank name", () => {
    expect(validateNewClient(input({ name: "   " })).map(p => p.field)).toEqual(["name"])
  })

  it("checks an email only when one is given", () => {
    expect(validateNewClient(input({ email: "" }))).toEqual([])
    expect(validateNewClient(input({ email: "ian@" })).map(p => p.field)).toEqual(["email"])
  })

  it("wants the billing email once the box is ticked", () => {
    expect(validateNewClient(input({ separateBillingEmail: true })).map(p => p.field)).toEqual(["billingEmail"])
    expect(validateNewClient(input({ separateBillingEmail: true, billingEmail: "ap@" })).map(p => p.field)).toEqual(["billingEmail"])
    expect(validateNewClient(input({ separateBillingEmail: true, billingEmail: "ap@badladder.com" }))).toEqual([])
  })

  it("ignores the billing box for a client who pays directly", () => {
    // The box is hidden then; a leftover tick must not block the save.
    expect(validateNewClient(input({ pays: "charge", separateBillingEmail: true }))).toEqual([])
  })

  it("reports every problem at once", () => {
    expect(validateNewClient(input({ name: "", email: "nope" })).map(p => p.field)).toEqual(["name", "email"])
  })
})

describe("the records a new client produces", () => {
  it("sends invoices to the contact, in both places invoices are read from", () => {
    const r = newClientRecords(input())
    expect(r.client.invoicingEmail).toBe("ian@badladder.com")
    expect(r.client.invoicingContactName).toBe("Ian Movius")
    expect(r.client.billingDelivery).toBe("EMAIL")
    expect(r.contacts).toHaveLength(1)
    expect(r.contacts[0]).toMatchObject({
      name: "Ian Movius", email: "ian@badladder.com", isPrimary: true,
      isBillingRecipient: true, billingOrder: 0, billingRole: "Owner", role: "OWNER",
    })
  })

  it("keeps the contact's job title as their role", () => {
    const r = newClientRecords(input({ role: "Regional Manager" }))
    expect(r.contacts[0]).toMatchObject({ billingRole: "Regional Manager", role: "GENERAL" })
  })

  it("calls a contact with no role picked the owner", () => {
    expect(newClientRecords(input({ role: "" })).contacts[0].billingRole).toBe("Owner")
  })

  it("sends invoices to a separate billing email, and only there", () => {
    const r = newClientRecords(input({ separateBillingEmail: true, billingEmail: "ap@badladder.com" }))
    expect(r.client.invoicingEmail).toBe("ap@badladder.com")
    expect(r.client.communicationEmail).toBe("ian@badladder.com")
    // Not "Hi Ian" on an email to the accounts inbox.
    expect(r.client.invoicingContactName).toBeNull()
    const recipients = r.contacts.filter(c => c.isBillingRecipient)
    expect(recipients.map(c => c.email)).toEqual(["ap@badladder.com"])
    expect(r.contacts.find(c => c.isPrimary)?.isBillingRecipient).toBe(false)
  })

  it("never emails a client who pays directly", () => {
    const r = newClientRecords(input({ pays: "charge", separateBillingEmail: true, billingEmail: "ap@badladder.com" }))
    expect(r.client.billingDelivery).toBe("TRACK_ONLY")
    expect(r.contacts.some(c => c.isBillingRecipient)).toBe(false)
    expect(r.contacts).toHaveLength(1)
  })

  it("adds no location without an address, and no contact without a name", () => {
    const r = newClientRecords({ name: "Bad Ladder" })
    expect(r.location).toBeNull()
    expect(r.contacts).toEqual([])
    expect(r.client.billingDelivery).toBe("EMAIL")
  })

  it("names the location for the client", () => {
    expect(newClientRecords(input()).location).toEqual({ name: "Bad Ladder", address: "1917 Hillhurst Ave, Los Angeles, CA 90027" })
  })

  it("trims what was typed and stores blanks as nothing", () => {
    const r = newClientRecords(input({ name: "  Bad Ladder ", phone: "  ", email: " ian@badladder.com " }))
    expect(r.client.name).toBe("Bad Ladder")
    expect(r.client.phone).toBeNull()
    expect(r.client.invoicingEmail).toBe("ian@badladder.com")
  })

  it("starts per clean until the first schedule says otherwise", () => {
    expect(newClientRecords(input()).client.billingType).toBe("PER_CLEAN")
  })

  it("carries a prospect's notes and link", () => {
    const r = newClientRecords(input({ notes: "Met at expo", sourceProspectId: "5d9e2b3e-8c1a-4a57-9f55-0f6b2b9d4f10" }))
    expect(r.client.notes).toBe("Met at expo")
    expect(r.sourceProspectId).toBe("5d9e2b3e-8c1a-4a57-9f55-0f6b2b9d4f10")
  })
})

describe("the first schedule sets the client's pay types", () => {
  const client = { billingType: "PER_CLEAN", cleanerPayType: "PER_CLEAN" }

  it("makes a new client flat rate when its first schedule is", () => {
    expect(payTypesFromFirstSchedule(0, { clientPayType: "FLAT_RATE", subcontractorPayType: "FLAT_RATE" }, client))
      .toEqual({ billingType: "FLAT_RATE", cleanerPayType: "FLAT_RATE" })
  })

  it("changes only what differs", () => {
    expect(payTypesFromFirstSchedule(0, { clientPayType: "FLAT_RATE", subcontractorPayType: "PER_CLEAN" }, client))
      .toEqual({ billingType: "FLAT_RATE" })
  })

  it("leaves an established client alone", () => {
    expect(payTypesFromFirstSchedule(2, { clientPayType: "FLAT_RATE", subcontractorPayType: "FLAT_RATE" }, client)).toBeNull()
  })

  it("does nothing when the schedule names no pay type, or an unknown one", () => {
    expect(payTypesFromFirstSchedule(0, {}, client)).toBeNull()
    expect(payTypesFromFirstSchedule(0, { clientPayType: "HOURLY" }, client)).toBeNull()
  })
})
