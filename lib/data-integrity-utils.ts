import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Validates if a job can be rescheduled
 * @param jobId - The ID of the job to validate
 * @returns Object with isValid flag and error message if invalid
 */
export async function validateJobForReschedule(jobId: string): Promise<{
  isValid: boolean
  error?: string
}> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        invoiced: true,
        subcontractorPaid: true,
        status: true,
      },
    })

    if (!job) {
      return {
        isValid: false,
        error: 'Job not found',
      }
    }

    if (job.invoiced) {
      return {
        isValid: false,
        error: 'Cannot reschedule a job that has been invoiced. Please delete the invoice first.',
      }
    }

    if (job.subcontractorPaid) {
      return {
        isValid: false,
        error: 'Cannot reschedule a job that has been paid. Please void the payment first.',
      }
    }

    if (job.status === 'CANCELLED') {
      return {
        isValid: false,
        error: 'Cannot reschedule a cancelled job. Please change status to SCHEDULED first.',
      }
    }

    return { isValid: true }
  } catch (error) {
    logger.error(`[validateJobForReschedule] Error validating job ${jobId}:`, error)
    return {
      isValid: false,
      error: 'Error validating job',
    }
  }
}

/**
 * Validates if an add-on can be deleted
 * @param addOnId - The ID of the add-on to validate
 * @returns Object with isValid flag and error message if invalid
 */
export async function validateAddOnForDeletion(addOnId: string): Promise<{
  isValid: boolean
  error?: string
  hasPaidInvoice?: boolean
}> {
  try {
    const addOn = await prisma.addOnService.findUnique({
      where: { id: addOnId },
      include: {
        job: {
          include: {
            invoiceLineItems: {
              include: {
                invoice: {
                  select: {
                    id: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        invoiceLineItems: {
          include: {
            invoice: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    })

    if (!addOn) {
      return {
        isValid: false,
        error: 'Add-on service not found',
      }
    }

    // Check if add-on is in any paid invoices
    const hasPaidInvoice = addOn.job?.invoiceLineItems.some(
      item => item.invoice?.status === 'PAID'
    ) || addOn.invoiceLineItems.some(
      item => item.invoice?.status === 'PAID'
    )

    if (hasPaidInvoice) {
      return {
        isValid: false,
        error: 'Cannot delete add-on service: job has a paid invoice',
        hasPaidInvoice: true,
      }
    }

    return { isValid: true, hasPaidInvoice: false }
  } catch (error) {
    logger.error(`[validateAddOnForDeletion] Error validating add-on ${addOnId}:`, error)
    return {
      isValid: false,
      error: 'Error validating add-on',
    }
  }
}

/**
 * Handles cleanup when a job is cancelled
 * @param jobId - The ID of the job being cancelled
 * @returns Object with success flag and details about what was cleaned up
 */
export async function cleanupCancelledJob(jobId: string): Promise<{
  success: boolean
  invoicesUpdated: string[]
  error?: string
}> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        invoiceLineItems: {
          include: {
            invoice: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    })

    if (!job) {
      return {
        success: false,
        invoicesUpdated: [],
        error: 'Job not found',
      }
    }

    const invoicesUpdated: string[] = []

    // For DRAFT invoices, remove the job and recalculate
    const draftInvoices = job.invoiceLineItems
      .filter(item => item.invoice?.status === 'DRAFT')
      .map(item => item.invoice!.id)

    for (const invoiceId of draftInvoices) {
      // This will be handled by the transaction in the API route
      invoicesUpdated.push(invoiceId)
    }

    return {
      success: true,
      invoicesUpdated,
    }
  } catch (error) {
    logger.error(`[cleanupCancelledJob] Error cleaning up cancelled job ${jobId}:`, error)
    return {
      success: false,
      invoicesUpdated: [],
      error: 'Error cleaning up cancelled job',
    }
  }
}


