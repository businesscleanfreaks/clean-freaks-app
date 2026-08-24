/**
 * The large-payout brake.
 *
 * Cleaners are normally paid on their cadence whether or not the client has
 * settled — the business floats the gap. That is affordable on ordinary
 * amounts and not on large ones, so past a threshold the rule inverts and the
 * payout waits for the client's money to arrive.
 *
 * The threshold applies per client account, not to everything a cleaner is
 * owed at once: the gate is "after the client pays us", which only means
 * something when it is one identifiable client's invoice being waited on.
 */

/**
 * Above this, a cleaner's account for one client waits for that client to pay.
 * Josh's rule, 2026-08-24. Change it here — it is deliberately one constant
 * rather than a per-payee override, because it is a business-wide risk limit.
 */
export const LARGE_PAYOUT_THRESHOLD = 2600

export interface ThresholdInput {
  /** What this cleaner is owed for this client, in dollars. */
  owed: number
  /** True when every client invoice covering this account is settled. */
  clientHasPaid: boolean
}

export type ThresholdResult =
  | { held: false }
  | { held: true; reason: string }

/**
 * Whether a large balance holds this account back.
 *
 * Strictly greater than the threshold — Josh said "over $2,600", so a payout
 * landing exactly on it is still paid on the normal cadence.
 */
export function applyLargePayoutHold(input: ThresholdInput): ThresholdResult {
  if (input.owed <= LARGE_PAYOUT_THRESHOLD) return { held: false }
  if (input.clientHasPaid) return { held: false }
  return {
    held: true,
    reason: `Over $${LARGE_PAYOUT_THRESHOLD.toLocaleString()} · waiting on the client to pay`,
  }
}
