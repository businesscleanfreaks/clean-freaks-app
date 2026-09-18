import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { partitionBulkChange, describeBlocked } from '@/lib/job-mutation-guard'
import { removeJobsFromDraftInvoices } from '@/lib/job-cancellation'
import { z } from 'zod'

const bulkUpdateSchema = z.object({
  jobIds: z.array(z.string()).min(1, 'At least one job ID is required'),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  subcontractorId: z.string().nullable().optional(),
  invoiced: z.boolean().optional(),
})

/**
 * Change several jobs at once.
 *
 * This route used to check only that the jobs existed and then call
 * `updateMany`, which meant a bulk action did things the individual route
 * refuses:
 *
 *   - reassigning a clean the cleaner had already been paid for, which the
 *     single-job route blocks and this one did silently;
 *   - cancelling an invoiced clean without touching the draft invoice, so the
 *     client kept being billed for work that was no longer happening.
 *
 * Both now go through the same code as the individual route: the rules in
 * lib/job-mutation-guard.ts and the cleanup in lib/job-cancellation.ts.
 */
export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    const validationResult = bulkUpdateSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }

    const { jobIds, status, subcontractorId, invoiced } = validationResult.data

    const existingJobs = await prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        status: true,
        scheduleId: true,
        subcontractorPaid: true,
        vendorPaid: true,
        invoiceLineItems: {
          select: { invoice: { select: { status: true } } },
        },
      },
    })

    if (existingJobs.length !== jobIds.length) {
      return createErrorResponse('Some jobs were not found', 404, 'NOT_FOUND')
    }

    // The same question the individual route asks, about the same change.
    const { allowed, blocked } = partitionBulkChange(existingJobs, {
      changesWorker: subcontractorId !== undefined,
    })

    if (allowed.length === 0) {
      return createErrorResponse(
        describeBlocked(blocked) || 'Nothing could be updated',
        400,
        'CONSTRAINT_ERROR'
      )
    }

    const updateData: { status?: string; subcontractorId?: string | null; invoiced?: boolean } = {}
    if (status !== undefined) updateData.status = status
    if (subcontractorId !== undefined) updateData.subcontractorId = subcontractorId
    if (invoiced !== undefined) updateData.invoiced = invoiced

    const allowedIds = allowed.map(job => job.id)
    const isCancelling = status === 'CANCELLED'

    const result = await prisma.$transaction(async (tx) => {
      // Cancelling drops the work off any draft invoice billing for it, exactly
      // as cancelling one clean does. Done BEFORE the status write so a failure
      // here leaves the job scheduled rather than cancelled and still billed.
      const cleanup = isCancelling
        ? await removeJobsFromDraftInvoices(tx, allowedIds)
        : { invoicesTouched: 0, linesRemoved: 0 }

      const updated = await tx.job.updateMany({
        where: { id: { in: allowedIds } },
        data: updateData,
      })

      return { count: updated.count, ...cleanup }
    })

    if (blocked.length > 0) {
      logger.info(`[bulk-update] ${blocked.length} job(s) left unchanged: ${describeBlocked(blocked)}`)
    }

    const note = describeBlocked(blocked)
    return NextResponse.json({
      success: true,
      updated: result.count,
      blocked,
      invoicesTouched: result.invoicesTouched,
      message: `Successfully updated ${result.count} job${result.count !== 1 ? 's' : ''}${note ? ` · ${note}` : ''}`,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to update jobs')
  }
}

// Frontend sends POST for mark-as-invoiced — reuse the same handler
export const POST = PUT
