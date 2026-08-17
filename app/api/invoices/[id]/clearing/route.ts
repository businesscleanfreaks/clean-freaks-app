import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { revalidateInvoicePages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * Mark an invoice as "clearing" — an ACH or check payment is on its way but
 * takes 5-7 days to land. This is NOT the same as paid: the money has not
 * arrived, so the invoice stays unpaid until it is confirmed.
 *
 * POST   marks clearing
 * DELETE undoes it ("Not actually clearing")
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, clientId: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    // Only a sent, unpaid invoice can be waiting on funds.
    if (invoice.status !== 'SENT') {
      return NextResponse.json(
        { error: 'Only a sent invoice that is still unpaid can be marked clearing.' },
        { status: 400 },
      )
    }

    await prisma.invoice.update({ where: { id }, data: { clearingSince: new Date() } })
    revalidateInvoicePages(invoice.clientId)
    logger.info(`[invoice:clearing] marked clearing ${id}`)
    return NextResponse.json({ success: true, clearing: true })
  } catch (error) {
    return handleApiError(error, 'Failed to mark invoice clearing')
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)

    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { clientId: true } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    await prisma.invoice.update({ where: { id }, data: { clearingSince: null } })
    revalidateInvoicePages(invoice.clientId)
    return NextResponse.json({ success: true, clearing: false })
  } catch (error) {
    return handleApiError(error, 'Failed to undo clearing')
  }
}
