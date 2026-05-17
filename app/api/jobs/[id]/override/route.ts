import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidateSchedulePages } from '@/lib/revalidate'
import { hasFinalInvoice } from '@/lib/invoice-status'

/**
 * PATCH /api/jobs/[id]/override
 *
 * Apply a change to a single job ("this clean only").
 * Does NOT change the schedule defaults — only this specific job.
 *
 * Accepted fields: clientRate, subcontractorRate, subcontractorId, startTime
 *
 * Guards:
 * - Cannot change invoiced jobs
 * - Cannot change paid jobs
 * - Cannot change completed or cancelled jobs
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { clientRate, subcontractorRate, subcontractorId, startTime } = body

    // Fetch the job with relations
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        location: {
          include: { client: true },
        },
        invoiceLineItems: {
          include: { invoice: { select: { id: true, status: true } } },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Guard: invoiced
    if (hasFinalInvoice(job.invoiceLineItems)) {
      return NextResponse.json(
        { error: 'This job is on a sent or paid invoice. Changes are locked.' },
        { status: 409 }
      )
    }

    // Guard: paid
    if (job.subcontractorPaid) {
      return NextResponse.json(
        { error: 'This job has already been paid to the cleaner. Changes are locked.' },
        { status: 409 }
      )
    }

    // Guard: completed or cancelled
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return NextResponse.json(
        { error: `Cannot modify a ${job.status.toLowerCase()} job.` },
        { status: 409 }
      )
    }

    // Build update data — only include fields that were provided
    const updateData: Record<string, unknown> = {}

    if (clientRate !== undefined && typeof clientRate === 'number') {
      updateData.clientRate = clientRate
    }

    if (subcontractorRate !== undefined && typeof subcontractorRate === 'number') {
      updateData.subcontractorRate = subcontractorRate
    }

    if (subcontractorId !== undefined) {
      updateData.subcontractorId = subcontractorId || null
    }

    if (startTime !== undefined) {
      updateData.startTime = startTime || null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update. Provide clientRate, subcontractorRate, subcontractorId, or startTime.' },
        { status: 400 }
      )
    }

    const updatedJob = await prisma.job.update({
      where: { id: params.id },
      data: updateData,
      include: {
        location: {
          include: { client: true },
        },
        subcontractor: true,
      },
    })

    // Revalidate pages
    revalidateSchedulePages(job.location.client.id)

    logger.info(`[job-override] Job ${params.id} updated:`, updateData)

    return NextResponse.json(updatedJob)
  } catch (error) {
    logger.error('Error overriding job:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update job' },
      { status: 500 }
    )
  }
}
