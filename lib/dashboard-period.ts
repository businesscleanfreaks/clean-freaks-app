/**
 * What a past month actually earned, from the work that actually happened.
 *
 * The dashboard fetched a past month's completed jobs and then calculated the
 * period figures INSIDE a loop over `avgSchedules` · the schedules whose
 * lifecycle is "current" as of today. Anything the loop never visited was
 * fetched and silently dropped:
 *
 *   - work on a schedule that has since ended contributed nothing, so starting
 *     a new agreement in September zeroed out August's revenue;
 *   - a client with no active recurring schedule returned `null` before its
 *     one-off work was ever looked at, so one-off-only accounts vanished;
 *   - the client query and the job query both filter `isActive: true`, so
 *     deactivating an account erased its history from every past month.
 *
 * A past month is a fact. It must be computed from that month's jobs and the
 * rates those jobs carry, and must not move because something changed later.
 * Today's schedules are a separate question, answered separately.
 *
 * Pure: no Prisma, no clock.
 */

/** A completed job in the period, with the rates it was actually done at. */
export interface PeriodJob {
  id: string
  clientId: string
  /** Null for one-off work. */
  scheduleId: string | null
  clientRate: number
  subcontractorRate: number
  /** How the CLIENT was billed for this schedule. Null means per clean. */
  clientPayType: string | null
  /** How the CLEANER was paid for this schedule. Null means per clean. */
  subcontractorPayType: string | null
  /** Recurring add-ons on the schedule, charged once for the month. */
  recurringAddOns: readonly { clientRate: number; subcontractorRate: number }[]
  /** Add-ons on this particular clean. */
  jobAddOns: readonly { clientRate: number; subcontractorRate: number }[]
}

export interface PeriodTotals {
  revenue: number
  cleanerCost: number
  jobCount: number
}

const empty = (): PeriodTotals => ({ revenue: 0, cleanerCost: 0, jobCount: 0 })
const round = (n: number) => Math.round(n * 100) / 100

/**
 * The period figures for each client, keyed by client id.
 *
 * Flat-rate work counts its rate once per schedule for the month, however many
 * cleans happened; per-clean work counts every clean. One-off work is per job.
 * Grouping is by the SCHEDULE THE JOB WAS ON, taken from the job itself, so a
 * schedule that has since ended still contributes the month it worked.
 */
export function periodTotalsByClient(jobs: readonly PeriodJob[]): Map<string, PeriodTotals> {
  const byClient = new Map<string, PeriodTotals>()
  const bySchedule = new Map<string, PeriodJob[]>()
  const oneOffs: PeriodJob[] = []

  for (const job of jobs) {
    if (job.scheduleId === null) {
      oneOffs.push(job)
      continue
    }
    const key = `${job.clientId}|${job.scheduleId}`
    bySchedule.set(key, [...(bySchedule.get(key) ?? []), job])
  }

  const add = (clientId: string, revenue: number, cleanerCost: number, jobCount: number) => {
    const totals = byClient.get(clientId) ?? empty()
    totals.revenue = round(totals.revenue + revenue)
    totals.cleanerCost = round(totals.cleanerCost + cleanerCost)
    totals.jobCount += jobCount
    byClient.set(clientId, totals)
  }

  for (const group of bySchedule.values()) {
    const first = group[0]

    const revenue = first.clientPayType === "FLAT_RATE"
      ? first.clientRate
      : group.reduce((sum, j) => sum + j.clientRate, 0)

    const cleanerCost = first.subcontractorPayType === "FLAT_RATE"
      ? first.subcontractorRate
      : group.reduce((sum, j) => sum + j.subcontractorRate, 0)

    // A recurring add-on is a monthly arrangement, so it counts once for the
    // month the schedule worked, not once per clean.
    const recurringRevenue = first.recurringAddOns.reduce((sum, a) => sum + a.clientRate, 0)
    const recurringCost = first.recurringAddOns.reduce((sum, a) => sum + a.subcontractorRate, 0)

    const jobAddOnRevenue = group.reduce(
      (sum, j) => sum + j.jobAddOns.reduce((s, a) => s + a.clientRate, 0), 0)
    const jobAddOnCost = group.reduce(
      (sum, j) => sum + j.jobAddOns.reduce((s, a) => s + a.subcontractorRate, 0), 0)

    add(
      first.clientId,
      revenue + recurringRevenue + jobAddOnRevenue,
      cleanerCost + recurringCost + jobAddOnCost,
      group.length,
    )
  }

  for (const job of oneOffs) {
    const revenue = job.clientRate + job.jobAddOns.reduce((s, a) => s + a.clientRate, 0)
    const cost = job.subcontractorRate + job.jobAddOns.reduce((s, a) => s + a.subcontractorRate, 0)
    add(job.clientId, revenue, cost, 1)
  }

  return byClient
}

/** The figures for one client, or zeroes when they did no work that month. */
export function totalsFor(
  byClient: ReadonlyMap<string, PeriodTotals>,
  clientId: string,
): PeriodTotals {
  return byClient.get(clientId) ?? empty()
}

/**
 * Whether a month's figures are recorded work or a forecast.
 *
 * The screen labelled every month "<month> actuals" and showed Net Profit under
 * it, including for months that had not happened yet · where the figures come
 * from projecting the schedule calendar and no completed job is read at all.
 * A forecast presented as realised profit is the part worth fixing; the
 * forecast itself is reasonable.
 */
export type PeriodBasis = "actual" | "projected"

export function periodBasis(isPastMonth: boolean): PeriodBasis {
  return isPastMonth ? "actual" : "projected"
}

/** The heading for the figures, matching what they actually are. */
export function periodHeading(monthLabel: string, basis: PeriodBasis): string {
  return basis === "actual" ? `${monthLabel} actuals` : `${monthLabel} forecast`
}
