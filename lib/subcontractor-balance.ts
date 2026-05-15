import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getBillingStartDate } from '@/lib/billing-settings'
import { endOfDay, format } from 'date-fns'

/**
 * Recalculates the total amount owed to a subcontractor
 * Includes job rates and add-on subcontractor rates
 * Uses "assumed completion" model: past SCHEDULED jobs count as completed
 * @param subcontractorId - The ID of the subcontractor
 * @returns The calculated balance (total amount owed)
 */
export async function recalculateSubcontractorBalance(subcontractorId: string): Promise<number> {
  try {
    const billingStartDate = await getBillingStartDate()
    const today = endOfDay(new Date())

    // Fetch all unpaid jobs for subcontractor, including add-ons
    // Assumed completion model: past SCHEDULED jobs are treated as completed
    const unpaidJobs = await prisma.job.findMany({
      where: {
        subcontractorId,
        subcontractorPaid: false,
        OR: [
          // Explicitly completed jobs
          { status: 'COMPLETED' },
          // Past scheduled jobs (assumed completed)
          { status: 'SCHEDULED', date: { lte: today } },
        ],
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
      },
      include: {
        addOnServices: true,
        location: {
          include: {
            client: true,
          },
        },
        schedule: true,
      },
    })

    if (unpaidJobs.length === 0) {
      return 0
    }

    // Group jobs by client, schedule, and month to handle FLAT_RATE vs PER_CLEAN
    const jobsByClientSchedule = new Map<string, typeof unpaidJobs>()
    unpaidJobs.forEach(job => {
      const monthKey = format(new Date(job.date), 'yyyy-MM')
      const key = `${job.location.client.id}-${job.scheduleId || 'one-off'}-${monthKey}`
      if (!jobsByClientSchedule.has(key)) {
        jobsByClientSchedule.set(key, [])
      }
      jobsByClientSchedule.get(key)!.push(job)
    })

    let totalBalance = 0

    jobsByClientSchedule.forEach((jobsGroup) => {
      if (jobsGroup.length === 0) return

      const isRecurring = jobsGroup[0].scheduleId !== null
      const subPayType = jobsGroup[0].schedule?.subcontractorPayType || 'PER_CLEAN'

      if (subPayType === 'FLAT_RATE' && isRecurring) {
        // For FLAT_RATE recurring jobs, only count the monthly rate once
        const firstJob = jobsGroup[0]
        totalBalance += firstJob.subcontractorRate

        // Add add-on subcontractor rates from every unpaid job in this month
        jobsGroup.forEach(job => {
          job.addOnServices.forEach(addOn => {
            totalBalance += addOn.subcontractorRate
          })
        })
      } else {
        // For PER_CLEAN or one-off jobs, sum all rates
        jobsGroup.forEach(job => {
          totalBalance += job.subcontractorRate

          // Add add-on subcontractor rates for this job
          job.addOnServices.forEach(addOn => {
            totalBalance += addOn.subcontractorRate
          })
        })
      }
    })

    logger.debug(`[recalculateSubcontractorBalance] Subcontractor ${subcontractorId} balance: ${totalBalance}`)
    return totalBalance
  } catch (error) {
    logger.error(`[recalculateSubcontractorBalance] Error calculating balance for subcontractor ${subcontractorId}:`, error)
    throw error
  }
}

