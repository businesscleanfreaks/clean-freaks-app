/**
 * Invoice-time correction of a cancelled clean.
 *
 * The reviewer often knows something the calendar doesn't: the clean marked
 * cancelled actually happened. The handoff is explicit that fixing it here
 * writes back to the shared visit record rather than patching this invoice —
 * "visits are one shared record read by calendar, invoices, and payables" — so
 * the calendar shows the clean, the cleaner gets credited, and the invoice
 * recomputes from the same source.
 *
 * Pure so the row copy and the money effect can be tested without a database.
 */

export type CorrectionTarget = "COMPLETED" | "CANCELLED"

export interface CorrectableClean {
  jobId?: string
  date: string | Date
  status: string
  /** What this clean bills when it counts. */
  clientRate?: number | null
  /** Late-cancel fee currently attached, if any. */
  cancellationFee?: number | null
}

export interface CorrectionRow {
  jobId: string
  day: number
  dateLabel: string
  /** True once the clean counts towards this invoice again. */
  billed: boolean
  description: string
  /** Signed money effect of the current state, "" when nothing changes. */
  effect: string
  actionLabel: string
  /** What clicking the action sets the shared visit record to. */
  target: CorrectionTarget
  /** A late-cancel fee that restoring this clean would drop. */
  droppedFee: number
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Rows for the correction list: every cancelled clean this month, plus any the
 * reviewer has just restored — those stay listed so the change can be undone
 * without hunting for the day again.
 */
export function buildCorrectionRows(
  month: string,
  cleans: CorrectableClean[],
  correctedJobIds: Iterable<string> = [],
): CorrectionRow[] {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return []
  const corrected = new Set(correctedJobIds)
  const rows: CorrectionRow[] = []

  for (const clean of cleans) {
    if (!clean.jobId) continue
    const d = clean.date instanceof Date ? clean.date : new Date(clean.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m - 1) continue

    const isCancelled = clean.status === "CANCELLED" || clean.status === "SKIPPED"
    const wasCorrected = corrected.has(clean.jobId)
    if (!isCancelled && !wasCorrected) continue

    const rate = clean.clientRate ?? 0
    const fee = clean.cancellationFee ?? 0

    rows.push({
      jobId: clean.jobId,
      day: d.getDate(),
      dateLabel: `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`,
      billed: !isCancelled,
      description: isCancelled
        ? fee > 0
          ? `Cancelled · not billed · ${money(fee)} cancellation fee`
          : "Cancelled · not billed"
        : "Completed · billed · cleaner credited",
      effect: isCancelled ? (fee > 0 ? `+${money(fee)}` : "") : rate > 0 ? `+${money(rate)}` : "",
      actionLabel: isCancelled ? "It happened" : "Undo",
      target: isCancelled ? "COMPLETED" : "CANCELLED",
      droppedFee: isCancelled ? fee : 0,
    })
  }

  return rows.sort((a, b) => a.day - b.day)
}

/**
 * What to tell the reviewer after the write lands. Says "calendar updated"
 * because that is the part which surprises people: this is not a local edit.
 */
export function correctionToast(target: CorrectionTarget, cleanerName?: string | null, droppedFee = 0): string {
  if (target === "CANCELLED") return "Marked cancelled · calendar updated"
  const credited = cleanerName ? ` · ${cleanerName} credited` : ""
  const fee = droppedFee > 0 ? " · cancellation fee dropped" : ""
  return `Marked completed · calendar updated${credited}${fee}`
}
