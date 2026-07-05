import { parseZelleNotification } from '@/lib/zelle-parse'

export interface ParsedPaymentNotification {
  source: 'ZELLE' | 'QUICKBOOKS' | 'SQUARE' | 'STRIPE' | 'PAYPAL' | 'PROCESSOR'
  senderName: string
  amount: number
  confirmationNumber: string | null
  memo: string | null
  sentAt: Date | null
}

const PROCESSOR_HINTS =
  /\b(quickbooks|intuit|square|stripe|paypal|merchant services|card payment|credit card|invoice paid|payment received|paid your invoice|you got paid)\b/i

const SOURCE_PATTERNS: Array<[ParsedPaymentNotification['source'], RegExp]> = [
  ['QUICKBOOKS', /\b(quickbooks|intuit)\b/i],
  ['SQUARE', /\bsquare\b/i],
  ['STRIPE', /\bstripe\b/i],
  ['PAYPAL', /\bpaypal\b/i],
]

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:payment amount|amount paid|amount received|gross amount|total paid|total|amount)\s*[:\-]?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i,
  /(?:paid|received|deposit(?:ed)?)\s+\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i,
  /\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/,
]

const SENDER_PATTERNS: RegExp[] = [
  /(?:payment received|you got paid)\s+from\s+(.+?)(?:\s+for\b|[.\n]|$)/i,
  /(?:customer|client|payer|paid by|from)\s*[:\-]\s*(.+?)\s*$/im,
  /^(.+?)\s+(?:paid|has paid)\s+(?:invoice|you)\b/im,
  /(.+?)\s+paid\s+\$[0-9,]+(?:\.[0-9]{2})?/i,
]

const TXN_PATTERNS: RegExp[] = [
  /(?:transaction|reference|receipt|confirmation)\s*(?:id|number|no\.?|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i,
  /payment\s*(?:id|number|no\.?|#)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i,
  /\b(?:txn|tx)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i,
]

const MEMO_PATTERNS: RegExp[] = [
  /(?:invoice|memo|note|description)\s*(?:number|no\.?|#)?\s*[:#\-]?\s*(.+?)\s*$/im,
]

const DATE_PATTERNS: RegExp[] = [
  /(?:payment date|paid on|received on|sent on|date)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
  /(?:payment date|paid on|received on|sent on|date)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
]

function sourceFromText(text: string): ParsedPaymentNotification['source'] {
  for (const [source, pattern] of SOURCE_PATTERNS) {
    if (pattern.test(text)) return source
  }
  return 'PROCESSOR'
}

function parseAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const value = parseFloat(match[1].replace(/,/g, ''))
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function cleanSenderName(raw: string): string | null {
  const name = raw
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:for|on)\s+invoice\b.*$/i, '')
    .replace(/\s+\$[0-9,]+(?:\.[0-9]{2})?.*$/i, '')
    .trim()
  if (name.length < 2) return null
  if (/[$]/.test(name)) return null
  if (/^(quickbooks|intuit|square|stripe|paypal|payment|invoice|receipt)$/i.test(name)) return null
  return name
}

function parseSender(text: string): string | null {
  for (const pattern of SENDER_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const name = cleanSenderName(match[1])
    if (name) return name
  }
  return null
}

function parseTransactionId(text: string, source: ParsedPaymentNotification['source']): string | null {
  for (const pattern of TXN_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    return `${source}:${match[1].toUpperCase()}`
  }
  return null
}

function parseMemo(text: string): string | null {
  for (const pattern of MEMO_PATTERNS) {
    const match = text.match(pattern)
    const memo = match?.[1]?.replace(/\s+/g, ' ').trim()
    if (memo && !/^n\/?a$/i.test(memo) && !/^paid\b/i.test(memo)) return memo.slice(0, 120)
  }
  return null
}

function parseSentAt(text: string): Date | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const date = new Date(match[1])
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}

function parseProcessorNotification(
  subject: string | null | undefined,
  body: string | null | undefined,
): ParsedPaymentNotification | null {
  const text = `${subject || ''}\n${body || ''}`
  if (!PROCESSOR_HINTS.test(text)) return null

  const amount = parseAmount(text)
  if (amount === null) return null

  const senderName = parseSender(text)
  if (!senderName) return null

  const source = sourceFromText(text)
  return {
    source,
    senderName,
    amount,
    confirmationNumber: parseTransactionId(text, source),
    memo: parseMemo(text),
    sentAt: parseSentAt(text),
  }
}

export function parsePaymentNotification(
  subject: string | null | undefined,
  body: string | null | undefined,
): ParsedPaymentNotification | null {
  const zelle = parseZelleNotification(subject, body)
  if (zelle) return { source: 'ZELLE', ...zelle }
  return parseProcessorNotification(subject, body)
}

export function paymentSourceFromSnippet(
  snippet: string | null | undefined,
): ParsedPaymentNotification['source'] | null {
  const match = snippet?.match(/^Source:\s*(ZELLE|QUICKBOOKS|SQUARE|STRIPE|PAYPAL|PROCESSOR)\b/i)
  return (match?.[1]?.toUpperCase() as ParsedPaymentNotification['source'] | undefined) ?? null
}

export function paymentMethodFromSnippet(snippet: string | null | undefined): string {
  return paymentSourceFromSnippet(snippet) ?? 'ZELLE'
}

export function paymentSourceLabelFromSnippet(snippet: string | null | undefined): string {
  const source = paymentSourceFromSnippet(snippet)
  if (!source) return 'Zelle'
  if (source === 'QUICKBOOKS') return 'QuickBooks'
  if (source === 'PROCESSOR') return 'Processor'
  return source.charAt(0) + source.slice(1).toLowerCase()
}
