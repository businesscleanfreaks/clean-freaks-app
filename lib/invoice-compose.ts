/**
 * Compose window logic: the default email, and the pre-send safety net.
 *
 * Kept pure so it can be unit-tested, and so the window and its tests agree on
 * one definition of "what would actually go out".
 *
 * The safety net exists because the VA composes from a previous month's email
 * more often than from scratch: the two mistakes that survive a read-through
 * are a stale month name and another client's first name.
 */

export type ComposeMode = "send" | "resend"

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

/** Header and button copy for the window, per the mode it was opened in. */
export function composeCopy(mode: ComposeMode): { heading: string; sendLabel: string } {
  return mode === "resend"
    ? { heading: "Edit & resend", sendLabel: "Resend invoice" }
    : { heading: "New invoice", sendLabel: "Send invoice" }
}

/** Default subject when no template is configured (the handoff's wording). */
export const DEFAULT_SUBJECT = "Invoice {invoice_number} from The Clean Freaks"

// Deliberately permissive: this only decides whether to accept a typed chip,
// and refusing a valid-but-unusual address is worse than passing it to the
// server, which validates for real.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email.trim())

/** Splits a pasted or typed run of addresses on commas, semicolons and spaces. */
export function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map(s => s.trim().replace(/^<|>$/g, ""))
    .filter(Boolean)
}

/** Adds an address to a chip list, ignoring case-insensitive duplicates. */
export function addRecipient(list: string[], email: string): string[] {
  const v = email.trim()
  if (!v) return list
  return list.some(e => e.toLowerCase() === v.toLowerCase()) ? list : [...list, v]
}

export type WarningKind = "month" | "name"

export interface ComposeWarning {
  /** Stable within a render, so acknowledging one does not disturb the others. */
  id: string
  kind: WarningKind
  /** The text found in the email. */
  from: string
  /** What it should say. Only month warnings can be auto-corrected. */
  to?: string
  text: string
  fixLabel?: string
}

export interface PreflightInput {
  body: string
  subject?: string
  /** The month this invoice is for, e.g. "August". */
  monthLabel: string
  /** This client's billing contact first name, so their own name never flags. */
  contactFirstName?: string | null
  /** First names of other clients' contacts, to catch a copy-paste leftover. */
  otherFirstNames?: string[]
  /** Warnings the reviewer has already dismissed, by `from` value. */
  acknowledged?: string[]
}

// Case-sensitive and word-bounded on purpose: lowercase "may" and "march" are
// ordinary words, and only the capitalised form reads as a month.
const mentions = (text: string, word: string): boolean =>
  new RegExp(`(^|[^A-Za-z])${escapeRegExp(word)}([^A-Za-z]|$)`).test(text)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Everything worth a second look before this email goes out.
 *
 * Every warning is dismissable. A capitalised "May" that opens a sentence is a
 * false positive, and a check that can only be cleared by rewriting the
 * sentence would be worse than no check at all.
 */
export function preflight(input: PreflightInput): ComposeWarning[] {
  const { body, subject = "", monthLabel, contactFirstName, otherFirstNames = [], acknowledged = [] } = input
  const acked = new Set(acknowledged.map(a => a.toLowerCase()))
  const warnings: ComposeWarning[] = []

  for (const month of MONTH_NAMES) {
    if (month === monthLabel || acked.has(month.toLowerCase())) continue
    if (!mentions(body, month) && !mentions(subject, month)) continue
    warnings.push({
      id: `month:${month}`,
      kind: "month",
      from: month,
      to: monthLabel,
      text: `The email says "${month}" · this invoice is for ${monthLabel}.`,
      fixLabel: `Use ${monthLabel}`,
    })
  }

  const ours = (contactFirstName || "").trim().toLowerCase()
  const seen = new Set<string>()
  for (const raw of otherFirstNames) {
    const name = (raw || "").trim()
    const key = name.toLowerCase()
    // Two-letter names ("Jo", "Al") appear inside ordinary words too often to
    // be worth flagging.
    if (name.length < 3 || key === ours || seen.has(key) || acked.has(key)) continue
    if (!mentions(body, name)) continue
    seen.add(key)
    warnings.push({
      id: `name:${key}`,
      kind: "name",
      from: name,
      text: contactFirstName
        ? `This mentions "${name}," who isn't this client · did you mean ${contactFirstName}?`
        : `This mentions "${name}," who isn't this client.`,
    })
  }

  return warnings
}

/**
 * Applies a month warning's correction to the subject and body.
 * Name warnings carry no replacement: only the reviewer knows what was meant.
 */
export function applyWarningFix(
  warning: ComposeWarning,
  email: { subject: string; body: string },
): { subject: string; body: string } {
  if (warning.kind !== "month" || !warning.to) return email
  const swap = (text: string) =>
    text.replace(new RegExp(`(^|[^A-Za-z])${escapeRegExp(warning.from)}([^A-Za-z]|$)`, "g"), `$1${warning.to}$2`)
  return { subject: swap(email.subject), body: swap(email.body) }
}
