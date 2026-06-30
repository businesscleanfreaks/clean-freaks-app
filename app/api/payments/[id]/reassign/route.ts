import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * POST /api/payments/[id]/reassign  { invoiceId }
 *
 * Repoint a pending match's suggested invoice when the auto-pick was wrong. Stays
 * NEEDS_REVIEW — the user still Confirms to actually apply it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(params)
    const { invoiceId } = await request.json()
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    const match = await prisma.paymentMatch.findUnique({ where: { id } })
    if (!match) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (match.status !== 'NEEDS_REVIEW') {
      return NextResponse.json({ error: 'Only pending payments can be reassigned' }, { status: 409 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    await prisma.paymentMatch.update({
      where: { id },
      data: { matchedInvoiceId: invoiceId, confidence: 'REVIEW' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[payments/reassign] failed:', error)
    return NextResponse.json({ error: 'Failed to reassign payment' }, { status: 500 })
  }
}
