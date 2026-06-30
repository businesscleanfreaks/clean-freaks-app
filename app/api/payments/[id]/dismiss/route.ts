import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

/**
 * POST /api/payments/[id]/dismiss
 *
 * Drop a detected payment from the queue (not a real payment, or handled
 * manually). The Phase-0 messageId/confirmation dedupe keeps it from re-appearing
 * on the next scan.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()

    const { id } = await Promise.resolve(params)
    const match = await prisma.paymentMatch.findUnique({ where: { id } })
    if (!match) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    await prisma.paymentMatch.update({
      where: { id },
      data: { status: 'DISMISSED' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[payments/dismiss] failed:', error)
    return handleApiError(error, 'Failed to dismiss payment')
  }
}
