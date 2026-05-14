import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateJobPages, revalidateInvoicePages } from '@/lib/revalidate'
import { updateJobSchema } from '@/lib/validations'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { recalculateInvoiceTotal } from '@/lib/invoice-utils'
import { logger } from '@/lib/logger'
import { cascadeJobUpdate } from '@/lib/cascading-updates'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    
    // Validate request body
    const validationResult = updateJobSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }
    
    const {
      locationId,
      subcontractorId,
      date,
      startTime,
      startWindowBegin,
      startWindowEnd,
      clientRate,
      subcontractorRate,
      status,
      subcontractorPaid,
      notes,
      isTrial,
      trialNotes,
    } = validationResult.data

    // All job updates now happen in a transaction to prevent race conditions
    // The job state is checked INSIDE the transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Get current job state INSIDE the transaction (prevents race conditions)
      const currentJob = await tx.job.findUnique({
        where: { id: resolvedParams.id },
        select: {
          invoiced: true,
          subcontractorPaid: true,
          status: true,
          scheduleId: true,
          date: true,
          location: {
            include: {
              client: true,
            },
          },
        },
      })

      if (!currentJob) {
        return { error: 'Job not found' as const, status: 404 as const }
      }

      // Validate rescheduling: prevent changing date, rates, or location for invoiced/paid jobs
      if (date !== undefined || clientRate !== undefined || subcontractorRate !== undefined || locationId !== undefined) {
        if (currentJob.invoiced) {
          return {
            error: 'Cannot reschedule or modify a job that has been invoiced. Please delete the invoice first.' as const,
            status: 400 as const,
          }
        }

        if (currentJob.subcontractorPaid) {
          return {
            error: 'Cannot reschedule or modify a job that has been paid. Please void the payment first.' as const,
            status: 400 as const,
          }
        }

        if (currentJob.status === 'CANCELLED') {
          return {
            error: 'Cannot reschedule or modify a cancelled job. Please change status to SCHEDULED first.' as const,
            status: 400 as const,
          }
        }
      }

      // Handle excluded dates and conflict detection for recurring jobs being rescheduled
      if (date !== undefined && currentJob.scheduleId) {
        const newDate = new Date(date + 'T12:00:00')
        const originalDate = new Date(currentJob.date)
        const originalDateStr = originalDate.toISOString().split('T')[0]

        // Check for conflict on new date (inside transaction)
        // Use noon UTC (same as how jobs are stored) to match correctly
        const conflict = await tx.job.findFirst({
          where: {
            scheduleId: currentJob.scheduleId,
            date: newDate,
            id: { not: resolvedParams.id },
          },
        })

        if (conflict) {
          return {
            error: 'A job already exists for this date. Please choose a different date.' as const,
            status: 400 as const,
          }
        }

        // Add original date to excluded dates if it's not already there
        const schedule = await tx.schedule.findUnique({
          where: { id: currentJob.scheduleId },
        })

        if (schedule) {
          const excludedDates: string[] = schedule.excludedDates 
            ? JSON.parse(schedule.excludedDates) 
            : []

          if (!excludedDates.includes(originalDateStr)) {
            excludedDates.push(originalDateStr)
            await tx.schedule.update({
              where: { id: currentJob.scheduleId },
              data: { excludedDates: JSON.stringify(excludedDates) },
            })
          }
        }
      }

      const updateData: {
        locationId?: string
        subcontractorId?: string | null
        date?: Date
        startTime?: string | null
        startWindowBegin?: string | null
        startWindowEnd?: string | null
        clientRate?: number
        subcontractorRate?: number
        status?: string
        subcontractorPaid?: boolean
        notes?: string | null
        isTrial?: boolean
        trialNotes?: string | null
      } = {}

      if (locationId !== undefined) updateData.locationId = locationId
      if (subcontractorId !== undefined) updateData.subcontractorId = subcontractorId || null
      if (date !== undefined) updateData.date = new Date(date + 'T12:00:00')
      if (startTime !== undefined) updateData.startTime = startTime || null
      if (startWindowBegin !== undefined) updateData.startWindowBegin = startWindowBegin || null
      if (startWindowEnd !== undefined) updateData.startWindowEnd = startWindowEnd || null
      if (clientRate !== undefined) updateData.clientRate = clientRate
      if (subcontractorRate !== undefined) updateData.subcontractorRate = subcontractorRate
      if (status !== undefined) updateData.status = status
      if (subcontractorPaid !== undefined) {
        updateData.subcontractorPaid = subcontractorPaid
      }
      if (notes !== undefined) updateData.notes = notes || null
      if (isTrial !== undefined) updateData.isTrial = isTrial
      if (trialNotes !== undefined) updateData.trialNotes = trialNotes || null

      // Handle cancelled job cleanup
      const isBeingCancelled = status === 'CANCELLED' && currentJob.status !== 'CANCELLED'

      // Handle payment cleanup if unmarking as unpaid
      if (subcontractorPaid === false) {
        const paymentLineItems = await tx.subcontractorPaymentLineItem.findMany({
          where: { jobId: resolvedParams.id },
          include: {
            payment: {
              include: {
                lineItems: true,
              },
            },
          },
        })
        
        for (const lineItem of paymentLineItems) {
          if (lineItem.payment.lineItems.length === 1) {
            await tx.subcontractorPayment.delete({
              where: { id: lineItem.payment.id },
            })
          }
        }
      }

      // Handle cancelled job cleanup
      if (isBeingCancelled) {
        // Find all invoices that include this job
        const invoices = await tx.invoice.findMany({
          where: {
            lineItems: {
              some: {
                jobId: resolvedParams.id,
              },
            },
          },
          select: {
            id: true,
            status: true,
          },
        })

        // For DRAFT invoices, remove the job and recalculate
        for (const invoice of invoices) {
          if (invoice.status === 'DRAFT') {
            // Delete line items for this job
            await tx.invoiceLineItem.deleteMany({
              where: {
                invoiceId: invoice.id,
                jobId: resolvedParams.id,
              },
            })

            // Recalculate invoice total
            const remainingLineItems = await tx.invoiceLineItem.findMany({
              where: { invoiceId: invoice.id },
              select: { amount: true },
            })
            const newTotal = remainingLineItems.reduce((sum, item) => sum + item.amount, 0)
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { totalAmount: newTotal },
            })

            logger.info(`[PUT] Removed cancelled job from DRAFT invoice ${invoice.id} and recalculated total`)
          }
          // For SENT/PAID invoices, keep the job in the invoice (historical record)
        }

        // Unmark job as invoiced if it was in a DRAFT invoice
        const draftInvoices = invoices.filter(inv => inv.status === 'DRAFT')
        if (draftInvoices.length > 0) {
          await tx.job.update({
            where: { id: resolvedParams.id },
            data: { invoiced: false },
          })
        }
      }
      
      // Update the job
      const updatedJob = await tx.job.update({
        where: { id: resolvedParams.id },
        data: updateData,
        include: {
          location: {
            include: {
              client: true,
            },
          },
          subcontractor: true,
        },
      })

      return { job: updatedJob, isBeingCancelled }
    }, {
      maxWait: 10000, // 10 seconds max wait for transaction slot
      timeout: 30000, // 30 seconds max for the entire transaction
    })

    // Handle error responses from inside the transaction
    if ('error' in result && result.error) {
      return createErrorResponse(result.error, result.status || 400, 'CONSTRAINT_ERROR')
    }

    // At this point, we know result contains job and isBeingCancelled
    const { job, isBeingCancelled } = result as { job: typeof result extends { job: infer J } ? J : never; isBeingCancelled: boolean }

    // Revalidate all job-related pages
    revalidateJobPages(job.location.client.id)
    if (isBeingCancelled) {
      revalidateInvoicePages(job.location.client.id)
    }

    // Trigger cascading updates (fire-and-forget — only does cache revalidation, not critical DB writes)
    cascadeJobUpdate(job.id, 'update', job.subcontractorId || null, job.location.client.id).catch(() => {})

    return NextResponse.json(job)
  } catch (error) {
    return handleApiError(error, 'Failed to update job')
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)

    // Check if job is already invoiced
    const job = await prisma.job.findUnique({
      where: { id: resolvedParams.id },
      select: { invoiced: true },
    })

    if (!job) {
      return createErrorResponse('Job not found', 404, 'NOT_FOUND')
    }

    // Get job with location info before deleting (for revalidation)
    const jobToDelete = await prisma.job.findUnique({
      where: { id: resolvedParams.id },
      include: {
        location: {
          include: {
            client: true,
          },
        },
      },
    })

    if (!jobToDelete) {
      return createErrorResponse('Job not found', 404, 'NOT_FOUND')
    }

    if (jobToDelete.invoiced) {
      return createErrorResponse(
        'Cannot delete a job that has been invoiced. Please delete the invoice first.',
        400,
        'CONSTRAINT_ERROR'
      )
    }

    const deletedSubcontractorId = jobToDelete.subcontractorId
    const deletedClientId = jobToDelete.location.client.id

    await prisma.job.delete({
      where: { id: resolvedParams.id },
    })

    // Revalidate all job-related pages
    revalidateJobPages(deletedClientId)

    // Trigger cascading updates (fire-and-forget)
    cascadeJobUpdate(resolvedParams.id, 'delete', deletedSubcontractorId || null, deletedClientId).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'Failed to delete job')
  }
}
