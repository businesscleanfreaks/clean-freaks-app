/**
 * Parse a Zelle / bank payment-notification email into structured payment data.
 *
 * ⚠️ TUNING REQUIRED: the patterns below are modelled on representative Chase /
 * Zelle notification formats. They MUST be validated and extended against 5–10
 * of Grace's REAL notification emails before this is trusted on live mail — bank
 * templates vary and change. The parser is pure and unit-tested so adding a new
 * format is a one-line regex + one test.
 *
 * Returns null for anything that doesn't look like a payment notification, so a
 * normal inbox message is simply ignored (this is NOT a general email parser).
 */

export interface ParsedZellePayment {
  senderName: string
  amount: number
  confirmationNumber: string | null
  sentAt: Date | null
}

// $1,234.56  /  $420.00  /  $5
const AMOUNT_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/

// Confirmation / reference number, e.g. "Confirmation number: BAC123XYZ"
const CONFIRMATION_RE =
  /(?:confirmation|reference|transaction)\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9]{6,})/i

// Sender-name patterns. The "from NAME" cases capture the full (possibly
// multi-word) name up to a delimiter — a period/comma/newline or " via Zelle" —
// rather than stopping at the first word boundary.
const SENDER_PATTERNS: RegExp[] = [
  // "You received $420.00 from SOUZI ZEROUNIAN [via Zelle]"
  /received\s+\$[0-9,]+(?:\.[0-9]{2})?\s+from\s+(.+?)(?:\s+via\b|[.,\n]|$)/i,
  // "SOUZI ZEROUNIAN sent you $420.00"
  /([A-Za-z][A-Za-z .,'\-]+?)\s+sent\s+you\b/i,
  // "from SOUZI ZEROUNIAN" (fallback, body)
  /\bfrom\s+(.+?)(?:\s+via\b|[.,\n]|$)/i,
]

const ZELLE_HINTS = /\bzelle\b|sent you|you received|payment|deposit/i

function parseAmount(text: string): number | null {
  const m = text.match(AMOUNT_RE)
  if (!m) return null
  const value = parseFloat(m[1].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseSender(text: string): string | null {
  for (const re of SENDER_PATTERNS) {
    const m = text.match(re)
    if (m && m[1]) {
      const name = m[1].replace(/\s+/g, ' ').trim()
      // Reject captures that swept up an amount or other non-name tokens.
      if (name.length >= 2 && !/[\d$]/.test(name)) return name
    }
  }
  return null
}

/**
 * @param subject email subject line
 * @param body   plain-text body (fall back to stripped HTML)
 */
export function parseZelleNotification(
  subject: string | null | undefined,
  body: string | null | undefined,
): ParsedZellePayment | null {
  const subj = subject || ''
  const text = `${subj}\n${body || ''}`

  // Must look like a payment notification at all.
  if (!ZELLE_HINTS.test(text)) return null

  const amount = parseAmount(subj) ?? parseAmount(text)
  if (amount === null) return null

  const senderName = parseSender(subj) ?? parseSender(text)
  if (!senderName) return null

  const confMatch = text.match(CONFIRMATION_RE)
  const confirmationNumber = confMatch ? confMatch[1] : null

  return { senderName, amount, confirmationNumber, sentAt: null }
}
