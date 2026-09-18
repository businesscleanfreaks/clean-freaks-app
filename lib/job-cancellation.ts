import type { Prisma } from "@prisma/client"
import { logger } from "./logger"

/**
 * Taking cancelled work off the invoices that bill for it.
 *
 * Cancelling one clean did this; cancelling several at once did not, because
 * the bulk route was a bare `updateMany`. An invoiced clean could be cancelled
 * in a batch and the client kept being billed for it: the draft line stayed,
 * the invoice total still counted it, and the job stayed marked `invoiced`.
 *
 * Draft invoices lose the line and are retotalled. SENT and PAID invoices keep
 * it · they are a record of what we actually billed, and cancelling work today
 * does not change what went out last week. That is the individual route's
 * existing rule, moved here so both callers share it rather than one of them
 * having it.
 *
 * Takes the transaction client so it runs inside the caller's transaction.
 */
export async function removeJobsFromDraftInvoices(
  tx: Prisma.TransactionClient,
  jobIds: readonly string[],
): Promise<{ invoicesTouched: number; linesRemoved: number }> {
  if (jobIds.length === 0) return { invoicesTouched: 0, linesRemoved: 0 }

  const ids = [...jobIds]

  const invoices = await tx.invoice.findMany({
    where: { lineItems: { some: { jobId: { in: ids } } } },
    select: { id: true, status: true },
  })

  const drafts = invoices.filter(invoice => invoice.status === "DRAFT")
  if (drafts.length === 0) return { invoicesTouched: 0, linesRemoved: 0 }

  let linesRemoved = 0

  for (const invoice of drafts) {
    const removed = await tx.invoiceLineItem.deleteMany({
      where: { invoiceId: invoice.id, jobId: { in: ids } },
    })
    linesRemoved += removed.count

    const remaining = await tx.invoiceLineItem.findMany({
      where: { invoiceId: invoice.id },
      select: { amount: true },
    })
    const totalAmount = remaining.reduce((sum, item) => sum + item.amount, 0)
    await tx.invoice.update({ where: { id: invoice.id }, data: { totalAmount } })

    logger.info(
      `[cancellation] Removed ${removed.count} cancelled line(s) from DRAFT invoice ${invoice.id} and recalculated total`,
    )
  }

  // The work is off the draft, so it is billable again if it comes back.
  await tx.job.updateMany({ where: { id: { in: ids } }, data: { invoiced: false } })

  return { invoicesTouched: drafts.length, linesRemoved }
}
