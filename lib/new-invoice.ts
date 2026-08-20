/**
 * The "New invoice" panel's logic: the ad-hoc invoice a VA raises for work
 * that never came off the calendar — a fee, supplies, damage.
 *
 * Kept pure so the money maths and the guard rails can be tested without a
 * database or a browser.
 */

export interface InvoicePreset {
  name: string
  /** Starting amount; Supplies has none because it is always priced per case. */
  amount: number | null
}

/** The office's standard extras, with the prices they usually go out at. */
export const INVOICE_PRESETS: InvoicePreset[] = [
  { name: "Deep clean", amount: 350 },
  { name: "Move-out clean", amount: 450 },
  { name: "Carpet shampoo", amount: 200 },
  { name: "Window cleaning", amount: 175 },
  { name: "Post-construction", amount: 600 },
  { name: "Post-event clean", amount: 300 },
  { name: "Strip & wax", amount: 500 },
  { name: "Supplies", amount: null },
]

export interface DraftLine {
  id: string
  name: string
  /** Raw text as typed — "1,250.50", "$300", "" — parsed on read. */
  amount: string
}

/**
 * Money as typed by a human: strips currency symbols and thousands separators.
 * Anything that is not a number reads as zero rather than NaN, so a half-typed
 * amount never renders a broken total.
 */
export function parseAmount(raw: string): number {
  const cleaned = (raw || "").replace(/[^0-9.-]/g, "")
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function draftTotal(lines: DraftLine[]): number {
  return lines.reduce((sum, l) => sum + parseAmount(l.amount), 0)
}

export interface DraftProblem {
  code: "NO_CLIENT" | "NO_LINES" | "EMPTY_LINE" | "ZERO_TOTAL"
  message: string
}

/**
 * What would stop this invoice being raised. Returns everything at once so the
 * panel can say what is missing rather than failing one field at a time.
 */
export function validateDraft(clientId: string | null, lines: DraftLine[]): DraftProblem[] {
  const problems: DraftProblem[] = []
  if (!clientId) problems.push({ code: "NO_CLIENT", message: "Choose who this invoice is for." })
  if (lines.length === 0) {
    problems.push({ code: "NO_LINES", message: "Add at least one line." })
    return problems
  }
  if (lines.some(l => !l.name.trim())) {
    problems.push({ code: "EMPTY_LINE", message: "Every line needs a description." })
  }
  if (draftTotal(lines) <= 0) {
    problems.push({ code: "ZERO_TOTAL", message: "The total has to be more than zero." })
  }
  return problems
}

/** Line items in the shape POST /api/invoices expects. */
export function toApiLineItems(lines: DraftLine[]) {
  return lines.map(l => ({
    description: l.name.trim(),
    amount: parseAmount(l.amount),
    jobId: null,
    addOnServiceId: null,
    serviceDate: new Date().toISOString(),
  }))
}

/**
 * Whether to warn that this client is already invoiced automatically.
 *
 * The design shows it for clients on a recurring cadence: their completed
 * cleans are billed on schedule, so anything raised here is an extra on top —
 * and raising a duplicate for work already invoiced is the mistake to prevent.
 */
export function billsAutomatically(billingType: string | null | undefined): boolean {
  return billingType === "FLAT_RATE" || billingType === "PER_CLEAN"
}
