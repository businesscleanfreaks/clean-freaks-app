import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { computeOwedForCleanerPeriod, reconcileStatus } from '@/lib/cleaner-invoice'

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
    const body = await request.json()
    const { period, claimedAmount, reference, notes } = body

    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'period must be in yyyy-MM format' }, { status: 400 })
    }
    if (typeof claimedAmount !== 'number' || !Number.isFinite(claimedAmount) || claimedAmount < 0) {
      return NextResponse.json({ error: 'claimedAmount must be a non-negative number' }, { status: 400 })
    }

    const sub = await prisma.subcontractor.findUnique({ where: { id }, select: { id: true } })
    if (!sub) return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 })

    const computedOwed = await computeOwedForCleanerPeriod(prisma, id, period)
    const status = reconcileStatus(claimedAmount, computedOwed)

    const invoice = await prisma.cleanerInvoice.create({
      data: {
        subcontractorId: id,
        period,
        claimedAmount,
        computedOwed,
        reference: reference || null,
        notes: notes || null,
        status,
      },
    })

    return NextResponse.json({ invoice })
  } catch (error) {
    logger.error('[cleaner-invoices] create failed:', error)
    return handleApiError(error, 'Failed to record cleaner invoice')
  }
}
