/**
 * Which cleans a finalized invoice has actually billed for.
 *
 * Finalizing marks work `invoiced: true` so it stops showing as billable. The
 * route worked out that set as: every job with a line item, PLUS every
 * non-cancelled job on any schedule-month the invoice touched.
 *
 * That second half exists for a real reason. A flat-rate month carries ONE
 * "Monthly Cleaning" line for the whole month, so the other cleans in it have
 * no line of their own and would otherwise come back as unbilled. But it was
 * applied to every schedule, including per-clean ones · and there the cleans
 * without a line item are exactly the ones the reviewer took OFF the invoice,
 * or extra visits that were never on it. Marking those invoiced stamped them
 * billed with nothing billing them, and they never returned to the queue.
 *
 * That is money not charged, and silent: nothing looks wrong afterwards, the
 * work simply stops appearing.
 *
 * So the sweep is kept where it is correct and removed where it is not:
 *
 *   - a clean with a line item on this invoice is billed;
 *   - a schedule-month billed as ONE monthly amount has all of its cleans
 *     billed, line item or not;
 *   - a per-clean schedule bills exactly the cleans that have line items.
 *
 * Pure: no Prisma, no clock.
 */

/** A line item, as finalize reads it. */
export interface FinalizeLine {
  jobId: string | null
  job: {
    id: string
    scheduleId: string | null
    date: Date
    /**
     * The client is billed one monthly amount for this schedule, so this
     * invoice's single line covers every clean in the month.
     */
    billsMonthly: boolean
  } | null
}

/** A month of one schedule, billed as a whole. */
export interface ScheduleMonth {
  scheduleId: string
  monthStart: Date
  monthEnd: Date
}

export interface FinalizeTargets {
  /** Cleans that carry a line item on this invoice. */
  jobIds: string[]
  /**
   * Schedule-months billed as a single amount. Every non-cancelled clean in
   * one of these is covered, whether or not it has a line of its own.
   */
  scheduleMonths: ScheduleMonth[]
}

/**
 * The month containing a service day, in UTC.
 *
 * Service days are stored at noon UTC. Taking month boundaries from local
 * getters puts a clean near either end of the month into the wrong month's
 * sweep wherever the server does not run in UTC.
 */
export function utcMonthRange(date: Date): { monthStart: Date; monthEnd: Date } {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  return {
    monthStart: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    monthEnd: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  }
}

export function finalizeTargets(lines: readonly FinalizeLine[]): FinalizeTargets {
  const jobIds = new Set<string>()
  const scheduleMonths = new Map<string, ScheduleMonth>()

  for (const line of lines) {
    if (line.jobId) jobIds.add(line.jobId)

    const job = line.job
    if (!job || !job.scheduleId) continue

    // Only a month billed as one amount sweeps up its other cleans. A per-clean
    // schedule bills the cleans it has lines for, and nothing else.
    if (!job.billsMonthly) continue

    const { monthStart, monthEnd } = utcMonthRange(new Date(job.date))
    scheduleMonths.set(`${job.scheduleId}:${monthStart.toISOString()}`, {
      scheduleId: job.scheduleId,
      monthStart,
      monthEnd,
    })
  }

  return { jobIds: [...jobIds], scheduleMonths: [...scheduleMonths.values()] }
}
