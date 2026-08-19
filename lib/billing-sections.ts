/**
 * The three settings sections at the top of the billing schedule sheet:
 * one-time job defaults, invoice footer templates and reminder templates.
 *
 * Pure: shapes, defaults and normalisation only. Everything here is read back
 * out of a JSON column that a human may have edited, so every reader goes
 * through a normaliser rather than trusting the stored shape.
 */

// ── One-time job defaults ────────────────────────────────────────────────────

export const ONE_TIME_JOB_KINDS = [
  { key: "residential", label: "Residential one-time" },
  { key: "commercial", label: "Commercial one-time" },
  { key: "postConstruction", label: "Post-construction" },
] as const

export type OneTimeJobKind = (typeof ONE_TIME_JOB_KINDS)[number]["key"]

/** When the invoice for a finished one-time job drafts itself. */
export const DRAFT_TIMINGS = ["SAME_DAY", "NEXT_DAY", "MANUAL"] as const
export type DraftTiming = (typeof DRAFT_TIMINGS)[number]

export const DRAFT_TIMING_LABELS: Record<DraftTiming, string> = {
  SAME_DAY: "Same day",
  NEXT_DAY: "Next day",
  MANUAL: "Manual",
}

/** Days the client gets to pay. 0 means due on receipt. */
export const ONE_TIME_TERM_DAYS = [0, 7, 15, 30] as const

export const ONE_TIME_TERM_LABELS: Record<number, string> = {
  0: "Due now",
  7: "Net 7",
  15: "Net 15",
  30: "Net 30",
}

export interface OneTimeJobDefault {
  when: DraftTiming
  termDays: number
}

export type OneTimeJobDefaults = Record<OneTimeJobKind, OneTimeJobDefault>

// Residential one-time work is usually paid on the spot; commercial and
// post-construction go through someone's accounts payable.
export const DEFAULT_ONE_TIME_JOB_DEFAULTS: OneTimeJobDefaults = {
  residential: { when: "SAME_DAY", termDays: 0 },
  commercial: { when: "SAME_DAY", termDays: 15 },
  postConstruction: { when: "SAME_DAY", termDays: 15 },
}

export function normalizeOneTimeJobDefaults(raw: unknown): OneTimeJobDefaults {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out = {} as OneTimeJobDefaults
  for (const { key } of ONE_TIME_JOB_KINDS) {
    const fallback = DEFAULT_ONE_TIME_JOB_DEFAULTS[key]
    const entry = (source[key] && typeof source[key] === "object" ? source[key] : {}) as Record<string, unknown>
    const when = DRAFT_TIMINGS.includes(entry.when as DraftTiming) ? (entry.when as DraftTiming) : fallback.when
    const termDays = ONE_TIME_TERM_DAYS.includes(entry.termDays as never)
      ? (entry.termDays as number)
      : fallback.termDays
    out[key] = { when, termDays }
  }
  return out
}

// ── Invoice footer templates ─────────────────────────────────────────────────

/** Same keys as the client's pay method, so a client's footer follows it. */
export const FOOTER_METHODS = ["ZELLE", "ACH", "PORTAL", "CHECK"] as const
export type FooterMethod = (typeof FOOTER_METHODS)[number]

export type InvoiceFooterTemplates = Record<FooterMethod, string>

export const DEFAULT_FOOTER_TEMPLATES: InvoiceFooterTemplates = {
  ZELLE: 'Pay by Zelle: admin@thecleanfreaks.co · shows up as "Shiloh Pro Cleaning Services". Thank you!',
  ACH: "Pay by ACH (1% fee) or card / PayPal / Venmo (3.5% fee) · payment link is in the email. Thank you!",
  PORTAL: "No payment info printed · this client pays through their own system (Melio, AP portal).",
  CHECK: "Mail checks to The Clean Freaks · 1240 Abbot Kinney Blvd, Venice, CA 90291. Thank you!",
}

export function normalizeFooterTemplates(raw: unknown): InvoiceFooterTemplates {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out = {} as InvoiceFooterTemplates
  for (const method of FOOTER_METHODS) {
    const value = source[method]
    out[method] = typeof value === "string" ? value : DEFAULT_FOOTER_TEMPLATES[method]
  }
  return out
}

/**
 * The footer for one invoice. Falls back to the single all-invoices note when
 * the client has no pay method on file — printing another method's payment
 * instructions would be worse than printing the generic note.
 */
export function resolveInvoiceFooter(
  templates: InvoiceFooterTemplates,
  payMethod: string | null | undefined,
  fallbackNote: string | null,
): string | null {
  const key = (payMethod || "").trim().toUpperCase()
  if ((FOOTER_METHODS as readonly string[]).includes(key)) {
    return templates[key as FooterMethod]?.trim() || fallbackNote
  }
  return fallbackNote
}

// ── Reminder templates ───────────────────────────────────────────────────────

/**
 * Exactly two, per the handoff: 14+ days late escalates to a phone call, which
 * is a script rather than an email and so is not editable here.
 */
export const REMINDER_SLOTS = [
  { key: "s1", label: "Reminder Email #1", when: "1 to 4 days late" },
  { key: "s2", label: "Reminder Email #2", when: "5 to 13 days late" },
] as const

export type ReminderSlot = (typeof REMINDER_SLOTS)[number]["key"]
export type ReminderTemplates = Record<ReminderSlot, string>

export function normalizeReminderTemplates(
  raw: unknown,
  defaults: ReminderTemplates,
): ReminderTemplates {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out = {} as ReminderTemplates
  for (const { key } of REMINDER_SLOTS) {
    const value = source[key]
    out[key] = typeof value === "string" && value.trim() ? value : defaults[key]
  }
  return out
}
