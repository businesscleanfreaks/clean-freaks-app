/**
 * Sent-invoice tracking: the Sent → Due → Paid timeline and the reminder ladder.
 *
 * Mirrors the handoff mockup (`Main Mockup.dc.html` line 1918 for the timeline,
 * `Invoices Overview.dc.html` line 1052 for `LADDER`). Kept pure so the states
 * can be tested without a database or a browser.
 *
 * Copy rules from the README: sentence case, "·" separators, and no em dashes.
 */

export type StepState = "done" | "pending" | "late" | "clearing"

export interface TimelineStep {
  key: "sent" | "due" | "paid"
  label: string
  sub: string
  state: StepState
  /** The connector to the NEXT step is green once we are at least this far. */
  lineDone: boolean
}

export interface TrackedInvoice {
  status: string
  dateSent: Date | string | null
  dateDue: Date | string | null
  datePaid: Date | string | null
  clearingSince: Date | string | null
}

const DAY_MS = 86_400_000

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** Calendar days between two instants, ignoring the time of day. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / DAY_MS)
}

export function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** "today" / "1 day ago" / "6 days ago" — never a bare number. */
export function agoLabel(from: Date, now: Date): string {
  const days = daysBetween(from, now)
  if (days <= 0) return "today"
  return days === 1 ? "1 day ago" : `${days} days ago`
}

/**
 * How many days past due, or 0 when not late. A missing due date can never
 * make an invoice look late.
 */
export function daysLate(invoice: TrackedInvoice, now: Date = new Date()): number {
  if (invoice.status === "PAID") return 0
  const due = toDate(invoice.dateDue)
  if (!due) return 0
  return Math.max(0, daysBetween(due, now))
}

/**
 * The three-step tracker under the client name. Returns null for an invoice
 * that has not been sent: there is nothing to track yet, and the reviewer
 * should be looking at the review UI instead.
 */
export function buildTimeline(invoice: TrackedInvoice, now: Date = new Date()): TimelineStep[] | null {
  const sent = toDate(invoice.dateSent)
  const paidAt = toDate(invoice.datePaid)
  const due = toDate(invoice.dateDue)
  const paid = invoice.status === "PAID"
  if (!paid && invoice.status !== "SENT") return null

  // Clearing is a sub-state of an unpaid sent invoice, never of a paid one.
  const clearingSince = paid ? null : toDate(invoice.clearingSince)
  const late = !paid && daysLate(invoice, now) > 0

  const step1: TimelineStep = {
    key: "sent",
    label: "Sent",
    sub: sent ? agoLabel(sent, now) : "not recorded",
    state: "done",
    lineDone: true,
  }

  const dueShort = due ? formatShortDate(due) : "no due date"
  const step2: TimelineStep = paid || clearingSince
    ? { key: "due", label: "Due", sub: dueShort, state: "done", lineDone: true }
    : late
      ? { key: "due", label: `Due ${dueShort}`, sub: "Past due", state: "late", lineDone: false }
      : { key: "due", label: "Due", sub: dueShort, state: "pending", lineDone: false }

  const step3: TimelineStep = paid
    ? { key: "paid", label: "Paid", sub: paidAt ? agoLabel(paidAt, now) : "recorded", state: "done", lineDone: false }
    : clearingSince
      ? {
          key: "paid",
          label: "Clearing",
          sub: `~${formatShortDate(new Date(clearingSince.getTime() + CLEARING_DAYS * DAY_MS))}`,
          state: "clearing",
          lineDone: false,
        }
      : { key: "paid", label: "Paid", sub: "·", state: "pending", lineDone: false }

  return [step1, step2, step3]
}

/** ACH and checks take 5 to 7 days to land; the ledger uses the same number. */
export const CLEARING_DAYS = 7

// ── Reminder ladder ────────────────────────────────────────────────────────
// Stage comes from DAYS LATE, not from how many reminders have gone out, so a
// missed nudge never leaves an invoice stuck on stage 1.

export type ReminderTone = "soft" | "firm" | "call"

export interface ReminderStage {
  stage: 1 | 2 | 3
  label: string
  title: string
  tone: ReminderTone
  /** Stage 3 is a phone call. Nothing is emailed. */
  isCall: boolean
  body: string
}

/** Defaults from the mockup. The billing schedule will let Josh edit 1 and 2. */
export const REMINDER_TEMPLATES = {
  s1: "Hi · just a friendly note that invoice #NUM for AMT was due DUE. Let us know if you need anything to process it. Thank you!",
  s2: "Hi · following up on invoice #NUM for AMT, now DAYS days past due. Could you confirm when payment will go out? Happy to resend the invoice if it got lost.",
  s3: "Two written reminders have gone unanswered on invoice #NUM (AMT, DAYS days past due). Emails have stopped working · call the account contact and log what they say.",
}

export interface ReminderVars {
  invoiceNumber: string
  amount: string
  due: string
  days: number
}

/** Fills every occurrence of each token (the mockup only replaced the first). */
export function fillReminderTemplate(body: string, vars: ReminderVars): string {
  return body
    .replaceAll("#NUM", `#${vars.invoiceNumber}`)
    .replaceAll("AMT", vars.amount)
    .replaceAll("DUE", vars.due)
    .replaceAll("DAYS", String(vars.days))
}

/**
 * Which rung of the ladder an invoice is on. Null when it is not late: the
 * design never offers a reminder for an invoice that is not yet due.
 */
export function reminderStage(
  invoice: TrackedInvoice,
  templates: Partial<typeof REMINDER_TEMPLATES> = {},
  now: Date = new Date(),
): ReminderStage | null {
  const days = daysLate(invoice, now)
  if (days <= 0) return null
  const t = { ...REMINDER_TEMPLATES, ...templates }
  if (days < 5) {
    return { stage: 1, label: "First nudge ready", title: "Reminder ready to send", tone: "soft", isCall: false, body: t.s1 }
  }
  if (days < 14) {
    return { stage: 2, label: "Second reminder ready", title: "Second reminder ready", tone: "firm", isCall: false, body: t.s2 }
  }
  return { stage: 3, label: "Call them · reminders exhausted", title: "Time for a phone call", tone: "call", isCall: true, body: t.s3 }
}

/** Reminders reply into the original thread, so the subject gains one "Re: ". */
export function replySubject(original: string | null | undefined, fallback: string): string {
  const base = (original || "").trim() || fallback
  return /^re:\s/i.test(base) ? base : `Re: ${base}`
}

// ── Primary action ─────────────────────────────────────────────────────────
// The design allows exactly ONE primary action per state.

export type TrackingAction = "remind" | "call" | "confirm-deposit" | "mark-paid" | "none"

export function primaryAction(invoice: TrackedInvoice, now: Date = new Date()): TrackingAction {
  if (invoice.status === "PAID") return "none"
  if (invoice.status !== "SENT") return "none"
  if (invoice.clearingSince) return "confirm-deposit"
  const ladder = reminderStage(invoice, {}, now)
  if (ladder) return ladder.isCall ? "call" : "remind"
  return "mark-paid"
}
