/**
 * What a client is allowed to see on their own invoice.
 *
 * The public invoice page used to load the whole record · the client with its
 * notes, EVERY location on the account, and each line's job with the location
 * again · and hand that object to a `"use client"` component. Everything a
 * client component receives is serialised into the page, so it was readable by
 * anyone holding the invoice link whether or not it was ever displayed.
 *
 * What that meant in practice, from the schema:
 *
 *  - `Location.accessInfo` · "Gate codes, key locations, entry instructions".
 *  - `Location.accessFields` · entry, alarm, gate, lockbox, parking.
 *  - `Client.notes` and `Client.scopeNotes` · internal account notes.
 *  - `Job.subcontractorRate` · what we pay the cleaner, i.e. the margin.
 *  - `Job.notes` and `Job.trialNotes`.
 *
 * None of it was rendered. The page needs nine invoice fields, two client
 * fields, and the line items.
 *
 * The token controls WHO can open the invoice. It does not make that person an
 * authorised reader of our operating records, so the fix is to stop sending
 * them rather than to rely on the component not printing them.
 *
 * The shape below is the allowlist. Add a field only when the client is meant
 * to read it.
 */

/** One line as the public invoice renders it. */
export interface PublicInvoiceLineItem {
  id: string
  description: string
  amount: number
  /** Drives grouping and ordering; a service date is on the invoice anyway. */
  serviceDate: Date | string | null
  /** Grouping keys only. No job record is exposed. */
  jobId: string | null
  addOnServiceId: string | null
}

export interface PublicInvoice {
  id: string
  invoiceNumber: string
  dateCreated: Date | string
  totalAmount: number
  status: string
  pdfUrl: string | null
  showPaymentOptions: boolean
  client: {
    name: string
    /** Decides whether lines group per clean. Not sensitive. */
    billingType: string | null
  }
  lineItems: PublicInvoiceLineItem[]
}

/**
 * The Prisma `select` for a public invoice.
 *
 * Deliberately a `select` and not an `include`: an include grows silently as
 * the schema does, so a new sensitive column would start being published the
 * day it was added. A select only ever returns what is named here.
 */
export const PUBLIC_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  dateCreated: true,
  totalAmount: true,
  status: true,
  pdfUrl: true,
  showPaymentOptions: true,
  client: {
    select: {
      name: true,
      billingType: true,
    },
  },
  lineItems: {
    select: {
      id: true,
      description: true,
      amount: true,
      serviceDate: true,
      jobId: true,
      addOnServiceId: true,
    },
    orderBy: { serviceDate: "asc" },
  },
} as const

/**
 * Field names that must never reach a client, for the regression test.
 *
 * Listed by name rather than checked structurally because the point is to fail
 * loudly if someone widens the select later.
 */
export const NEVER_PUBLIC_FIELDS = [
  "accessInfo",
  "accessFields",
  "subcontractorRate",
  "subcontractorId",
  "scopeNotes",
  "notes",
  "trialNotes",
  "locations",
  "job",
] as const
