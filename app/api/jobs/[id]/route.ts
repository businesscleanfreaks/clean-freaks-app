import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateJobPages, revalidateInvoicePages } from '@/lib/revalidate'
import { updateJobSchema } from '@/lib/validations'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { logger } from '@/lib/logger'
import { cascadeJobUpdate } from '@/lib/cascading-updates'
import { hasFinalInvoice } from '@/lib/invoice-status'

async function recalculateDraftInvoiceTotal(invoiceId: string, tx: any) {
  const lineItems = await tx.invoiceLineItem.findMany({
    where: { invoiceId },
    select: { amount: true },
  })
  const totalAmount = lineItems.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0)
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { totalAmount },
  })
}

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
      vendorId,
      date,
      startTime,
      startWindowBegin,
      startWindowEnd,
      clientRate,
      subcontractorRate,
      status,
      subcontractorPaid,
      vendorPaid,
      cancellationFee,
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
          vendorPaid: true,
          status: true,
          scheduleId: true,
          vendorId: true,
          date: true,
          clientRate: true,
          subcontractorRate: true,
          schedule: {
            select: {
              defaultClientRate: true,
              defaultSubcontractorRate: true,
            },
          },
          location: {
            include: {
              client: true,
            },
          },
          invoiceLineItems: {
            include: {
              invoice: {
                select: { id: true, status: true },
              },
            },
          },
        },
      })

      if (!currentJob) {
        return { error: 'Job not found' as const, status: 404 as const }
      }

      // Validate rescheduling: prevent changing date, rates, or location for invoiced/paid jobs
      if (date !== undefined || clientRate !== undefined || subcontractorRate !== undefined || locationId !== undefined) {
        if (hasFinalInvoice(currentJob.invoiceLineItems)) {
          return {
            error: 'Cannot reschedule or modify a job that is on a sent or paid invoice. Void or reset the invoice first.' as const,
            status: 400 as const,
          }
        }

        if (currentJob.subcontractorPaid) {
          return {
            error: 'Cannot reschedule or modify a job that has been paid. Please void the payment first.' as const,
            status: 400 as const,
          }
        }

        if (currentJob.vendorPaid) {
          return {
            error: 'Cannot reschedule or modify a job that has been paid to a vendor. Please void the vendor payment first.' as const,
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

      if ((vendorId !== undefined || subcontractorId !== undefined) && (currentJob.subcontractorPaid || currentJob.vendorPaid)) {
        return {
          error: 'Cannot change who performed a job after it has been paid. Please void the payment first.' as const,
          status: 400 as const,
        }
      }

      if (vendorId && currentJob.scheduleId) {
        return {
          error: 'Vendor-performed jobs must be standalone one-off jobs.' as const,
          status: 400 as const,
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
        vendorId?: string | null
        date?: Date
        startTime?: string | null
        startWindowBegin?: string | null
        startWindowEnd?: string | null
        clientRate?: number
        subcontractorRate?: number
        status?: string
        subcontractorPaid?: boolean
        vendorPaid?: boolean
        cancellationFee?: number | null
        notes?: string | null
        isTrial?: boolean
        trialNotes?: string | null
      } = {}

      if (locationId !== undefined) updateData.locationId = locationId
      if (subcontractorId !== undefined) {
        updateData.subcontractorId = subcontractorId || null
        if (subcontractorId) {
          updateData.vendorId = null
          updateData.vendorPaid = false
        } else if (vendorId === undefined && currentJob.vendorId) {
          updateData.vendorId = null
          updateData.vendorPaid = false
        }
      }
      if (vendorId !== undefined) {
        updateData.vendorId = vendorId || null
        if (vendorId) {
          updateData.subcontractorId = null
          updateData.subcontractorPaid = false
        } else {
          updateData.vendorPaid = false
        }
      }
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
      if (vendorPaid !== undefined) {
        updateData.vendorPaid = vendorPaid
      }
      if (cancellationFee !== undefined) {
        updateData.cancellationFee = cancellationFee && cancellationFee > 0 ? cancellationFee : null
      }
      if (notes !== undefined) updateData.notes = notes || null
      if (isTrial !== undefined) updateData.isTrial = isTrial
      if (trialNotes !== undefined) updateData.trialNotes = trialNotes || null

      // Handle cancelled job cleanup
      const isBeingCancelled = status === 'CANCELLED' && currentJob.status !== 'CANCELLED'
      const isBeingRestored = status === 'SCHEDULED' && currentJob.status === 'CANCELLED'

      // Skipped recurring cleans intentionally zero their rates while cancelled.
      // Restoring without an explicit override should recover schedule defaults.
      if (isBeingRestored) {
        if (clientRate === undefined && currentJob.clientRate === 0 && currentJob.schedule) {
          updateData.clientRate = currentJob.schedule.defaultClientRate
        }
        if (subcontractorRate === undefined && currentJob.subcontractorRate === 0 && currentJob.schedule) {
          updateData.subcontractorRate = currentJob.schedule.defaultSubcontractorRate
        }
        // A restored clean is no longer a cancellation — drop any fee that was attached.
        if (cancellationFee === undefined) {
          updateData.cancellationFee = null
        }
      }

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
          } else {
            await tx.subcontractorPaymentLineItem.delete({
              where: { id: lineItem.id },
            })
            await tx.subcontractorPayment.update({
              where: { id: lineItem.payment.id },
              data: {
                totalAmount: Math.max(0, lineItem.payment.totalAmount - lineItem.amount),
              },
            })
          }
        }
      }

      if (vendorPaid === false) {
        const paymentLineItems = await tx.vendorPaymentLineItem.findMany({
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
            await tx.vendorPayment.delete({
              where: { id: lineItem.payment.id },
            })
          } else {
            await tx.vendorPaymentLineItem.delete({
              where: { id: lineItem.id },
            })
            await tx.vendorPayment.update({
              where: { id: lineItem.payment.id },
              data: {
                totalAmount: Math.max(0, lineItem.payment.totalAmount - lineItem.amount),
              },
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
          vendor: true,
        },
      })

      if (clientRate !== undefined || date !== undefined || startTime !== undefined || startWindowBegin !== undefined || startWindowEnd !== undefined) {
        const draftLineItems = await tx.invoiceLineItem.findMany({
          where: {
            jobId: resolvedParams.id,
            invoice: { status: 'DRAFT' },
          },
          include: {
            invoice: {
              select: { id: true },
            },
          },
        })

        const invoiceIds = Array.from(new Set(draftLineItems.map(item => item.invoice.id)))
        for (const item of draftLineItems) {
          await tx.invoiceLineItem.update({
            where: { id: item.id },
            data: {
              amount: updatedJob.clientRate ?? item.amount,
              description: `Cleaning - ${updatedJob.location.client.name} - ${updatedJob.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            },
          })
        }

        for (const invoiceId of invoiceIds) {
          await recalculateDraftInvoiceTotal(invoiceId, tx)
        }
      }

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
    cascadeJobUpdate(job.id, 'update', job.subcontractorId || null, job.location.client.id)
      .catch((err) => logger.error('[cascadeJobUpdate] Error after job update:', err))

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

    // Get job with location info before deleting (for revalidation)
    const jobToDelete = await prisma.job.findUnique({
      where: { id: resolvedParams.id },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        invoiceLineItems: {
          include: {
            invoice: {
              select: { id: true, status: true },
            },
          },
        },
        vendorPaymentLineItems: {
          select: { id: true },
        },
      },
    })

    if (!jobToDelete) {
      return createErrorResponse('Job not found', 404, 'NOT_FOUND')
    }

    if (hasFinalInvoice(jobToDelete.invoiceLineItems)) {
      return createErrorResponse(
        'Cannot delete a job that is on a sent or paid invoice. Void or reset the invoice first.',
        400,
        'CONSTRAINT_ERROR'
      )
    }

    if (jobToDelete.vendorPaymentLineItems.length > 0) {
      return createErrorResponse(
        'Cannot delete a job that has been paid to a vendor. Void or remove the vendor payment first.',
        400,
        'CONSTRAINT_ERROR'
      )
    }

    const deletedSubcontractorId = jobToDelete.subcontractorId
    const deletedClientId = jobToDelete.location.client.id

    await prisma.$transaction(async (tx) => {
      const draftInvoiceIds = Array.from(new Set(
        jobToDelete.invoiceLineItems
          .filter(item => item.invoice?.status === 'DRAFT')
          .map(item => item.invoice!.id)
      ))

      if (draftInvoiceIds.length > 0) {
        await tx.invoiceLineItem.deleteMany({
          where: {
            jobId: resolvedParams.id,
            invoiceId: { in: draftInvoiceIds },
          },
        })

        for (const invoiceId of draftInvoiceIds) {
          await recalculateDraftInvoiceTotal(invoiceId, tx)
        }
      }

      await tx.job.delete({
        where: { id: resolvedParams.id },
      })
    })

    // Revalidate all job-related pages
    revalidateJobPages(deletedClientId)

    // Trigger cascading updates (fire-and-forget)
    cascadeJobUpdate(resolvedParams.id, 'delete', deletedSubcontractorId || null, deletedClientId)
      .catch((err) => logger.error('[cascadeJobUpdate] Error after job delete:', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'Failed to delete job')
  }
}
