/**
 * Whether an invoice may be emailed to a client.
 *
 * Asked by both paths that send: the person clicking Send, and the cron that
 * sends on a schedule. They disagreed. The cron selected on
 * `status: { notIn: ['SENT', 'PAID'] }`, and the manual route checked the
 * status not at all · it fetched the invoice, checked the PDF existed, and
 * emailed whatever it found.
 *
 * Two ways that bit:
 *
 *   - The workspace creates an invoice with `previewOnly: true`, which makes it
 *     VOID, then finalizes it to DRAFT, then sends. The finalize response was
 *     never checked. When finalize failed, a VOID invoice was emailed to the
 *     client and stamped SENT, while its cleans stayed `invoiced: false` and
 *     came back as billable · so the same work was invoiced twice.
 *   - Nothing stopped an already SENT or PAID invoice being emailed again.
 *
 * The rule distinguishes two different "no"s, because they deserve different
 * answers. VOID is a decision someone made: it is never sendable, and no flag
 * overrides it. SENT and PAID are just states it has already passed through ·
 * sending again is a real thing to want, so it is allowed with an explicit
 * confirmation rather than forbidden.
 *
 * Pure: no Prisma, no clock, no mail.
 */

/** Statuses an invoice can be emailed from without anyone confirming. */
export const SENDABLE_STATUSES = ["DRAFT", "OVERDUE"] as const

export function isSendableStatus(status: string | null | undefined): boolean {
  return (SENDABLE_STATUSES as readonly string[]).includes(String(status ?? ""))
}

export type SendRefusalCode =
  /** Deliberately voided. Not a state to send from, at all. */
  | "INVOICE_VOID"
  /** Already gone out. Sendable again, but only on purpose. */
  | "INVOICE_ALREADY_SENT"
  /** Some other status this module does not recognise as sendable. */
  | "INVOICE_NOT_SENDABLE"

export interface SendRefusal {
  code: SendRefusalCode
  message: string
  /** True when an explicit confirmation would let it through. */
  confirmable: boolean
}

export interface SendIntent {
  status: string | null | undefined
  /** The sender has said "yes, send it again" for an already-sent invoice. */
  confirmResend?: boolean
}

/** Null when the invoice may be sent, or the reason it may not. */
export function invoiceSendRefusal(intent: SendIntent): SendRefusal | null {
  const status = String(intent.status ?? "")

  if (isSendableStatus(status)) return null

  if (status === "VOID") {
    return {
      code: "INVOICE_VOID",
      message:
        "This invoice is void and cannot be emailed. If it was created as a preview and never finalized, " +
        "build it again from the review workspace.",
      confirmable: false,
    }
  }

  if (status === "SENT" || status === "PAID") {
    if (intent.confirmResend) return null
    return {
      code: "INVOICE_ALREADY_SENT",
      message: `This invoice has already been ${status === "PAID" ? "paid" : "sent"}. Send it again only if you mean to.`,
      confirmable: true,
    }
  }

  return {
    code: "INVOICE_NOT_SENDABLE",
    message: `An invoice with status ${status || "unknown"} cannot be emailed.`,
    confirmable: false,
  }
}
