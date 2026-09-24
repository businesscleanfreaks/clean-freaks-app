/**
 * A new client takes its pay types from its first schedule.
 *
 * The Add Client modal no longer asks flat rate or per clean: that is decided
 * when the first clean is booked, on the schedule. But invoicing still reads
 * the client-level billingType in places (lib/invoice-guard.ts, the invoice
 * lists), so a client whose first schedule is flat rate must not stay marked
 * per clean. The old wizard asked up front and set both.
 *
 * Only the FIRST schedule does this. After that the client's type is a record
 * of how it was set up, and changing a later schedule never rewrites it.
 *
 * Pure: no Prisma.
 */

const PAY_TYPES = new Set(["FLAT_RATE", "PER_CLEAN"])

export interface ClientPayTypes {
  billingType: string | null
  cleanerPayType: string | null
}

export interface SchedulePayTypes {
  clientPayType?: string | null
  subcontractorPayType?: string | null
}

/** The client fields to change, or null when nothing should change. */
export function payTypesFromFirstSchedule(
  otherSchedules: number,
  schedule: SchedulePayTypes,
  client: ClientPayTypes,
): Partial<{ billingType: string; cleanerPayType: string }> | null {
  if (otherSchedules > 0) return null

  const update: Partial<{ billingType: string; cleanerPayType: string }> = {}
  if (schedule.clientPayType && PAY_TYPES.has(schedule.clientPayType) && schedule.clientPayType !== client.billingType) {
    update.billingType = schedule.clientPayType
  }
  if (
    schedule.subcontractorPayType &&
    PAY_TYPES.has(schedule.subcontractorPayType) &&
    schedule.subcontractorPayType !== client.cleanerPayType
  ) {
    update.cleanerPayType = schedule.subcontractorPayType
  }
  return Object.keys(update).length > 0 ? update : null
}
