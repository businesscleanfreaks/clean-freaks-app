/**
 * Whether a job may be changed, whichever screen is asking.
 *
 * The individual job route refuses to reschedule or reprice work that is on a
 * sent invoice or already paid, and refuses to change who performed a job after
 * they have been paid for it. The bulk route checked that the jobs existed and
 * then called `updateMany`:
 *
 *     const result = await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: updateData })
 *
 * So the same change was refused one at a time and accepted in a batch. Ticking
 * several cleans and reassigning them moved work away from a cleaner who had
 * already been paid for it, and the payment stayed pointing at the job.
 *
 * The rules live here so both routes ask the same question. They are the
 * individual route's existing rules · this module moves them, it does not
 * tighten them, because a bulk action that is stricter than the single action
 * is its own kind of surprise.
 *
 * Pure: no Prisma, no clock.
 */

import { hasFinalInvoice, type InvoiceLineItemLike } from "./invoice-status"

/** A job's current state, as both routes can read it. */
export interface GuardedJob {
  id: string
  status: string
  scheduleId: string | null
  subcontractorPaid: boolean
  vendorPaid: boolean
  invoiceLineItems: InvoiceLineItemLike[]
}

/** What the caller is trying to change. */
export interface JobChangeIntent {
  /** Date, either rate, or the location · the "reschedule or reprice" family. */
  reschedulesOrReprices?: boolean
  /** Who performed the work. */
  changesWorker?: boolean
  /** Assigning a vendor, which one-off work only. */
  assignsVendor?: boolean
}

/** Why a change is refused, in the words the route should return. */
export function jobChangeBlockedReason(
  job: GuardedJob,
  intent: JobChangeIntent,
): string | null {
  if (intent.reschedulesOrReprices) {
    if (hasFinalInvoice(job.invoiceLineItems)) {
      return "Cannot reschedule or modify a job that is on a sent or paid invoice. Void or reset the invoice first."
    }
    if (job.subcontractorPaid) {
      return "Cannot reschedule or modify a job that has been paid. Please void the payment first."
    }
    if (job.vendorPaid) {
      return "Cannot reschedule or modify a job that has been paid to a vendor. Please void the vendor payment first."
    }
    if (job.status === "CANCELLED") {
      return "Cannot reschedule or modify a cancelled job. Please change status to SCHEDULED first."
    }
  }

  if (intent.changesWorker && (job.subcontractorPaid || job.vendorPaid)) {
    return "Cannot change who performed a job after it has been paid. Please void the payment first."
  }

  if (intent.assignsVendor && job.scheduleId) {
    return "Vendor-performed jobs must be standalone one-off jobs."
  }

  return null
}

/** One job a bulk action could not apply to, and why. */
export interface BlockedJob {
  id: string
  reason: string
}

export interface BulkGuardResult {
  allowed: GuardedJob[]
  blocked: BlockedJob[]
}

/**
 * Split a batch into what may change and what may not.
 *
 * Reporting per job rather than refusing the whole batch: an operator ticking
 * thirty cleans should not have to find the one problem by bisection, and the
 * twenty-nine ordinary ones are not made wrong by it.
 */
export function partitionBulkChange(
  jobs: readonly GuardedJob[],
  intent: JobChangeIntent,
): BulkGuardResult {
  const allowed: GuardedJob[] = []
  const blocked: BlockedJob[] = []

  for (const job of jobs) {
    const reason = jobChangeBlockedReason(job, intent)
    if (reason) blocked.push({ id: job.id, reason })
    else allowed.push(job)
  }

  return { allowed, blocked }
}

/** One line summarising what a bulk action skipped. */
export function describeBlocked(blocked: readonly BlockedJob[]): string {
  if (blocked.length === 0) return ""
  const reasons = [...new Set(blocked.map(b => b.reason))]
  const count = `${blocked.length} job${blocked.length === 1 ? "" : "s"}`
  return `${count} left unchanged · ${reasons.join(" ")}`
}
