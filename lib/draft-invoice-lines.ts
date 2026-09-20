/**
 * What a job edit should do to the draft invoice lines that bill for it.
 *
 * The job route refreshed draft lines whenever the rate, the date, the start
 * time, or either end of the arrival window changed · and the refresh wrote
 * `amount: updatedJob.clientRate` and a generic "Cleaning - <client> - <date>"
 * description to EVERY draft line carrying that job id:
 *
 *     for (const item of draftLineItems) {
 *       await tx.invoiceLineItem.update({
 *         where: { id: item.id },
 *         data: { amount: updatedJob.clientRate ?? item.amount, description: ... },
 *       })
 *     }
 *
 * Two things follow from that. A job with a $100 cleaning line and a $25 add-on
 * line became $100 and $100, so a $125 invoice became $200 · and it happened on
 * a TIME-only edit, where no money should move at all. Any custom wording on a
 * line was overwritten at the same time.
 *
 * The rule here is narrow on purpose:
 *
 *   - an add-on line is never touched by a job edit. Its money belongs to the
 *     add-on, and `addOnServiceId` already tells the two apart;
 *   - the base cleaning line follows the rate ONLY when the rate changed;
 *   - description and service date follow the DATE, because that is what they
 *     describe;
 *   - a time-only edit changes nothing.
 *
 * Pure: no Prisma, no clock.
 */

/** A draft line as the route reads it. */
export interface DraftLine {
  id: string
  /** Set when this line bills an add-on rather than the clean itself. */
  addOnServiceId: string | null
  amount: number
  description: string
}

/** The job after the edit. */
export interface EditedJob {
  clientRate: number | null
  date: Date
  clientName: string
  /**
   * The client is billed a flat monthly amount for this schedule.
   *
   * Then the draft carries ONE "Monthly Cleaning · <location> · <month>" line
   * for the whole month, priced from the schedule's monthly rate, and it is
   * attached to the first clean of the month · so it has a jobId and no
   * addOnServiceId, exactly like a per-clean line. Nothing about one clean
   * should move it: not its rate, which is not what the client is charged, and
   * not its day, which is not what the line is for. Rewriting it replaced the
   * month's line with a single clean's.
   */
  billsMonthly: boolean
}

/** Which of the job's billable facts actually changed. */
export interface JobEdit {
  rate: boolean
  date: boolean
}

/** A line to write, carrying only the fields that should move. */
export interface DraftLineUpdate {
  id: string
  amount?: number
  description?: string
  serviceDate?: Date
}

/** "Cleaning - Bigco Offices - Sep 2, 2026", the wording invoices already use. */
export function cleaningLineDescription(job: EditedJob): string {
  const when = job.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  return `Cleaning - ${job.clientName} - ${when}`
}

/**
 * The updates a job edit should make to its draft lines.
 *
 * Returns nothing at all for an edit that changed neither the rate nor the day,
 * which is what a time-only edit is.
 */
export function draftLineUpdates(
  lines: readonly DraftLine[],
  job: EditedJob,
  edit: JobEdit,
): DraftLineUpdate[] {
  if (!edit.rate && !edit.date) return []

  // A flat-rate month's line belongs to the month, not to any one clean in it.
  if (job.billsMonthly) return []

  const updates: DraftLineUpdate[] = []

  for (const line of lines) {
    // An add-on has its own price and its own words. A change to the clean it
    // sits on says nothing about either.
    if (line.addOnServiceId !== null) continue

    const update: DraftLineUpdate = { id: line.id }
    if (edit.rate && job.clientRate !== null) update.amount = job.clientRate
    if (edit.date) {
      update.description = cleaningLineDescription(job)
      // The line said which day it was for and then kept saying the old one.
      update.serviceDate = job.date
    }

    // Only when something actually moves.
    if (update.amount !== undefined || update.description !== undefined) {
      updates.push(update)
    }
  }

  return updates
}
