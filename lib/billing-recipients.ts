/**
 * Who receives a client's invoice.
 *
 * The design puts the whole answer on one card: the first recipient is the
 * one addressed ("Hi {firstName}") and everyone after them is CC'd. That order
 * is the meaning, not decoration — swapping the first row changes who the
 * email greets, so it is stored rather than derived from names or dates.
 *
 * Recipients are contacts, per the handoff ("edits sync with the contact
 * record"): the same person the rest of the app knows, flagged as billing.
 */

/** Job titles the office actually uses. "Custom role" is free text. */
export const BILLING_ROLES = [
  "Owner / decision-maker",
  "Office manager",
  "Accounts payable",
  "Bookkeeper",
  "Property manager",
  "Executive assistant",
] as const

export interface BillingRecipient {
  id: string
  name: string
  email: string | null
  billingRole: string | null
  billingOrder: number | null
}

export type RecipientTag = "TO" | "CC"

/**
 * Sorted as the client will see them. Explicit order wins; anything without one
 * falls in behind, by name, so a contact promoted to recipient never silently
 * jumps to the front and steals the greeting.
 */
export function orderRecipients<T extends BillingRecipient>(recipients: T[]): T[] {
  return [...recipients].sort((a, b) => {
    const ao = a.billingOrder ?? Number.MAX_SAFE_INTEGER
    const bo = b.billingOrder ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return (a.name || "").localeCompare(b.name || "")
  })
}

/** First is addressed, the rest are copied. */
export function tagFor(index: number): RecipientTag {
  return index === 0 ? "TO" : "CC"
}

/** The greeting the invoice email will open with, from the first recipient. */
export function greetedFirstName(recipients: BillingRecipient[]): string | null {
  const first = orderRecipients(recipients)[0]
  if (!first) return null
  const name = (first.name || "").trim()
  return name ? name.split(/\s+/)[0] : null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface RecipientProblem {
  code: "NO_RECIPIENTS" | "MISSING_EMAIL" | "INVALID_EMAIL" | "DUPLICATE_EMAIL"
  message: string
}

/**
 * What would stop this list working as an address line. Returns every problem
 * rather than the first: the card shows them all at once so the office fixes
 * the card in one pass.
 */
export function validateRecipients(recipients: BillingRecipient[]): RecipientProblem[] {
  const problems: RecipientProblem[] = []
  if (recipients.length === 0) {
    return [{ code: "NO_RECIPIENTS", message: "Every client needs at least one invoice recipient." }]
  }

  const seen = new Set<string>()
  for (const r of recipients) {
    const email = (r.email || "").trim()
    const who = (r.name || "").trim() || "This recipient"
    if (!email) {
      problems.push({ code: "MISSING_EMAIL", message: `${who} has no email address.` })
      continue
    }
    if (!EMAIL_RE.test(email)) {
      problems.push({ code: "INVALID_EMAIL", message: `"${email}" is not an email address.` })
      continue
    }
    const key = email.toLowerCase()
    if (seen.has(key)) {
      problems.push({ code: "DUPLICATE_EMAIL", message: `${email} is on the list twice.` })
    }
    seen.add(key)
  }
  return problems
}

/**
 * Renumbers a list into a clean 0..n-1 order, which is what gets saved after a
 * reorder or a removal. Keeps the stored order free of gaps and ties so the
 * greeting never depends on a tiebreak.
 */
export function renumber<T extends BillingRecipient>(recipients: T[]): T[] {
  return recipients.map((r, i) => ({ ...r, billingOrder: i }))
}

/** Moves one recipient up or down, returning a renumbered list. */
export function moveRecipient<T extends BillingRecipient>(recipients: T[], id: string, delta: number): T[] {
  const ordered = orderRecipients(recipients)
  const from = ordered.findIndex(r => r.id === id)
  if (from < 0) return ordered
  const to = from + delta
  if (to < 0 || to >= ordered.length) return ordered
  const next = [...ordered]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return renumber(next)
}
