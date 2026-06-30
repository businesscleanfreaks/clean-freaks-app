/**
 * Single source of truth for flipping an invoice to PAID. Shared by the manual
 * "mark paid" route and the payment-reconciliation confirm action so the two can
 * never drift.
 *
 * Pure of revalidation/HTTP concerns (no next/cache) so it is safe inside a
 * transaction and in tests. Idempotent: an already-PAID invoice is left alone and
 * reported back, and `confirmationNumber` is stored as paymentTransactionId so the
 * same Zelle notification can't double-apply.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type DbClient = typeof prisma | Prisma.TransactionClient

export interface MarkInvoicePaidOptions {
  method?: string
  notes?: string
  confirmationNumber?: string | null
  receivedAt?: Date
}

export type MarkInvoicePaidResult =
  | { status: 'PAID'; invoiceId: string }
  | { status: 'ALREADY_PAID'; invoiceId: string }
  | { status: 'NOT_FOUND' }

export async function markInvoicePaid(
  db: DbClient,
  invoiceId: string,
  opts: MarkInvoicePaidOptions = {},
): Promise<MarkInvoicePaidResult> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true },
  })

  if (!invoice) return { status: 'NOT_FOUND' }
  if (invoice.status === 'PAID') return { status: 'ALREADY_PAID', invoiceId }

  const now = opts.receivedAt ?? new Date()
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'PAID',
      datePaid: now,
      paymentReceivedAt: now,
      paymentMethod: opts.method || 'MANUAL',
      paymentNotes: opts.notes || 'Marked as paid manually',
      ...(opts.confirmationNumber ? { paymentTransactionId: opts.confirmationNumber } : {}),
    },
  })

  return { status: 'PAID', invoiceId }
}
