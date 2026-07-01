import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

/**
 * POST /api/vendors/[id]/vendor-invoices/[invoiceId]/resolve
 *
 * Mark a MISMATCH'd vendor invoice as resolved by a human before payout.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> | { id: string; invoiceId: string } },
) {
  try {
    await requireAuth()
    const { id, invoiceId } = await Promise.resolve(params)

    const invoice = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } })
    if (!invoice || invoice.vendorId !== id) {
      return NextResponse.json({ error: 'Vendor invoice not found' }, { status: 404 })
    }
    if (invoice.status !== 'MISMATCH') {
      return NextResponse.json({ error: 'Only a mismatched invoice can be resolved' }, { status: 409 })
    }

    const updated = await prisma.vendorInvoice.update({
      where: { id: invoiceId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    })
    return NextResponse.json({ invoice: updated })
  } catch (error) {
    return handleApiError(error, 'Failed to resolve vendor invoice')
  }
}
