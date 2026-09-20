/**
 * Whether "apply to future cleans" can safely carry a change forward.
 *
 * The route writes the new values onto every clean from this one onward, and
 * ALSO onto the schedule's defaults so later-generated cleans inherit them.
 * For most changes that is exactly right: each clean carries its own rate, past
 * months were invoiced from the rates their own cleans held, and moving the
 * schedule default only affects cleans not yet created.
 *
 * One case is not like that. When the client is billed a flat MONTHLY amount,
 * the invoice does not read the cleans at all · the monthly line is priced from
 * `schedule.defaultClientRate`, for whatever month is being reviewed. Moving
 * that default therefore re-prices every month that has not been sent yet,
 * including months whose work is long finished. A clean in September could
 * change what July is about to be billed.
 *
 * There is no "forward only" version of a value the whole history reads. The
 * operation that does this correctly already exists: changing the schedule
 * going forward ends the current agreement and starts a new one at the new
 * rate, so each month is priced by the agreement that was in force. So this
 * refuses and says where to go, rather than guessing at a mid-month policy
 * nobody has decided.
 *
 * Changing WHO does the work, or what the CLEANER is paid, still carries
 * forward normally: cleaner payouts are computed from each clean's own rate, so
 * moving the schedule default cannot reach a month that has already happened.
 *
 * Pure: no Prisma, no clock.
 */

export interface RateForwardIntent {
  /** The client is billed one flat monthly amount for this schedule. */
  billsMonthly: boolean
  /** The change includes a new client rate. */
  changesClientRate: boolean
}

export interface RateForwardRefusal {
  code: "FLAT_RATE_NEEDS_SCHEDULE_CHANGE"
  message: string
}

/**
 * Null when the change may be applied forward, or the reason it may not.
 */
export function rateForwardRefusal(intent: RateForwardIntent): RateForwardRefusal | null {
  if (!intent.billsMonthly || !intent.changesClientRate) return null

  return {
    code: "FLAT_RATE_NEEDS_SCHEDULE_CHANGE",
    message:
      "This client pays a flat monthly rate, so the monthly amount is read from the schedule for every month · " +
      "changing it here would also re-price months that have not been sent yet. " +
      "Use the schedule's 'change going forward' instead, which ends the current rate and starts the new one from a date you choose.",
  }
}
