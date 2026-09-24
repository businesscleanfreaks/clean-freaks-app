/**
 * What the Add Client modal saves.
 *
 * The modal asks for the account and who to bill (Clients Main.dc.html · "Add
 * the account and who to bill. You'll schedule their first clean next.").
 * Rate, cleaner and cadence come from the first schedule, booked after.
 *
 * This decides the records; the route writes them in one transaction. The old
 * wizard created the client, then the location, then the schedule, each its
 * own request from the browser, so a failure part-way left half a client.
 *
 * Invoices are sent to Client.invoicingEmail, while the Billing tab's
 * "Invoices sent to" card reads contacts flagged as billing recipients. The two
 * are not kept in step anywhere yet, so a new client is written to agree in
 * both places from the start.
 *
 * Pure: no Prisma.
 */

export const CONTACT_ROLES = [
  "Owner",
  "Property Manager",
  "Office Manager",
  "Operations / Facilities Manager",
] as const

export type PayMethod = "invoice" | "charge"

export interface NewClientInput {
  name: string
  address?: string | null
  contactName?: string | null
  /** A job title: one of CONTACT_ROLES, or free text from "Other role…". */
  role?: string | null
  email?: string | null
  phone?: string | null
  pays?: PayMethod
  separateBillingEmail?: boolean
  billingEmail?: string | null
  /** Carried over when a prospect becomes a client. */
  notes?: string | null
  sourceProspectId?: string | null
}

export type NewClientField = "name" | "address" | "contactName" | "role" | "email" | "phone" | "billingEmail"

export interface NewClientProblem {
  field: NewClientField
  message: string
}

export interface NewClientContactRecord {
  name: string
  email: string | null
  phone: string | null
  role: "OWNER" | "GENERAL" | "INVOICING"
  billingRole: string | null
  isPrimary: boolean
  isBillingRecipient: boolean
  billingOrder: number | null
}

export interface NewClientRecords {
  client: {
    name: string
    phone: string | null
    communicationEmail: string | null
    communicationContactName: string | null
    communicationPhone: string | null
    invoicingEmail: string | null
    invoicingContactName: string | null
    billingDelivery: "EMAIL" | "TRACK_ONLY"
    /** Provisional: the first schedule's pay type replaces it. See lib/first-schedule-pay-types.ts. */
    billingType: "PER_CLEAN"
    notes: string | null
  }
  location: { name: string; address: string } | null
  contacts: NewClientContactRecord[]
  sourceProspectId: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const clean = (value: string | null | undefined) => (value ?? "").trim()

/** Every problem at once, so the modal can mark all of them in one pass. */
export function validateNewClient(input: NewClientInput): NewClientProblem[] {
  const problems: NewClientProblem[] = []
  const name = clean(input.name)
  if (!name) problems.push({ field: "name", message: "Add the business or client name." })
  else if (name.length > 200) problems.push({ field: "name", message: "That name is too long." })

  if (clean(input.address).length > 500) problems.push({ field: "address", message: "That address is too long." })
  if (clean(input.contactName).length > 200) problems.push({ field: "contactName", message: "That name is too long." })
  if (clean(input.role).length > 100) problems.push({ field: "role", message: "That role is too long." })
  if (clean(input.phone).length > 50) problems.push({ field: "phone", message: "That phone number is too long." })

  const email = clean(input.email)
  if (email && !EMAIL_RE.test(email)) problems.push({ field: "email", message: "That email doesn't look right." })

  if (input.pays !== "charge" && input.separateBillingEmail) {
    const billing = clean(input.billingEmail)
    if (!billing) problems.push({ field: "billingEmail", message: "Add the billing email, or untick the box." })
    else if (!EMAIL_RE.test(billing)) problems.push({ field: "billingEmail", message: "That billing email doesn't look right." })
  }

  return problems
}

/**
 * The records for a valid input. Call validateNewClient first; this assumes
 * the input passed.
 */
export function newClientRecords(input: NewClientInput): NewClientRecords {
  const name = clean(input.name)
  const address = clean(input.address)
  const contactName = clean(input.contactName)
  const role = clean(input.role) || "Owner"
  const email = clean(input.email) || null
  const phone = clean(input.phone) || null
  const charge = input.pays === "charge"
  const separate = !charge && !!input.separateBillingEmail && !!clean(input.billingEmail)
  const billingEmail = separate ? clean(input.billingEmail) : null

  // Where invoices go. A client who pays directly is never emailed an
  // invoice (TRACK_ONLY), but keeps the address in case that changes.
  const invoicingEmail = separate ? billingEmail : email

  const contacts: NewClientContactRecord[] = []
  if (contactName) {
    const contactGetsInvoices = !charge && !separate && !!email
    contacts.push({
      name: contactName,
      email,
      phone,
      role: role === "Owner" ? "OWNER" : "GENERAL",
      billingRole: role,
      isPrimary: true,
      isBillingRecipient: contactGetsInvoices,
      billingOrder: contactGetsInvoices ? 0 : null,
    })
  }
  if (separate) {
    // An accounts inbox, not a person: named for what it is, so the Billing
    // card reads "Accounts payable · ap@company.com".
    contacts.push({
      name: "Accounts payable",
      email: billingEmail,
      phone: null,
      role: "INVOICING",
      billingRole: null,
      isPrimary: false,
      isBillingRecipient: true,
      billingOrder: 0,
    })
  }

  return {
    client: {
      name,
      phone,
      communicationEmail: email,
      communicationContactName: contactName || null,
      communicationPhone: phone,
      invoicingEmail,
      invoicingContactName: separate ? null : contactName || null,
      billingDelivery: charge ? "TRACK_ONLY" : "EMAIL",
      billingType: "PER_CLEAN",
      notes: clean(input.notes) || null,
    },
    // The location is named for the client, as the existing ones are; a
    // second location gets its own name when it is added on the profile.
    location: address ? { name, address } : null,
    contacts,
    sourceProspectId: clean(input.sourceProspectId) || null,
  }
}
