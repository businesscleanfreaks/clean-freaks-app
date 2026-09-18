/**
 * The invoice as the client receives it, as data.
 *
 * One model, rendered twice. The on-screen preview is HTML and the emailed
 * invoice is a PDF, so they cannot share components · but they were also not
 * sharing the CONTENT, and had drifted apart: the PDF grouped a month's visits
 * into one line while the preview listed every visit, and the two disagreed on
 * columns, on the header, and on what the footer said. The preview is supposed
 * to be titled "What your client receives", which is only true if it says the
 * same thing as the thing they receive.
 *
 * Josh's design notes, 2026-09-08, section C:
 *  - Wordmark left, large light INVOICE right. No logo mark, no strapline, no
 *    "Draft" · the client never sees a draft.
 *  - BILL TO on the left; invoice number, date and due date stacked right.
 *  - TOTAL DUE above the table as well as a Total row below it.
 *  - Four columns: description, qty, rate, amount.
 *  - Flat rate lists the locations covered with no per-location price. The
 *    price is a monthly one and splitting it invites an argument about a
 *    number the business never quoted.
 *  - Per clean is ONE row: "Scheduled cleans · 9 · $167.50 · $1,507.50".
 *  - No date ranges in descriptions and no em dashes anywhere.
 *
 * Pure: no Prisma, no React, no clock.
 */

import { groupInvoiceLineItems, type RawInvoiceLineItem } from "./invoice-grouping"
import { formatDateOnly } from "./date-only"

export interface DocumentRow {
  description: string
  /** Blank on a flat-rate row: the month is not sold by the visit. */
  quantity: string | null
  rate: string | null
  amount: string | null
  /** A credit, so the renderer can colour it. */
  negative: boolean
}

export interface DocumentMetaPair {
  label: string
  value: string
}

export interface InvoiceDocument {
  wordmark: string
  title: string
  billTo: { name: string; address: string | null }
  meta: DocumentMetaPair[]
  totalDueLabel: string
  totalDue: string
  columns: { description: string; quantity: string; rate: string; amount: string }
  rows: DocumentRow[]
  totalLabel: string
  total: string
  footer: { left: string; right: string | null }
}

export interface InvoiceLocation {
  name: string
  address?: string | null
}

export interface InvoiceDocumentInput {
  businessName: string
  businessPhone?: string | null
  clientName: string
  clientAddress?: string | null
  invoiceNumber?: string | null
  issuedDate?: Date | string | null
  dueDate?: Date | string | null
  /** FLAT_RATE | PER_CLEAN | ONE_TIME */
  billingType?: string | null
  lineItems?: RawInvoiceLineItem[]
  total: number
  /** "September 2026", for the fallback description. */
  monthLabel: string
  /** Locations covered, for the flat-rate row list. */
  locations?: InvoiceLocation[]
}

const money = (value: number): string =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" })

const text = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim()

/** "Jun 25, 2026", or null when there is no date to show. */
export function documentDate(value: Date | string | null | undefined): string | null {
  // An invoice date is a day, not a moment: rendering it in the server's zone
  // printed the day before on the client's copy anywhere ahead of UTC.
  return formatDateOnly(value, "MMM d, yyyy")
}

/**
 * A line description fit to print.
 *
 * Strips the trailing date range the candidate builder appends and flattens the
 * dashes it joins on. "Monthly Cleaning — Dordick Law — Sep 1 – Sep 30, 2026"
 * tells the client three things they can already see: which month it is, whose
 * invoice it is, and that a month has days in it.
 */
export function cleanDescription(raw: string): string {
  let out = text(raw)

  // Trailing "— Sep 1 - Sep 30, 2026" or "· Sep 1 – Sep 30".
  out = out.replace(
    /\s*[—–·-]\s*[A-Z][a-z]{2}\s+\d{1,2}\s*[—–-]\s*[A-Z][a-z]{2}\s+\d{1,2}(,\s*\d{4})?\s*$/,
    "",
  )
  // A single trailing date, e.g. "Cleaning - Acme - Sep 3".
  out = out.replace(/\s*[—–·-]\s*[A-Z][a-z]{2}\s+\d{1,2}(,\s*\d{4})?\s*$/, "")

  // Josh's copy rule: no em dashes anywhere.
  out = out.replace(/\s*[—–]\s*/g, " · ")
  return text(out)
}

/** "Monthly Cleaning Services for Long Beach Gym (420 Grand Ave)". */
export function flatRateRowDescription(location: InvoiceLocation): string {
  const name = text(location.name)
  const address = text(location.address)
  const where = address && address !== name ? `${name} (${address})` : name
  return where ? `Monthly Cleaning Services for ${where}` : "Monthly Cleaning Services"
}

/**
 * The rows of the table.
 *
 * Flat rate lists what the month covers and prices none of it; per clean
 * collapses the visits into a single quantity × rate line, which is the only
 * arithmetic the client needs to check.
 */
export function buildDocumentRows(input: InvoiceDocumentInput): DocumentRow[] {
  const lineItems = input.lineItems ?? []
  const isFlat = input.billingType === "FLAT_RATE"

  if (isFlat) {
    const locations = input.locations ?? []
    const source: InvoiceLocation[] = locations.length > 0
      ? locations
      // No location list to hand: fall back to the line items' own wording so
      // the invoice still says what it covers.
      : lineItems.map(li => ({ name: cleanDescription(li.description) }))

    if (source.length === 0) {
      return [{
        description: `Monthly Cleaning Services · ${input.monthLabel}`,
        quantity: null, rate: null, amount: null, negative: false,
      }]
    }

    return source.map(location => ({
      description: locations.length > 0
        ? flatRateRowDescription(location)
        : text(location.name),
      // Deliberately blank · the monthly price is not split per location.
      quantity: null,
      rate: null,
      amount: null,
      negative: false,
    }))
  }

  if (lineItems.length === 0) {
    return [{
      description: `Cleaning services · ${input.monthLabel}`,
      quantity: "1",
      rate: money(input.total),
      amount: money(input.total),
      negative: input.total < 0,
    }]
  }

  // Groups a month's visits into one row; add-ons and manual lines stay their
  // own rows, which is what a client would query separately anyway.
  return groupInvoiceLineItems(lineItems, { billingType: input.billingType }).map(row => ({
    description: row.grouped ? "Scheduled cleans" : cleanDescription(row.description),
    quantity: String(row.quantity),
    rate: money(row.unitPrice),
    amount: money(row.amount),
    negative: row.amount < 0,
  }))
}

/**
 * The whole document.
 *
 * No "Draft" and no status anywhere: whether the invoice has been sent is the
 * business's business, and printing it on the client's copy has confused
 * people into thinking they were sent something provisional.
 */
export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocument {
  const meta: DocumentMetaPair[] = []
  const number = text(input.invoiceNumber)
  if (number) meta.push({ label: "INVOICE #", value: number })

  const issued = documentDate(input.issuedDate)
  if (issued) meta.push({ label: "DATE", value: issued })

  const due = documentDate(input.dueDate)
  if (due) meta.push({ label: "DUE DATE", value: due })

  return {
    wordmark: text(input.businessName).toUpperCase(),
    title: "INVOICE",
    billTo: {
      name: text(input.clientName),
      address: text(input.clientAddress) || null,
    },
    meta,
    totalDueLabel: "TOTAL DUE",
    totalDue: money(input.total),
    columns: { description: "DESCRIPTION", quantity: "QTY", rate: "RATE", amount: "AMOUNT" },
    rows: buildDocumentRows(input),
    totalLabel: "Total",
    total: money(input.total),
    footer: {
      left: "Thank you for your business",
      right: text(input.businessPhone) || null,
    },
  }
}
