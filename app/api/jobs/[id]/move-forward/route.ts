import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { hasFinalInvoice } from '@/lib/invoice-status'
import { revalidateSchedulePages } from '@/lib/revalidate'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format')
    .nullable(),
})

/**
 * Apply a new start TIME to this recurring clean and every editable occurrence
 * after it, without changing the day of the week. This is the "All future
 * cleans" branch of a calendar drag-move.
 *
 * The recurring day is intentionally left alone (that product decision keeps
 * this operation regeneration-free): only the schedule's default time and the
 * future occurrences' start times move, so no dates shift and no invoice
 * amounts change. Paid, cancelled, and finalized-invoice cleans are skipped.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const { startTime } = parsed.data

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        scheduleId: true,
        status: true,
        subcontractorPaid: true,
        vendorPaid: true,
        invoiceLineItems: { select: { invoice: { select: { status: true } } } },
        location: { select: { clientId: true } },
        schedule: { select: { startTime: true } },
      },
    })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!job.scheduleId || !job.schedule) {
      return NextResponse.json({ error: 'This clean is not part of a recurring schedule' }, { status: 400 })
    }
    if (
      hasFinalInvoice(job.invoiceLineItems) ||
      job.subcontractorPaid ||
      job.vendorPaid ||
      job.status === 'CANCELLED'
    ) {
      return NextResponse.json(
        { error: 'This clean is locked by an invoice, payment, or cancellation.' },
        { status: 409 },
      )
    }

    // The schedule's current default time, so the caller can offer an undo.
    const previous = { startTime: job.schedule.startTime }

    const result = await prisma.$transaction(
      async tx => {
        const seriesJobs = await tx.job.findMany({
          where: { scheduleId: job.scheduleId!, date: { gte: job.date } },
          select: {
            id: true,
            status: true,
            subcontractorPaid: true,
            vendorPaid: true,
            invoiceLineItems: { select: { invoice: { select: { status: true } } } },
          },
        })
        const updatableIds = seriesJobs
          .filter(
            seriesJob =>
              !hasFinalInvoice(seriesJob.invoiceLineItems) &&
              !seriesJob.subcontractorPaid &&
              !seriesJob.vendorPaid &&
              seriesJob.status !== 'CANCELLED',
          )
          .map(seriesJob => seriesJob.id)

        // Future occurrences the schedule has not generated yet inherit the new
        // time from the schedule default.
        await tx.schedule.update({
          where: { id: job.scheduleId! },
          data: { startTime },
        })
        await tx.job.updateMany({
          where: { id: { in: updatableIds } },
          data: { startTime },
        })

        return {
          updated: updatableIds.length,
          skipped: seriesJobs.length - updatableIds.length,
        }
      },
      { maxWait: 10000, timeout: 30000 },
    )

    revalidateSchedulePages(job.location.clientId)

    return NextResponse.json({ ...result, previous })
  } catch (error) {
    logger.error('[move-forward] failed:', error)
    return handleApiError(error, 'Failed to move future cleans')
  }
}
