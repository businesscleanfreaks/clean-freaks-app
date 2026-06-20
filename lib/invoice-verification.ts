/**
 * Auto-derived "is this safe to send?" verification for the invoicing workspace.
 *
 * Green  = nothing changed this month (flat rate as usual, or per-clean with the
 *          expected cleans and no adjustments).
 * Yellow = something needs a glance before sending — a skipped/rescheduled clean,
 *          a price change, an add-on, a one-off job, or a missing email.
 *
 * Derived purely from the candidate fields the API already computes (exceptions +
 * counts), so there are no extra queries.
 */

export type VerificationLevel = 'green' | 'yellow'

export interface InvoiceVerification {
  level: VerificationLevel
  summary: string // 2–3 words / one short sentence, shown in the banner
  detail?: string // longer explanation, shown when expanded
}

export interface VerifiableCandidate {
  billingType: string
  status: string // READY | NEEDS_ATTENTION | DRAFT_EXISTS | SENT | PAID
  jobCount: number
  completedCount: number
  exceptions: Array<{ type: string; message: string }>
}

// Exception types that warrant a "yellow" heads-up before sending.
const ATTENTION_TYPES = new Set([
  'SKIPPED',
  'RESCHEDULED',
  'ONE_TIME_ADD_ON',
  'PRICE_CHANGE',
  'ONE_OFF_JOB',
  'EXTRA_CLEAN',
  'MISSING_EMAIL',
])

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function deriveVerification(candidate: VerifiableCandidate): InvoiceVerification {
  const allExceptions = Array.isArray(candidate.exceptions) ? candidate.exceptions : []
  const attention = allExceptions.filter((e) => ATTENTION_TYPES.has(e.type))
  const hasMissingEmail = attention.some((e) => e.type === 'MISSING_EMAIL')

  // ── Green: nothing to flag ──
  if (attention.length === 0) {
    if (candidate.billingType === 'PER_CLEAN') {
      const cleans = candidate.completedCount || candidate.jobCount
      return { level: 'green', summary: `Verified · ${plural(cleans, 'clean')}, no changes.` }
    }
    return { level: 'green', summary: 'Verified · flat rate, no changes.' }
  }

  // ── Yellow: summarise what changed ──
  const counts: Record<string, number> = {}
  for (const e of attention) counts[e.type] = (counts[e.type] || 0) + 1

  const parts: string[] = []
  if (counts.SKIPPED) parts.push(`${plural(counts.SKIPPED, 'clean')} skipped`)
  if (counts.RESCHEDULED) parts.push(`${plural(counts.RESCHEDULED, 'clean')} rescheduled`)
  if (counts.PRICE_CHANGE) parts.push(`${plural(counts.PRICE_CHANGE, 'price change')}`)
  if (counts.ONE_TIME_ADD_ON) parts.push(`${plural(counts.ONE_TIME_ADD_ON, 'add-on')}`)
  if (counts.ONE_OFF_JOB) parts.push(`${plural(counts.ONE_OFF_JOB, 'one-off job')}`)
  if (counts.EXTRA_CLEAN) parts.push(`${plural(counts.EXTRA_CLEAN, 'extra clean')}`)

  const summary =
    parts.length === 0 && hasMissingEmail
      ? 'No email on file — add one before sending.'
      : `Heads up · ${parts.join(', ')}${hasMissingEmail ? ' · no email on file' : ''}.`

  const detail = attention.map((e) => e.message).join(' · ')
  return { level: 'yellow', summary, detail }
}
