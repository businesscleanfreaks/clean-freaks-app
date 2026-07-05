import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { markInvoicePaid } from '@/lib/mark-invoice-paid'
import { normalizeSenderName } from '@/lib/payment-matching'
import { paymentMethodFromSnippet, paymentSourceLabelFromSnippet } from '@/lib/payment-email-parse'

/**
 * POST /api/payments/[id]/confirm  { invoiceId }
 *
 * Applies a reviewed payment: marks the invoice PAID (which releases any
 * cadence-gated cleaner) and learns the payer→client alias. Transactional and
 * idempotent — an already-PAID invoice is rejected so the same money can't apply
 * twice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()

    const { id } = await Promise.resolve(params)
    const { invoiceId } = await request.json()
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    const match = await prisma.paymentMatch.findUnique({ where: { id } })
    if (!match) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (match.status === 'CONFIRMED') {
      return NextResponse.json({ error: 'This payment was already confirmed' }, { status: 409 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, clientId: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const result = await prisma.$transaction(async (tx) => {
      const sourceLabel = paymentSourceLabelFromSnippet(match.rawSnippet)
      const paid = await markInvoicePaid(tx, invoiceId, {
        method: paymentMethodFromSnippet(match.rawSnippet),
        confirmationNumber: match.confirmationNumber,
        receivedAt: match.receivedAt,
        notes: `${sourceLabel} payment from ${match.senderName}`,
      })
      if (paid.status === 'ALREADY_PAID') return { conflict: true as const }
      if (paid.status === 'NOT_FOUND') return { notFound: true as const }

      await tx.paymentMatch.update({
        where: { id },
        data: { status: 'CONFIRMED', matchedInvoiceId: invoiceId },
      })

      // Learn the payer → client alias so future payments from this sender auto-resolve.
      const normalized = normalizeSenderName(match.senderName)
      await tx.clientPaymentAlias.upsert({
        where: { normalizedSenderName: normalized },
        create: { normalizedSenderName: normalized, clientId: invoice.clientId },
        update: { clientId: invoice.clientId },
      })

      return { ok: true as const }
    })

    if ('conflict' in result) {
      return NextResponse.json({ error: 'That invoice is already marked paid' }, { status: 409 })
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    revalidatePath('/payables')
    revalidatePath('/invoices')
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[payments/confirm] failed:', error)
    return handleApiError(error, 'Failed to confirm payment')
  }
}
