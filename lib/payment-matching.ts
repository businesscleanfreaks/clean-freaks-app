/**
 * Pure matcher: given a detected payment, an alias map (payer name → client),
 * and the set of open invoices, suggest the invoice it most likely pays.
 *
 * Conservative by design — money moves on a Confirm, so we only mark HIGH when
 * we're sure (known payer + exactly one exact-amount open invoice for that
 * client). Everything ambiguous becomes REVIEW with a candidate list. v1 matches
 * on EXACT amount only (no fuzzy), so a coincidental amount can't auto-suggest a
 * wrong client.
 */

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'REVIEW'

export interface OpenInvoice {
  id: string
  clientId: string
  totalAmount: number
}

export interface PaymentToMatch {
  senderName: string
  amount: number
}

export interface MatchResult {
  suggestedInvoiceId: string | null
  confidence: MatchConfidence
  candidateInvoiceIds: string[]
  resolvedClientId: string | null
}

const CENTS = 0.005

/** Normalize a payer name for alias lookup: upper, collapse space, strip company suffixes/punctuation. */
export function normalizeSenderName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'\-]/g, ' ')
    .replace(/\b(LLC|INC|CORP|CO|LTD|LLP|COMPANY)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function amountMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < CENTS
}

export function scoreMatch(
  payment: PaymentToMatch,
  openInvoices: OpenInvoice[],
  aliasMap: Map<string, string>,
): MatchResult {
  const resolvedClientId = aliasMap.get(normalizeSenderName(payment.senderName)) ?? null
  const exactAmount = openInvoices.filter((inv) => amountMatches(inv.totalAmount, payment.amount))

  // Known payer → only consider that client's invoices.
  if (resolvedClientId) {
    const clientExact = exactAmount.filter((inv) => inv.clientId === resolvedClientId)
    if (clientExact.length === 1) {
      return {
        suggestedInvoiceId: clientExact[0].id,
        confidence: 'HIGH',
        candidateInvoiceIds: [clientExact[0].id],
        resolvedClientId,
      }
    }
    if (clientExact.length > 1) {
      return {
        suggestedInvoiceId: null,
        confidence: 'REVIEW',
        candidateInvoiceIds: clientExact.map((i) => i.id),
        resolvedClientId,
      }
    }
    // Known client but no exact-amount invoice — surface that client's open invoices to review.
    const clientOpen = openInvoices.filter((inv) => inv.clientId === resolvedClientId)
    return {
      suggestedInvoiceId: null,
      confidence: 'REVIEW',
      candidateInvoiceIds: clientOpen.map((i) => i.id),
      resolvedClientId,
    }
  }

  // Unknown payer → amount-only.
  if (exactAmount.length === 1) {
    return {
      suggestedInvoiceId: exactAmount[0].id,
      confidence: 'MEDIUM',
      candidateInvoiceIds: [exactAmount[0].id],
      resolvedClientId: null,
    }
  }
  return {
    suggestedInvoiceId: null,
    confidence: 'REVIEW',
    candidateInvoiceIds: exactAmount.map((i) => i.id),
    resolvedClientId: null,
  }
}
