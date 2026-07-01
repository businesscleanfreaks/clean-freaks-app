import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { computeOwedForVendorPeriod, reconcileStatus } from '@/lib/vendor-invoice'
import { VendorInvoiceAttachmentError, readVendorInvoiceAttachment } from '@/lib/vendor-invoice-attachment'
import { vendorInvoiceResponseSelect } from '@/lib/vendor-invoice-select'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/vendors/[id]/vendor-invoices?period=yyyy-MM
 *   List a vendor's recorded invoices (optionally for one period).
 *
 * POST /api/vendors/[id]/vendor-invoices
 *   Record what the vendor billed us for a period; reconcile it against what we
 *   compute we owe and store the result (MATCHED / MISMATCH).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const period = new URL(request.url).searchParams.get('period')
    const invoices = await prisma.vendorInvoice.findMany({
      where: { vendorId: id, ...(period ? { period } : {}) },
      orderBy: { receivedAt: 'desc' },
      select: vendorInvoiceResponseSelect,
    })
    return NextResponse.json({ invoices })
  } catch (error) {
    return handleApiError(error, 'Failed to load vendor invoices')
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const contentType = request.headers.get('content-type') || ''
    let period: unknown
    let claimedAmount: unknown
    let reference: unknown
    let notes: unknown
    let attachment: Awaited<ReturnType<typeof readVendorInvoiceAttachment>> = null

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      period = form.get('period')
      claimedAmount = form.get('claimedAmount')
      reference = form.get('reference')
      notes = form.get('notes')
      const file = form.get('file')
      attachment = await readVendorInvoiceAttachment(file instanceof File ? file : null)
    } else {
      const body = await request.json()
      ;({ period, claimedAmount, reference, notes } = body)
    }

    const periodValue = typeof period === 'string' ? period : ''
    const claimedAmountValue = typeof claimedAmount === 'number' ? claimedAmount : Number(claimedAmount)
    const referenceValue = typeof reference === 'string' ? reference.trim() : ''
    const notesValue = typeof notes === 'string' ? notes.trim() : ''

    if (!periodValue || !/^\d{4}-\d{2}$/.test(periodValue)) {
      return NextResponse.json({ error: 'period must be in yyyy-MM format' }, { status: 400 })
    }
    if (!Number.isFinite(claimedAmountValue) || claimedAmountValue < 0) {
      return NextResponse.json({ error: 'claimedAmount must be a non-negative number' }, { status: 400 })
    }

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } })
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const computedOwed = await computeOwedForVendorPeriod(prisma, id, periodValue)
    const status = reconcileStatus(claimedAmountValue, computedOwed)

    const invoice = await prisma.vendorInvoice.create({
      data: {
        vendorId: id,
        period: periodValue,
        claimedAmount: claimedAmountValue,
        computedOwed,
        reference: referenceValue || null,
        notes: notesValue || null,
        status,
        ...(attachment || {}),
      },
      select: vendorInvoiceResponseSelect,
    })

    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof VendorInvoiceAttachmentError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('[vendor-invoices] create failed:', error)
    return handleApiError(error, 'Failed to record vendor invoice')
  }
}
