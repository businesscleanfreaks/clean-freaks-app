/**
 * Pending work, folded into the invoice list.
 *
 * The ledger reads real invoice rows, but most of a month's billing has no row
 * yet — it is still a candidate the workspace has not finalised. Showing only
 * real rows meant the main page listed 2 clients while the queue said 34, which
 * is what Josh hit: "it says there are 33 in the queue, but the main page only
 * shows a few."
 *
 * So candidates without an invoice row are shown here as "To send", carrying
 * their candidate id so a click opens the workspace rather than an invoice page
 * that does not exist yet.
 */

import type { LedgerRow } from "./invoice-ledger"

export interface CandidateSource {
  candidateId: string
  clientId: string
  clientName: string
  billingType: string | null
  total: number
  jobCount?: number
  /** Set once the workspace has created the invoice. */
  existingInvoiceId?: string | null
  existingInvoiceNumber?: string | null
  status?: string
}

/** A ledger row backed by a candidate rather than a stored invoice. */
export interface PendingLedgerRow extends LedgerRow {
  /** Marks rows that open the workspace instead of an invoice page. */
  pending: true
  candidateId: string
}

export function isPendingRow(row: LedgerRow): row is PendingLedgerRow {
  return (row as PendingLedgerRow).pending === true
}

/**
 * Turn a candidate into a row the ledger can render.
 *
 * Due date is left null: until the invoice exists there are no agreed terms to
 * derive one from, and inventing a date here would disagree with the date the
 * invoice actually gets when it is created.
 */
export function candidateToRow(c: CandidateSource): PendingLedgerRow {
  return {
    id: c.candidateId,
    candidateId: c.candidateId,
    pending: true,
    invoiceNumber: "Draft",
    clientId: c.clientId,
    clientName: c.clientName,
    status: "DRAFT",
    totalAmount: c.total,
    dateDue: null,
    datePaid: null,
    scheduledSendAt: null,
    billingType: c.billingType,
    isOneOff: false,
    paymentMethod: null,
    paymentReference: null,
    clearingSince: null,
    trackOnly: false,
    externallyBilledAt: null,
    externallyBilledNote: null,
    ledgerStatus: "To send",
    statusLabel: "To send",
    clearing: false,
    kind: c.billingType === "FLAT_RATE" ? "Flat rate" : "Per clean",
    daysLate: 0,
    // Deliberately no subtext: Josh does not want the clean count here.
    subtext: null,
  } as PendingLedgerRow
}

/**
 * Merge pending candidates into the stored rows.
 *
 * A candidate whose invoice already exists is dropped — the stored row is the
 * truth, and showing both would double-count the money.
 */
export function mergeCandidates(rows: LedgerRow[], candidates: CandidateSource[]): LedgerRow[] {
  const haveInvoice = new Set(rows.map(r => r.id))
  const pending = candidates
    .filter(c => !c.existingInvoiceId || !haveInvoice.has(c.existingInvoiceId))
    .filter(c => !c.existingInvoiceId)
    .map(candidateToRow)
  return [...rows, ...pending]
}
