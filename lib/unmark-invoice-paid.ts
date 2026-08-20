/**
 * The exact reverse of {@link markInvoicePaid}.
 *
 * Undo has to clear the payment record, not just the status — an invoice left
 * at SENT with a datePaid and a paymentMethod still reads as paid everywhere
 * that looks at those fields (statements, the client portal, payout timing).
 *
 * Pure of revalidation/HTTP concerns so it is safe in a transaction and in
 * tests. Idempotent: an invoice that is not PAID is left alone and reported.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type DbClient = typeof prisma | Prisma.TransactionClient

export type UnmarkInvoicePaidResult =
  | { status: 'REVERTED'; invoiceId: string; to: string }
  | { status: 'NOT_PAID'; invoiceId: string }
  | { status: 'NOT_FOUND' }

export async function unmarkInvoicePaid(
  db: DbClient,
  invoiceId: string,
  /** Where to put it back. Defaults to SENT, which is where a paid invoice came from. */
  to: 'DRAFT' | 'SENT' = 'SENT',
): Promise<UnmarkInvoicePaidResult> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, dateSent: true },
  })

  if (!invoice) return { status: 'NOT_FOUND' }
  if (invoice.status !== 'PAID') return { status: 'NOT_PAID', invoiceId }

  // Never claim it was sent if there is no record of sending it.
  const target = to === 'SENT' && !invoice.dateSent ? 'DRAFT' : to

  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      status: target,
      datePaid: null,
      paymentReceivedAt: null,
      paymentMethod: null,
      paymentNotes: null,
      paymentTransactionId: null,
    },
  })

  return { status: 'REVERTED', invoiceId, to: target }
}
