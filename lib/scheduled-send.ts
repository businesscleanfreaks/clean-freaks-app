/**
 * Whether a scheduled invoice should actually go out when its time arrives.
 *
 * The cron selected work with `status: { notIn: ['SENT', 'PAID'] }` and then
 * sent whatever came back. Four things follow from that shape:
 *
 *   - "not sent and not paid" includes VOID, so an invoice that had been
 *     deliberately voided would still be emailed to the client if a send had
 *     been scheduled before it was voided;
 *   - the manual send runs the pre-send guard (does this invoice still match
 *     the schedule it bills for) and the scheduled send ran nothing · the same
 *     invoice was checked when a person sent it and not when the clock did;
 *   - two overlapping runs both read an invoice as due, because nothing claimed
 *     it;
 *   - a failure after the provider accepted the mail left the invoice still
 *     scheduled, so the next run sent it again.
 *
 * This module holds the decision. The claim and the order of writes are the
 * route's job, but they are only safe once the decision is separable and
 * testable, which is what this is for.
 *
 * The bias throughout is: when we cannot tell, HOLD. An invoice that goes out
 * late is a nuisance; one that goes out twice, or goes out voided, is a
 * conversation with a client.
 *
 * Pure: no Prisma, no clock, no mail.
 */

/** Statuses a scheduled send may act on. Everything else is stale. */
export const SENDABLE_STATUSES = ["DRAFT", "OVERDUE"] as const

export function isSendableStatus(status: string | null | undefined): boolean {
  return (SENDABLE_STATUSES as readonly string[]).includes(String(status ?? ""))
}

export type ScheduledSendAction =
  /** Send it now. */
  | "send"
  /** Leave it scheduled · the reason is temporary and will clear. */
  | "hold"
  /** Drop the schedule · it can never usefully run. */
  | "discard"

export interface ScheduledSendDecision {
  action: ScheduledSendAction
  /** Recorded in the run summary, so a quiet cron can still be accounted for. */
  reason: string
}

export interface ScheduledSendInput {
  status: string | null | undefined
  /** A usable captured email: at least one recipient. */
  hasPayload: boolean
  /** Real client email is switched on in settings. */
  realSendingOn: boolean
  hasCredentials: boolean
  /**
   * The invoice still matches the schedule it bills for · the same check the
   * manual send makes before a real send.
   */
  scheduleMatches: boolean
}

export function decideScheduledSend(input: ScheduledSendInput): ScheduledSendDecision {
  // Nothing to send, and no later run will invent one.
  if (!input.hasPayload) {
    return { action: "discard", reason: "no-payload" }
  }

  // Voided, already sent, already paid: the schedule is left over from before
  // and must not fire. This is the case the old `notIn: ['SENT','PAID']` filter
  // let through · a voided invoice would have been emailed to the client.
  if (!isSendableStatus(input.status)) {
    return { action: "discard", reason: `not-sendable:${String(input.status ?? "unknown")}` }
  }

  // Sending is off or unconfigured. Temporary · keep it queued so it goes out
  // once switched on, rather than quietly dropping it.
  if (!input.realSendingOn) {
    return { action: "hold", reason: "sending-disabled" }
  }
  if (!input.hasCredentials) {
    return { action: "hold", reason: "no-credentials" }
  }

  // The work behind the invoice changed after it was scheduled. A person gets
  // asked about this before a manual send; the clock must not just proceed.
  if (!input.scheduleMatches) {
    return { action: "hold", reason: "schedule-mismatch" }
  }

  return { action: "send", reason: "due" }
}

/** Whether a decision leaves the invoice in the queue for a later run. */
export function staysQueued(decision: ScheduledSendDecision): boolean {
  return decision.action === "hold"
}
