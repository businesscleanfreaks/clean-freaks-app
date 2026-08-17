/**
 * Billing schedule — the per-client rules shown in the Invoices → Billing
 * schedule sheet. Every value is stored on the Client record.
 */

export const CLIENT_TYPES = ["COMMERCIAL", "RESIDENTIAL"] as const
/** The design's column header must read "Invoicing cadence", not "frequency". */
export const CADENCES = ["AFTER_EACH_CLEAN", "BI_WEEKLY", "END_OF_MONTH", "CUSTOM"] as const
export const TERMS = ["NET_7", "NET_15", "NET_30"] as const
export const PAY_METHODS = ["ZELLE", "ACH", "PORTAL", "CHECK"] as const
export const DELIVERY = ["EMAIL", "TRACK_ONLY"] as const

export const CADENCE_LABELS: Record<string, string> = {
  AFTER_EACH_CLEAN: "After each clean",
  BI_WEEKLY: "Every 2 weeks",
  END_OF_MONTH: "Month end",
  CUSTOM: "Custom",
}
export const TERM_LABELS: Record<string, string> = {
  NET_7: "Net 7",
  NET_15: "Net 15",
  NET_30: "Net 30",
}
export const PAY_METHOD_LABELS: Record<string, string> = {
  ZELLE: "Zelle",
  ACH: "ACH",
  PORTAL: "Their portal",
  CHECK: "Check",
}
export const DELIVERY_LABELS: Record<string, string> = {
  EMAIL: "Email invoice",
  TRACK_ONLY: "Track only",
}

export interface BillingScheduleRow {
  id: string
  name: string
  clientType: string | null
  cadence: string
  terms: string | null
  payMethod: string | null
  delivery: string
  locationCount: number
  separateLocationInvoices: boolean
}

/** Fields the sheet may change. Anything else on the client is untouched. */
export interface BillingScheduleUpdate {
  clientType?: string | null
  cadence?: string
  terms?: string | null
  payMethod?: string | null
  delivery?: string
  separateLocationInvoices?: boolean
}

const inSet = <T extends readonly string[]>(set: T, v: unknown): v is T[number] =>
  typeof v === "string" && (set as readonly string[]).includes(v)

/**
 * Validates one update, returning only the fields that are safe to write.
 * Returns an error message instead when a value is not a known option, so a
 * typo can never quietly change how a client is billed.
 */
export function validateUpdate(
  patch: Record<string, unknown>,
): { error: string } | { data: BillingScheduleUpdate } {
  const data: BillingScheduleUpdate = {}

  if ("clientType" in patch) {
    if (patch.clientType === null) data.clientType = null
    else if (inSet(CLIENT_TYPES, patch.clientType)) data.clientType = patch.clientType
    else return { error: "Unknown client type." }
  }
  if ("cadence" in patch) {
    if (!inSet(CADENCES, patch.cadence)) return { error: "Unknown invoicing cadence." }
    data.cadence = patch.cadence
  }
  if ("terms" in patch) {
    if (patch.terms === null) data.terms = null
    else if (inSet(TERMS, patch.terms)) data.terms = patch.terms
    else return { error: "Unknown payment terms." }
  }
  if ("payMethod" in patch) {
    if (patch.payMethod === null) data.payMethod = null
    else if (inSet(PAY_METHODS, patch.payMethod)) data.payMethod = patch.payMethod
    else return { error: "Unknown payment method." }
  }
  if ("delivery" in patch) {
    if (!inSet(DELIVERY, patch.delivery)) return { error: "Unknown billing method." }
    data.delivery = patch.delivery
  }
  if ("separateLocationInvoices" in patch) {
    if (typeof patch.separateLocationInvoices !== "boolean") {
      return { error: "Invoice split must be true or false." }
    }
    data.separateLocationInvoices = patch.separateLocationInvoices
  }

  if (Object.keys(data).length === 0) return { error: "Nothing to update." }
  return { data }
}

/** The blue multi-location pill copy. Only shown for multi-location clients. */
export function locationPillLabel(row: BillingScheduleRow): string | null {
  if (row.locationCount < 2) return null
  return row.separateLocationInvoices
    ? "Separate invoices"
    : `One combined invoice · ${row.locationCount} locations`
}
