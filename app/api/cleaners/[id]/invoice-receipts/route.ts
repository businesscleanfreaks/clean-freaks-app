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
 *
 * `[id]` is a cleaner by default; pass `?payee=vendor` for a vendor, which is a
 * separate model but the same mechanic.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const { id: payeeId } = await Promise.resolve(params)
    const isVendor = new URL(request.url).searchParams.get('payee') === 'vendor'
    const payee = isVendor ? { vendorId: payeeId } : { subcontractorId: payeeId }
    const body = await request.json().catch(() => ({}))

    const locationId = typeof body?.locationId === 'string' ? body.locationId : ''
    const period = typeof body?.period === 'string' ? body.period : ''
    const jobId = typeof body?.jobId === 'string' && body.jobId ? body.jobId : null
    const addOnServiceId =
      typeof body?.addOnServiceId === 'string' && body.addOnServiceId ? body.addOnServiceId : null
    const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''

    if (!locationId) return NextResponse.json({ error: 'Account is required' }, { status: 400 })
    if (!PERIOD.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }
    if (reference.length > 120) {
      return NextResponse.json({ error: 'Reference is too long' }, { status: 400 })
    }
    if (jobId && addOnServiceId) {
      return NextResponse.json(
        { error: 'A receipt covers a clean or an add-on, not both' },
        { status: 400 },
      )
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

    // An add-on receipt must belong to the account it claims, the same way a
    // job one must, or the tallies count someone else's work as invoiced.
    if (addOnServiceId) {
      const addOn = await prisma.addOnService.findUnique({
        where: { id: addOnServiceId },
        select: {
          job: { select: { locationId: true } },
          schedule: { select: { locationId: true } },
        },
      })
      if (!addOn) return NextResponse.json({ error: 'Add-on not found' }, { status: 404 })
      const owner = addOn.job?.locationId ?? addOn.schedule?.locationId ?? null
      if (owner !== locationId) {
        return NextResponse.json({ error: 'That add-on is not on this account' }, { status: 400 })
      }
    }

    // Idempotent: ticking an already-ticked box is a no-op, not a 500.
    const existing = await prisma.cleanerInvoiceReceipt.findFirst({
      where: { ...payee, locationId, period, jobId, addOnServiceId },
      select: { id: true },
    })
    const receipt = existing
      ? await prisma.cleanerInvoiceReceipt.update({
          where: { id: existing.id },
          data: { reference: reference || null },
        })
      : await prisma.cleanerInvoiceReceipt.create({
          data: { ...payee, locationId, period, jobId, addOnServiceId, reference: reference || null },
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
    const { id: payeeId } = await Promise.resolve(params)
    const url = new URL(request.url)
    const isVendor = url.searchParams.get('payee') === 'vendor'
    const payee = isVendor ? { vendorId: payeeId } : { subcontractorId: payeeId }
    const locationId = url.searchParams.get('locationId') || ''
    const period = url.searchParams.get('period') || ''
    const jobId = url.searchParams.get('jobId') || null
    const addOnServiceId = url.searchParams.get('addOnServiceId') || null

    if (!locationId) return NextResponse.json({ error: 'Account is required' }, { status: 400 })
    if (!PERIOD.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }

    await prisma.cleanerInvoiceReceipt.deleteMany({
      where: { ...payee, locationId, period, jobId, addOnServiceId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error clearing cleaner invoice receipt:', error)
    return handleApiError(error, 'Failed to update the invoice')
  }
}
