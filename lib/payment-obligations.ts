/**
 * What a cleaner payment actually settles.
 *
 * The app recorded cleaner pay as a boolean on each job plus a line item on one
 * arbitrary job, and re-derived what a payment covered by inference. Three
 * separate defects came out of that single gap:
 *
 *  - A flat monthly rate was added once PER REQUEST, not once per month. Paying
 *    two jobs from the same month in two selections recorded the full monthly
 *    amount twice.
 *  - Two simultaneous requests both read the jobs as unpaid and both wrote a
 *    payment, because nothing claimed the obligation.
 *  - Undo was asymmetric. A flat-rate payment wrote ONE line item, on the first
 *    job, while marking every selected job paid. Undoing through any other job
 *    found no line item, so the job became unpaid while the payment still
 *    claimed to cover it; undoing through the first job removed the money while
 *    the other jobs stayed marked paid.
 *
 * The fix is to name the thing being settled. A flat-rate schedule owes one
 * amount for one month however many cleans happened, so the obligation is the
 * schedule-month. Per-clean and one-off work owes per visit, so the obligation
 * is the job. Each obligation carries a stable key, and the database holds that
 * key unique · which is what makes paying twice and racing impossible rather
 * than merely unlikely.
 *
 * Pure: no Prisma, no clock.
 */

/** A job as the payment route reads it. */
export interface PayableJob {
  id: string
  date: Date | string
  scheduleId: string | null
  subcontractorRate: number
  clientId: string
  /** How the CLEANER is paid for this work. */
  subcontractorPayType: string | null
  /** Add-ons on this job that this cleaner should be credited for. */
  addOnTotal: number
}

/** The money owed for one covered clean. Line items are one per clean. */
export interface ObligationLine {
  jobId: string
  amount: number
}

export interface PaymentObligation {
  /**
   * Stable identity of what is being settled. Unique in the database, so the
   * same obligation cannot be paid twice however the request is shaped.
   */
  key: string
  kind: "SCHEDULE_MONTH" | "JOB"
  amount: number
  /** Every job this obligation covers · all of them get marked paid together. */
  jobIds: string[]
  /**
   * The amount attributed to each covered clean, summing to `amount`.
   *
   * One row per clean, so a payment lists the work it paid for: the payment
   * history counts these to show "N cleans", and it showed "1 clean" for a
   * fifteen-visit month because only the first job got a row. In a flat month
   * the monthly rate sits on the first clean and the others carry only their
   * own add-ons, so some rows are $0 · that clean is covered by the month
   * rather than billed separately.
   */
  lines: ObligationLine[]
  /** "yyyy-MM", for reporting and the invoice gate. */
  period: string
  scheduleId: string | null
  clientId: string
}

/** "yyyy-MM" in UTC, matching how job dates are stored (noon UTC). */
export function periodOf(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** The obligation key for a flat-rate schedule in a month. */
export function scheduleMonthKey(scheduleId: string, period: string): string {
  return `schedule:${scheduleId}:${period}`
}

/** The obligation key for a single clean. */
export function jobKey(jobId: string): string {
  return `job:${jobId}`
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Group jobs into the obligations a payment would settle.
 *
 * A flat-rate recurring schedule contributes its monthly rate ONCE per month,
 * plus any add-ons on the covered jobs. Everything else contributes per job.
 */
export function buildObligations(jobs: readonly PayableJob[]): PaymentObligation[] {
  const byScheduleMonth = new Map<string, PayableJob[]>()
  const perJob: PayableJob[] = []

  for (const job of jobs) {
    const isFlatRecurring = job.scheduleId !== null && job.subcontractorPayType === "FLAT_RATE"
    if (!isFlatRecurring) {
      perJob.push(job)
      continue
    }
    const key = scheduleMonthKey(job.scheduleId as string, periodOf(job.date))
    byScheduleMonth.set(key, [...(byScheduleMonth.get(key) ?? []), job])
  }

  const obligations: PaymentObligation[] = []

  for (const [key, group] of byScheduleMonth) {
    const first = group[0]
    // The monthly rate once, however many cleans are selected · it rides on the
    // first clean. Add-ons are extra work and are paid on top, per clean.
    const lines = group.map((job, index) => ({
      jobId: job.id,
      amount: round((index === 0 ? first.subcontractorRate : 0) + job.addOnTotal),
    }))
    obligations.push({
      key,
      kind: "SCHEDULE_MONTH",
      amount: totalOf(lines),
      jobIds: lines.map(l => l.jobId),
      lines,
      period: periodOf(first.date),
      scheduleId: first.scheduleId,
      clientId: first.clientId,
    })
  }

  for (const job of perJob) {
    const lines = [{ jobId: job.id, amount: round(job.subcontractorRate + job.addOnTotal) }]
    obligations.push({
      key: jobKey(job.id),
      kind: "JOB",
      amount: totalOf(lines),
      jobIds: [job.id],
      lines,
      period: periodOf(job.date),
      scheduleId: job.scheduleId,
      clientId: job.clientId,
    })
  }

  return obligations
}

const totalOf = (lines: readonly ObligationLine[]) =>
  round(lines.reduce((sum, l) => sum + l.amount, 0))

/** What the payment is worth in total. */
export function obligationsTotal(obligations: readonly PaymentObligation[]): number {
  return round(obligations.reduce((sum, o) => sum + o.amount, 0))
}

/** Every job the payment covers, so all of them are marked together. */
export function coveredJobIds(obligations: readonly PaymentObligation[]): string[] {
  return [...new Set(obligations.flatMap(o => o.jobIds))]
}

/** One line item per covered clean, across every obligation in the payment. */
export function obligationLines(obligations: readonly PaymentObligation[]): ObligationLine[] {
  return obligations.flatMap(o => o.lines)
}

/**
 * The obligation keys a set of jobs belongs to, for reversing a payment.
 *
 * Undo works on obligations, not on the jobs the operator happened to click.
 * Unmarking one clean of a flat-rate month while leaving the payment in place
 * is what produced a job that was unpaid and paid at the same time.
 */
export function obligationKeysForJobs(jobs: readonly PayableJob[]): string[] {
  return [...new Set(buildObligations(jobs).map(o => o.key))]
}

/**
 * Whether a payment line item belongs to an obligation being reversed.
 *
 * Undo names obligations, but the jobs to unmark live on the payment's line
 * items. A flat month claims every line item of that payment on that schedule
 * in that month; a per-clean obligation claims exactly its own clean.
 */
export function lineBelongsToObligation(
  obligation: { kind: string; obligationKey: string; scheduleId: string | null; period: string },
  line: { jobId: string; job: { date: Date | string; scheduleId: string | null } | null },
): boolean {
  if (obligation.kind === "JOB") return obligation.obligationKey === jobKey(line.jobId)
  if (!line.job) return false
  return (
    line.job.scheduleId !== null &&
    line.job.scheduleId === obligation.scheduleId &&
    periodOf(line.job.date) === obligation.period
  )
}
