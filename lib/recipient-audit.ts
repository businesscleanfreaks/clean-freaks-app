/**
 * Which clients still need an invoice recipient designated.
 *
 * Older clients predate the invoicing contact fields, so invoices fall back to
 * whatever general communication address is on file — which may be a cleaner
 * coordinator, an office manager, or nobody at all. Josh is going through
 * these by hand, so the job here is to produce a worklist that says exactly
 * what each client is missing and what the invoice would do today.
 */

export type RecipientState = "designated" | "fallback" | "missing"

export interface RecipientAuditClient {
  id: string
  name: string
  invoicingEmail?: string | null
  invoicingContactName?: string | null
  communicationEmail?: string | null
  communicationContactName?: string | null
  /** Used only to sort the worklist — chase the clients you actually bill. */
  activeInvoiceCount?: number
}

export interface RecipientAuditRow {
  id: string
  name: string
  state: RecipientState
  /** The address an invoice would actually go to today, or null. */
  effectiveEmail: string | null
  effectiveContactName: string | null
  /** Plain-English explanation for the operator. */
  note: string
  activeInvoiceCount: number
}

const clean = (v: string | null | undefined) => (v ?? "").trim()

export function auditRecipient(client: RecipientAuditClient): RecipientAuditRow {
  const invoicing = clean(client.invoicingEmail)
  const comms = clean(client.communicationEmail)
  const invoicingName = clean(client.invoicingContactName)
  const commsName = clean(client.communicationContactName)

  let state: RecipientState
  let note: string
  if (invoicing) {
    state = "designated"
    note = "Invoice recipient set."
  } else if (comms) {
    state = "fallback"
    note = "No invoice recipient · invoices go to the general contact."
  } else {
    state = "missing"
    note = "No email on file at all · invoices cannot be sent."
  }

  return {
    id: client.id,
    name: client.name,
    state,
    effectiveEmail: invoicing || comms || null,
    effectiveContactName: (invoicing ? invoicingName : commsName) || null,
    note,
    activeInvoiceCount: client.activeInvoiceCount ?? 0,
  }
}

/**
 * The worklist, worst first: clients that cannot be invoiced at all, then ones
 * silently relying on the general contact, then the ones already done. Within
 * a group, the clients you bill most come first — those are the ones where a
 * wrong recipient costs you every month.
 */
export function buildRecipientWorklist(clients: RecipientAuditClient[]): RecipientAuditRow[] {
  const rank: Record<RecipientState, number> = { missing: 0, fallback: 1, designated: 2 }
  return clients
    .map(auditRecipient)
    .sort((a, b) =>
      rank[a.state] - rank[b.state] ||
      b.activeInvoiceCount - a.activeInvoiceCount ||
      a.name.localeCompare(b.name),
    )
}

/** How many still need attention — the number worth putting on a badge. */
export function outstandingCount(rows: RecipientAuditRow[]): number {
  return rows.filter(r => r.state !== "designated").length
}
