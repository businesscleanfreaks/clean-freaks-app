import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { recalculateSubcontractorBalance } from './subcontractor-balance'
import { recalculateInvoiceTotal } from './invoice-utils'

/**
 * Detects and fixes data inconsistencies in the system
 * @returns Object with issues found and fixed
 */
export async function recoverFromInconsistentState(): Promise<{
  issuesFound: string[]
  issuesFixed: string[]
  errors: string[]
}> {
  const issuesFound: string[] = []
  const issuesFixed: string[] = []
  const errors: string[] = []

  try {
    logger.info('[error-recovery] Starting data integrity check...')

    // Check 1: Find invoices with incorrect totals
    const invoices = await prisma.invoice.findMany({
      include: {
        lineItems: true,
      },
    })

    for (const invoice of invoices) {
      const calculatedTotal = invoice.lineItems.reduce((sum, item) => sum + item.amount, 0)
      if (Math.abs(invoice.totalAmount - calculatedTotal) > 0.01) {
        issuesFound.push(`Invoice ${invoice.invoiceNumber} has incorrect total (expected ${calculatedTotal}, found ${invoice.totalAmount})`)
        
        // Only fix non-paid invoices
        if (invoice.status !== 'PAID') {
          try {
            await recalculateInvoiceTotal(invoice.id)
            issuesFixed.push(`Fixed invoice ${invoice.invoiceNumber} total`)
          } catch (error) {
            errors.push(`Failed to fix invoice ${invoice.invoiceNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
      }
    }

    // Check 2: Find jobs that are marked as paid but have no payment record
    const paidJobs = await prisma.job.findMany({
      where: {
        subcontractorPaid: true,
      },
      include: {
        paymentLineItems: true,
      },
    })

    for (const job of paidJobs) {
      if (job.paymentLineItems.length === 0) {
        issuesFound.push(`Job ${job.id} is marked as paid but has no payment record`)
        
        try {
          await prisma.job.update({
            where: { id: job.id },
            data: { subcontractorPaid: false },
          })
          issuesFixed.push(`Unmarked job ${job.id} as unpaid (no payment record found)`)
        } catch (error) {
          errors.push(`Failed to fix job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }

    // Check 3: Find jobs that are marked as invoiced but have no invoice line item
    const invoicedJobs = await prisma.job.findMany({
      where: {
        invoiced: true,
      },
      include: {
        invoiceLineItems: true,
      },
    })

    for (const job of invoicedJobs) {
      if (job.invoiceLineItems.length === 0) {
        issuesFound.push(`Job ${job.id} is marked as invoiced but has no invoice line item`)
        
        try {
          await prisma.job.update({
            where: { id: job.id },
            data: { invoiced: false },
          })
          issuesFixed.push(`Unmarked job ${job.id} as not invoiced (no invoice line item found)`)
        } catch (error) {
          errors.push(`Failed to fix job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }

    logger.info(`[error-recovery] Data integrity check completed. Found ${issuesFound.length} issues, fixed ${issuesFixed.length}`)
    
    return {
      issuesFound,
      issuesFixed,
      errors,
    }
  } catch (error) {
    logger.error('[error-recovery] Error during data integrity check:', error)
    errors.push(`Failed to complete data integrity check: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      issuesFound,
      issuesFixed,
      errors,
    }
  }
}

/**
 * Validates data integrity and returns a report
 * @returns Object with validation results
 */
export async function validateDataIntegrity(): Promise<{
  isValid: boolean
  issues: string[]
}> {
  const issues: string[] = []

  try {
    // Check for common data issues
    const invoices = await prisma.invoice.findMany({
      include: {
        lineItems: true,
      },
    })

    for (const invoice of invoices) {
      const calculatedTotal = invoice.lineItems.reduce((sum, item) => sum + item.amount, 0)
      if (Math.abs(invoice.totalAmount - calculatedTotal) > 0.01) {
        issues.push(`Invoice ${invoice.invoiceNumber} has incorrect total`)
      }
    }

    const paidJobsWithoutPayment = await prisma.job.count({
      where: {
        subcontractorPaid: true,
        paymentLineItems: {
          none: {},
        },
      },
    })

    if (paidJobsWithoutPayment > 0) {
      issues.push(`${paidJobsWithoutPayment} job(s) marked as paid but have no payment record`)
    }

    const invoicedJobsWithoutInvoice = await prisma.job.count({
      where: {
        invoiced: true,
        invoiceLineItems: {
          none: {},
        },
      },
    })

    if (invoicedJobsWithoutInvoice > 0) {
      issues.push(`${invoicedJobsWithoutInvoice} job(s) marked as invoiced but have no invoice line item`)
    }

    return {
      isValid: issues.length === 0,
      issues,
    }
  } catch (error) {
    logger.error('[error-recovery] Error validating data integrity:', error)
    return {
      isValid: false,
      issues: [`Failed to validate data integrity: ${error instanceof Error ? error.message : 'Unknown error'}`],
    }
  }
}

/**
 * Forces recalculation and fix of subcontractor balance
 * @param subcontractorId - The ID of the subcontractor
 * @returns The recalculated balance
 */
export async function fixSubcontractorBalance(subcontractorId: string): Promise<number> {
  try {
    logger.info(`[error-recovery] Fixing subcontractor balance for ${subcontractorId}`)
    const balance = await recalculateSubcontractorBalance(subcontractorId)
    logger.info(`[error-recovery] Subcontractor ${subcontractorId} balance fixed: ${balance}`)
    return balance
  } catch (error) {
    logger.error(`[error-recovery] Error fixing subcontractor balance for ${subcontractorId}:`, error)
    throw error
  }
}


