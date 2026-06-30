/**
 * Parse a Chase Zelle payment-notification email into structured payment data.
 *
 * Tuned to the real Chase Zelle format (validated against live samples 2026-06-30):
 *
 *   RAJIV MENON CONTEMPORARY LLC sent you money
 *   Here are the details:
 *   Amount $950.00
 *   Sent on Jun 29, 2026
 *   Transaction number 29805205224
 *   Memo INVOICE 180626-002 ...
 *
 * The payer is on the "<NAME> sent you money" line, the amount on its own
 * "Amount $…" line, and the transaction number is the idempotency key. The memo
 * frequently names the client or invoice, so we keep it for the human reviewer.
 *
 * Returns null for anything that isn't a payment notification, so ordinary inbox
 * mail is ignored (this is NOT a general email parser). Other banks' formats can
 * be added as extra patterns + tests.
 */

export interface ParsedZellePayment {
  senderName: string
  amount: number
  confirmationNumber: string | null
  memo: string | null
  sentAt: Date | null
}

const ZELLE_HINTS = /\bzelle\b|sent you money|sent you|you received|payment/i

// "Amount $950.00" / "$1,104.00"  (fall back to any $-amount)
const AMOUNT_LINE = /amount\s*\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/i
const AMOUNT_ANY = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/

// Payer name. Chase leads with "<NAME> sent you money".
const SENDER_PATTERNS: RegExp[] = [
  /^\s*(.+?)\s+sent you money\b/im,
  // "You received $420.00 from NAME [via Zelle]" (other banks)
  /received\s+\$[0-9,]+(?:\.[0-9]{2})?\s+from\s+(.+?)(?:\s+via\b|[.,\n]|$)/i,
  /(.+?)\s+sent\s+you\b/i,
]

// "Transaction number 29805205224" (fall back to confirmation/reference number)
const TXN_PATTERNS: RegExp[] = [
  /transaction\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9]{6,})/i,
  /(?:confirmation|reference)\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9]{6,})/i,
]

// "Memo Clarmeya 6-29"
const MEMO_RE = /^\s*memo\s+(.+?)\s*$/im
// "Sent on Jun 29, 2026"
const SENT_ON_RE = /sent on\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i

function parseAmount(text: string): number | null {
  const m = text.match(AMOUNT_LINE) || text.match(AMOUNT_ANY)
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

function parseMemo(text: string): string | null {
  const m = text.match(MEMO_RE)
  if (!m) return null
  const memo = m[1].trim()
  if (!memo || /^n\/?a$/i.test(memo)) return null
  return memo
}

function parseSentAt(text: string): Date | null {
  const m = text.match(SENT_ON_RE)
  if (!m) return null
  const d = new Date(m[1])
  return Number.isNaN(d.getTime()) ? null : d
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

  if (!ZELLE_HINTS.test(text)) return null

  const amount = parseAmount(text)
  if (amount === null) return null

  const senderName = parseSender(text)
  if (!senderName) return null

  let confirmationNumber: string | null = null
  for (const re of TXN_PATTERNS) {
    const m = text.match(re)
    if (m && m[1]) { confirmationNumber = m[1]; break }
  }

  return {
    senderName,
    amount,
    confirmationNumber,
    memo: parseMemo(text),
    sentAt: parseSentAt(text),
  }
}
