import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

const PERIOD = /^\d{4}-\d{2}$/

/**
 * Record that a cleaner's invoice for an account has arrived — or take it back.
 *
 * Two shapes, per Josh (2026-08-26): most accounts invoice once a month
 * (`jobId` omitted, covering the whole account), while residential and one-off
 * work invoices per clean (`jobId` set). The unique indexes let an account hold
 * either shape without recording the same thing twice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const { id: subcontractorId } = await Promise.resolve(params)
    const body = await request.json().catch(() => ({}))

    const locationId = typeof body?.locationId === 'string' ? body.locationId : ''
    const period = typeof body?.period === 'string' ? body.period : ''
    const jobId = typeof body?.jobId === 'string' && body.jobId ? body.jobId : null
    const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''

    if (!locationId) return NextResponse.json({ error: 'Account is required' }, { status: 400 })
    if (!PERIOD.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }
    if (reference.length > 120) {
      return NextResponse.json({ error: 'Reference is too long' }, { status: 400 })
    }

    // A job-scoped receipt must actually belong to the account it claims, or
    // the tallies silently count someone else's work as invoiced.
    if (jobId) {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { locationId: true },
      })
      if (!job) return NextResponse.json({ error: 'Clean not found' }, { status: 404 })
      if (job.locationId !== locationId) {
        return NextResponse.json({ error: 'That clean is not on this account' }, { status: 400 })
      }
    }

    // Idempotent: ticking an already-ticked box is a no-op, not a 500.
    const existing = await prisma.cleanerInvoiceReceipt.findFirst({
      where: { subcontractorId, locationId, period, jobId },
      select: { id: true },
    })
    const receipt = existing
      ? await prisma.cleanerInvoiceReceipt.update({
          where: { id: existing.id },
          data: { reference: reference || null },
        })
      : await prisma.cleanerInvoiceReceipt.create({
          data: { subcontractorId, locationId, period, jobId, reference: reference || null },
        })

    return NextResponse.json({ success: true, receipt })
  } catch (error) {
    logger.error('Error recording cleaner invoice receipt:', error)
    return handleApiError(error, 'Failed to record the invoice')
  }
}

/** Untick it. Missing is treated as already-removed rather than an error. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const { id: subcontractorId } = await Promise.resolve(params)
    const url = new URL(request.url)
    const locationId = url.searchParams.get('locationId') || ''
    const period = url.searchParams.get('period') || ''
    const jobId = url.searchParams.get('jobId') || null

    if (!locationId) return NextResponse.json({ error: 'Account is required' }, { status: 400 })
    if (!PERIOD.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }

    await prisma.cleanerInvoiceReceipt.deleteMany({
      where: { subcontractorId, locationId, period, jobId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error clearing cleaner invoice receipt:', error)
    return handleApiError(error, 'Failed to update the invoice')
  }
}
