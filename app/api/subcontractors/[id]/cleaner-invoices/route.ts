import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { computeOwedForCleanerPeriod, reconcileStatus } from '@/lib/cleaner-invoice'
import { CleanerInvoiceAttachmentError, readCleanerInvoiceAttachment } from '@/lib/cleaner-invoice-attachment'
import { cleanerInvoiceResponseSelect } from '@/lib/cleaner-invoice-select'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/subcontractors/[id]/cleaner-invoices?period=yyyy-MM
 *   List a cleaner's recorded invoices (optionally for one period).
 *
 * POST /api/subcontractors/[id]/cleaner-invoices  { period, claimedAmount, reference?, notes? }
 *   Record what the cleaner billed us for a period; reconcile it against what we
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
    const invoices = await prisma.cleanerInvoice.findMany({
      where: { subcontractorId: id, ...(period ? { period } : {}) },
      orderBy: { receivedAt: 'desc' },
      select: cleanerInvoiceResponseSelect,
    })
    return NextResponse.json({ invoices })
  } catch (error) {
    return handleApiError(error, 'Failed to load cleaner invoices')
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
    let attachment: Awaited<ReturnType<typeof readCleanerInvoiceAttachment>> = null

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      period = form.get('period')
      claimedAmount = form.get('claimedAmount')
      reference = form.get('reference')
      notes = form.get('notes')
      const file = form.get('file')
      attachment = await readCleanerInvoiceAttachment(file instanceof File ? file : null)
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

    const sub = await prisma.subcontractor.findUnique({ where: { id }, select: { id: true } })
    if (!sub) return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 })

    const computedOwed = await computeOwedForCleanerPeriod(prisma, id, periodValue)
    const status = reconcileStatus(claimedAmountValue, computedOwed)

    const invoice = await prisma.cleanerInvoice.create({
      data: {
        subcontractorId: id,
        period: periodValue,
        claimedAmount: claimedAmountValue,
        computedOwed,
        reference: referenceValue || null,
        notes: notesValue || null,
        status,
        ...(attachment || {}),
      },
      select: cleanerInvoiceResponseSelect,
    })

    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof CleanerInvoiceAttachmentError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('[cleaner-invoices] create failed:', error)
    return handleApiError(error, 'Failed to record cleaner invoice')
  }
}
