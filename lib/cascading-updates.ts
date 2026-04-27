import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import { recalculateSubcontractorBalance } from './subcontractor-balance'

/**
 * Invalidates dashboard cache to force recalculation
 */
export function invalidateDashboardCache() {
  try {
    revalidatePath('/')
    revalidatePath('/dashboard')
    logger.debug('[cascading-updates] Dashboard cache invalidated')
  } catch (error) {
    logger.error('[cascading-updates] Error invalidating dashboard cache:', error)
  }
}

/**
 * Revalidates all pages that might be affected by subcontractor changes
 */
export function revalidateSubcontractorRelatedPages(subcontractorId?: string) {
  try {
    revalidatePath('/subcontractors')
    revalidatePath('/')
    if (subcontractorId) {
      revalidatePath(`/subcontractors/${subcontractorId}`)
    }
    logger.debug('[cascading-updates] Subcontractor pages revalidated')
  } catch (error) {
    logger.error('[cascading-updates] Error revalidating subcontractor pages:', error)
  }
}

/**
 * Revalidates all pages that might be affected by job changes
 */
export function revalidateJobRelatedPages(clientId?: string) {
  try {
    revalidatePath('/')
    revalidatePath('/calendar')
    revalidatePath('/subcontractors')
    if (clientId) {
      revalidatePath('/clients')
      revalidatePath(`/clients/${clientId}`)
    }
    logger.debug('[cascading-updates] Job-related pages revalidated')
  } catch (error) {
    logger.error('[cascading-updates] Error revalidating job pages:', error)
  }
}

/**
 * Handles cascading updates when a job is created, updated, or deleted
 * @param jobId - The ID of the job (null for create operations)
 * @param operation - The operation being performed
 * @param subcontractorId - The subcontractor ID (if known)
 * @param clientId - The client ID (if known)
 */
export async function cascadeJobUpdate(
  jobId: string | null,
  operation: 'create' | 'update' | 'delete',
  subcontractorId?: string | null,
  clientId?: string
) {
  try {
    logger.debug(`[cascading-updates] Cascading job ${operation} for job ${jobId || 'new'}`)

    // If we don't have subcontractorId or clientId, fetch the job to get them
    if (!subcontractorId || !clientId) {
      if (jobId) {
        const job = await prisma.job.findUnique({
          where: { id: jobId },
          select: {
            subcontractorId: true,
            location: {
              select: {
                clientId: true,
              },
            },
          },
        })
        if (job) {
          subcontractorId = job.subcontractorId || undefined
          clientId = job.location.clientId
        }
      }
    }

    // Revalidate related pages (these are cache operations, not database operations)
    // They don't need to be in a transaction, but we ensure they all complete
    try {
      revalidateJobRelatedPages(clientId)

      // If job has a subcontractor, revalidate subcontractor pages
      if (subcontractorId) {
        revalidateSubcontractorRelatedPages(subcontractorId)
      }

      // Invalidate dashboard cache
      invalidateDashboardCache()

      logger.debug(`[cascading-updates] Job ${operation} cascade completed`)
    } catch (revalidationError) {
      logger.error(`[cascading-updates] Error during revalidation:`, revalidationError)
      // Continue - revalidation errors shouldn't fail the operation
    }
  } catch (error) {
    // Log error but don't fail the main operation
    logger.error(`[cascading-updates] Error in job cascade for ${operation}:`, error)
  }
}

/**
 * Handles cascading updates when an add-on is created, updated, or deleted
 * @param addOnId - The ID of the add-on (null for create operations)
 * @param operation - The operation being performed
 * @param jobId - The job ID this add-on is associated with
 */
export async function cascadeAddOnUpdate(
  addOnId: string | null,
  operation: 'create' | 'update' | 'delete',
  jobId?: string | null
) {
  try {
    logger.debug(`[cascading-updates] Cascading add-on ${operation} for add-on ${addOnId || 'new'}`)

    // If we don't have jobId, fetch the add-on to get it
    let fetchedJobId = jobId
    let fetchedClientId: string | undefined
    let fetchedSubcontractorId: string | null | undefined

    if (!fetchedJobId && addOnId) {
      const addOn = await prisma.addOnService.findUnique({
        where: { id: addOnId },
        select: {
          jobId: true,
          scheduleId: true,
          job: {
            select: {
              subcontractorId: true,
              location: {
                select: {
                  clientId: true,
                },
              },
            },
          },
          schedule: {
            select: {
              location: {
                select: {
                  clientId: true,
                },
              },
            },
          },
        },
      })
      if (addOn) {
        fetchedJobId = addOn.jobId || undefined
        if (addOn.job) {
          fetchedSubcontractorId = addOn.job.subcontractorId
          fetchedClientId = addOn.job.location.clientId
        } else if (addOn.schedule) {
          fetchedClientId = addOn.schedule.location.clientId
        }
      }
    }

    // Use transaction to ensure all updates happen atomically
    await prisma.$transaction(async (tx) => {
      // If add-on is linked to a job, cascade job update
      if (fetchedJobId) {
        // Revalidate job-related pages
        revalidateJobRelatedPages(fetchedClientId)
        if (fetchedSubcontractorId) {
          revalidateSubcontractorRelatedPages(fetchedSubcontractorId)
        }
      } else {
        // If linked to a schedule, revalidate related pages
        if (fetchedClientId) {
          revalidateJobRelatedPages(fetchedClientId)
        }
      }

      // Invalidate dashboard cache
      invalidateDashboardCache()
    }, {
      timeout: 5000, // 5 second timeout
    })

    logger.debug(`[cascading-updates] Add-on ${operation} cascade completed`)
  } catch (error) {
    // Log error but don't fail the main operation
    logger.error(`[cascading-updates] Error in add-on cascade for ${operation}:`, error)
    // Still try to revalidate pages even if transaction fails
    try {
      invalidateDashboardCache()
    } catch (fallbackError) {
      logger.error(`[cascading-updates] Error in fallback revalidation:`, fallbackError)
    }
  }
}

/**
 * Triggers a full system refresh after significant changes
 * Use this sparingly for operations that affect many entities
 */
export async function triggerSystemRefresh() {
  try {
    logger.debug('[cascading-updates] Triggering full system refresh')
    
    // Revalidate all major pages
    revalidatePath('/')
    revalidatePath('/dashboard')
    revalidatePath('/calendar')
    revalidatePath('/subcontractors')
    revalidatePath('/clients')
    revalidatePath('/invoices')

    logger.debug('[cascading-updates] System refresh completed')
  } catch (error) {
    logger.error('[cascading-updates] Error in system refresh:', error)
  }
}

