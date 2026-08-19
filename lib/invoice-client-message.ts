/**
 * The message the client actually receives with their invoice.
 *
 * The design fixes this copy, including the Zelle paragraph — which appears
 * ONLY for clients who pay by Zelle, because telling an ACH or portal client to
 * Zelle us is worse than saying nothing.
 *
 * Copy rules from the handoff: plain and friendly, no jargon, "·" separators,
 * and no em dashes anywhere in client-facing text.
 */

export interface ClientMessageVars {
  /** Billing contact's first name; falls back to the client name. */
  firstName: string
  /** e.g. "June" */
  month: string
  /** ZELLE | ACH | PORTAL | CHECK | null */
  payMethod: string | null
  /** Where Zelle payments go. */
  zelleEmail: string
}

/** First name from a contact name, or a sensible fallback. */
export function firstNameOf(contactName: string | null | undefined, fallback: string): string {
  const trimmed = (contactName || "").trim()
  if (!trimmed) return fallback
  return trimmed.split(/\s+/)[0]
}

/**
 * How this client pays us, from the two fields the app has accumulated:
 * `payMethod` (enum codes, set by the billing schedule sheet) and the older
 * `preferredPaymentMethod` (free text like "Zelle" or "Direct Deposit
 * (Client-Controlled)", which is where the real data still lives). "TBD" is a
 * placeholder the office types, not an answer, so it reads as unset.
 */
export function resolvePayMethod(
  payMethod: string | null | undefined,
  preferredPaymentMethod: string | null | undefined,
): string | null {
  const raw = (payMethod || preferredPaymentMethod || "").trim()
  if (!raw || /^tbd$/i.test(raw)) return null
  return raw
}

/**
 * Matched loosely on purpose: the same method is stored as "ZELLE" in one field
 * and "Zelle" in the other, and getting this wrong drops the payment
 * instructions from the email of a client who pays by Zelle.
 */
export const paysByZelle = (payMethod: string | null | undefined) => /zelle/i.test(payMethod || "")

const METHOD_LABELS: Record<string, string> = {
  ZELLE: "Zelle",
  ACH: "ACH",
  PORTAL: "the client portal",
  CHECK: "check",
  DIRECT_DEPOSIT: "direct deposit",
  OTHER: "another method",
}

/** Readable form of a stored method, whichever field it came from. */
export function payMethodLabel(payMethod: string): string {
  return METHOD_LABELS[payMethod] ?? payMethod
}

/**
 * Builds the default message. Kept as one function so the preview pane and the
 * compose window can never drift apart on what the client is told.
 */
export function buildClientMessage(vars: ClientMessageVars): string {
  const lines: string[] = [
    `Hi ${vars.firstName},`,
    "",
    `Your invoice for ${vars.month} cleaning services is attached below.`,
    "",
  ]

  if (paysByZelle(vars.payMethod)) {
    lines.push(
      `Payment can be made via Zelle to ${vars.zelleEmail} (please note the address ends in "co," not "com").`,
      "",
    )
  }

  lines.push(
    "Questions about this invoice? Reply to this email and we'll be happy to assist.",
    "",
    "Thank you for your business!",
    "",
    "The Clean Freaks",
  )

  return lines.join("\n")
}
