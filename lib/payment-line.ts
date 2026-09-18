import { formatDateOnly } from "./date-only"

/**
 * How a payment line says what it paid for.
 *
 * A payment line used to be a job id and an amount, and the job id cascaded
 * away when the clean was deleted · leaving a payment holding money with no
 * record of what it bought. One cleaner payment in production is $1,200 with no
 * lines at all for that reason.
 *
 * A line now describes itself, the way an invoice line always has. The text is
 * written once, when the payment is recorded, and never re-derived: that is the
 * point. Re-deriving it from the job is what could not survive the job going
 * away.
 *
 * Pure: no Prisma.
 */
export function paymentLineDescription(work: {
  /** The account, or the add-on's own description. */
  name: string
  /** When the work happened. Null when only the account is known. */
  date: Date | string | null
}): string {
  const name = work.name.trim()
  if (!work.date) return name

  // The day the work happened, read as a day. date-fns `format` renders in the
  // server's zone, which turns a noon-UTC service day into the NEXT day
  // anywhere far enough ahead of UTC. See lib/date-only.ts.
  const when = formatDateOnly(work.date, "MMM d, yyyy")
  if (!when) return name
  return name ? `${name} \u00b7 ${when}` : when
}
