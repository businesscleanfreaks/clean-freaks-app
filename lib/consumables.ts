/**
 * Consumables — supplies billed to a client, and optionally paid back to the
 * cleaner who bought them.
 *
 * Josh's design (2026-08-29). Two rules shape everything here:
 *
 *  1. ONE RECORD, BOTH SIDES. What the client is charged and what the cleaner
 *     is reimbursed are independent amounts on the same record: charge-only,
 *     equal, or a reduced payback. Stopping the charge stops the payback.
 *
 *  2. SENT INVOICES NEVER CHANGE. A recurring charge applies to every invoice
 *     not yet sent; the amount in force when an invoice goes out is stamped on
 *     it. Turning it on, off, or changing it must never rewrite history.
 *
 * Pure: no Prisma, no React.
 */

/** What a consumable record is for. */
export type ConsumableKind =
  /** A flat line on every unsent invoice for one client. */
  | "RECURRING"
  /** Supplies bought on one visit. */
  | "ADHOC"
  /** A cleaner's standalone monthly allowance, tied to no client. */
  | "ALLOWANCE"

/** The line the design puts on the invoice for a recurring charge. */
export const RECURRING_LABEL = "Consumables · monthly"

export interface ConsumableRecord {
  id: string
  kind: ConsumableKind
  clientId?: string | null
  subcontractorId?: string | null
  jobId?: string | null
  description?: string | null
  /** Charged to the client. Zero means payback-only. */
  billAmount: number
  /** Reimbursed to the cleaner. Zero means charge-only. */
  paybackAmount: number
  date?: string | null
  isActive?: boolean
}

export interface ConsumableLine {
  label: string
  amount: number
  /** Marks the line so a later sync can replace just this one. */
  recurring: boolean
  consumableId: string
}

/**
 * The consumable lines an invoice should carry.
 *
 * A sent or paid invoice returns null — meaning "leave it exactly as it is".
 * That is deliberately distinct from returning an empty list, which would mean
 * "remove the lines it has".
 */
export function consumableLinesFor(
  invoiceStatus: string,
  recurring: ConsumableRecord | null,
  adhoc: ConsumableRecord[],
): ConsumableLine[] | null {
  const settled = invoiceStatus === "SENT" || invoiceStatus === "PAID"
  if (settled) return null

  const lines: ConsumableLine[] = []
  if (recurring && recurring.isActive !== false && recurring.billAmount > 0) {
    lines.push({
      label: RECURRING_LABEL,
      amount: recurring.billAmount,
      recurring: true,
      consumableId: recurring.id,
    })
  }
  for (const a of adhoc) {
    if (a.billAmount <= 0) continue
    lines.push({
      label: a.description?.trim() || "Consumables",
      amount: a.billAmount,
      recurring: false,
      consumableId: a.id,
    })
  }
  return lines
}

export interface AllowanceSlice {
  /** Null for the standalone slice, which is edited on the Pay schedule. */
  clientId: string | null
  clientName: string | null
  amount: number
  /** Client-linked slices are edited in the Billing schedule, not here. */
  editableHere: boolean
}

export interface AllowanceSummary {
  total: number
  slices: AllowanceSlice[]
}

/**
 * A cleaner's monthly consumables allowance, broken into its slices.
 *
 * Client-linked slices are marked read-only here on purpose: they are set in
 * the Billing schedule alongside the charge, so the two sides cannot drift.
 */
export function cleanerAllowance(
  records: ConsumableRecord[],
  clientNames: Record<string, string> = {},
): AllowanceSummary {
  const slices: AllowanceSlice[] = []
  for (const r of records) {
    if (r.isActive === false) continue
    if (r.paybackAmount <= 0) continue
    if (r.kind === "ADHOC") continue
    slices.push({
      clientId: r.clientId ?? null,
      clientName: r.clientId ? clientNames[r.clientId] ?? null : null,
      amount: r.paybackAmount,
      editableHere: r.kind === "ALLOWANCE",
    })
  }
  slices.sort((a, b) => {
    // Standalone first: it is the one you can actually change here.
    if (!a.clientId !== !b.clientId) return a.clientId ? 1 : -1
    return (a.clientName ?? "").localeCompare(b.clientName ?? "")
  })
  return { total: round2(slices.reduce((s, x) => s + x.amount, 0)), slices }
}

/** Ad-hoc paybacks land in the cleaner's payables for the month they happened. */
export function adhocPaybackTotal(records: ConsumableRecord[]): number {
  return round2(
    records
      .filter(r => r.kind === "ADHOC" && r.isActive !== false)
      .reduce((s, r) => s + (r.paybackAmount > 0 ? r.paybackAmount : 0), 0),
  )
}

export interface ConsumableDraft {
  bill: number
  payback: number
}

/**
 * Whether a draft is worth saving, and what is wrong with it.
 *
 * Both sides zero means "stop", handled by the caller as a delete rather than
 * a save. A payback larger than the charge is allowed — the business can
 * reimburse more than it bills — but a negative on either side is not.
 */
export function validateConsumable(d: ConsumableDraft): string | null {
  if (!Number.isFinite(d.bill) || !Number.isFinite(d.payback)) return "Enter an amount."
  if (d.bill < 0 || d.payback < 0) return "Amounts cannot be negative."
  if (d.bill === 0 && d.payback === 0) return "Enter a charge, a payback, or both."
  return null
}

/**
 * The payback mirrors the charge until someone touches it, so the common case
 * (buy supplies, bill it on, pay it back in full) is one number not two.
 */
export function mirroredPayback(bill: number, paybackTouched: boolean, payback: number): number {
  return paybackTouched ? payback : bill
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The plain-language line under the two amount fields, which is the only place
 * the operator is told what a charge-only or payback-only entry actually does.
 */
export function consumableSummary(bill: number, payback: number, cleanerFirstName: string): string {
  const first = cleanerFirstName || "the cleaner"
  const money = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`
  if (bill > 0 && payback > 0) {
    return `Client billed ${money(bill)} · ${first} gets ${money(payback)} with the next payout`
  }
  if (bill > 0) return `Client billed ${money(bill)} · no reimbursement`
  if (payback > 0) return `${first} gets ${money(payback)} back · the client isn't billed`
  return "Enter at least one amount"
}
