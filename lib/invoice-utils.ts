import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

// Re-export pure calculation functions (kept in separate file to avoid Prisma dependency in tests)
export {
  generatePerCleanLineItems,
  generateFlatRateLineItems,
  calculateReadyToBillTotal,
  type InvoiceJob,
  type LineItemResult,
} from '@/lib/invoice-calculations'

/**
 * Recalculates the total amount of an invoice based on its line items
 * @param invoiceId - The ID of the invoice to recalculate
 * @returns The updated invoice with recalculated total
 */
export async function recalculateInvoiceTotal(invoiceId: string) {
  try {
    // Fetch all line items for the invoice
    const lineItems = await prisma.invoiceLineItem.findMany({
      where: { invoiceId },
      select: { amount: true },
    })

    // Sum all line item amounts
    const newTotal = lineItems.reduce((sum, item) => sum + item.amount, 0)

    // Update the invoice total
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { totalAmount: newTotal },
      include: {
        client: true,
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
            addOnService: true,
          },
        },
      },
    })

    logger.info(`[recalculateInvoiceTotal] Invoice ${invoiceId} total recalculated to ${newTotal}`)
    return updatedInvoice
  } catch (error) {
    logger.error(`[recalculateInvoiceTotal] Error recalculating invoice ${invoiceId}:`, error)
    throw error
  }
}

/**
 * Validates if a job can be included in an invoice
 * @param jobId - The ID of the job to validate
 * @returns Object with isValid flag and error message if invalid
 */
export async function validateJobForInvoice(jobId: string): Promise<{
  isValid: boolean
  error?: string
}> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        invoiced: true,
      },
    })

    if (!job) {
      return {
        isValid: false,
        error: 'Job not found',
      }
    }

    if (job.status === 'CANCELLED') {
      return {
        isValid: false,
        error: 'Cannot invoice a cancelled job',
      }
    }

    if (job.invoiced) {
      return {
        isValid: false,
        error: 'Job has already been invoiced',
      }
    }

    return { isValid: true }
  } catch (error) {
    logger.error(`[validateJobForInvoice] Error validating job ${jobId}:`, error)
    return {
      isValid: false,
      error: 'Error validating job',
    }
  }
}
