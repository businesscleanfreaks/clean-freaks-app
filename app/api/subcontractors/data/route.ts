import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getBillingStartDate } from "@/lib/billing-settings"
import { isJobPayable } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo } from "@/lib/payment-cadence"

// Subcontractors data API for instant page loads
export async function GET() {
  try {
    const subcontractors = await prisma.subcontractor.findMany({
      orderBy: {
        name: 'asc',
      },
    })

    const subcontractorIds = subcontractors.map(sub => sub.id)

    // Get billing start date to filter out historical jobs
    const billingStartDate = await getBillingStartDate()

    // Fetch all unpaid jobs (completed OR past scheduled = assumed completion model)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    const allUnpaidJobs = await prisma.job.findMany({
      where: {
        subcontractorId: { in: subcontractorIds },
        subcontractorPaid: false,
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
        OR: [
          { status: 'COMPLETED' },
          { status: 'SCHEDULED', date: { lte: today } },
        ],
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        addOnServices: true,
        schedule: true,
        invoiceLineItems: {
          include: {
            invoice: {
              select: { status: true },
            },
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    })

    // Fetch all payments in one query
    const allPayments = await prisma.subcontractorPayment.findMany({
      where: {
        subcontractorId: { in: subcontractorIds },
      },
      include: {
        lineItems: {
          include: {
            job: {
              include: {
                location: {
                  include: {
                    client: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        datePaid: 'desc',
      },
    })

    // Group jobs and payments by subcontractor
    const jobsBySubcontractor = new Map<string, typeof allUnpaidJobs>()
    const paymentsBySubcontractor = new Map<string, typeof allPayments>()

    allUnpaidJobs.forEach(job => {
      if (job.subcontractorId) {
        if (!jobsBySubcontractor.has(job.subcontractorId)) {
          jobsBySubcontractor.set(job.subcontractorId, [])
        }
        jobsBySubcontractor.get(job.subcontractorId)!.push(job)
      }
    })

    allPayments.forEach(payment => {
      if (!paymentsBySubcontractor.has(payment.subcontractorId)) {
        paymentsBySubcontractor.set(payment.subcontractorId, [])
      }
      paymentsBySubcontractor.get(payment.subcontractorId)!.push(payment)
    })

    // Map subcontractors with their jobs and payments
    const result = subcontractors.map(sub => {
      const allJobs = jobsBySubcontractor.get(sub.id) || []
      const payments = paymentsBySubcontractor.get(sub.id) || []

      // Build schedule map for cadence lookups
      const scheduleMap = new Map<string | null, CadenceScheduleInfo | null>()
      allJobs.forEach(job => {
        if (job.scheduleId && job.schedule && !scheduleMap.has(job.scheduleId)) {
          scheduleMap.set(job.scheduleId, {
            paymentCadenceOverride: job.schedule.paymentCadenceOverride ?? null,
          })
        }
      })

      // Filter jobs through cadence rules
      const cadenceSub: CadenceSubcontractorInfo = {
        paymentCadence: sub.paymentCadence,
        excludeClientIds: sub.excludeClientIds,
      }
      const jobs = allJobs.filter(job => {
        const schedule = job.scheduleId ? (scheduleMap.get(job.scheduleId) || null) : null
        return isJobPayable(job, cadenceSub, schedule)
      })
      
      // Calculate owed amount with FLAT_RATE handling (only from cadence-filtered jobs)
      const jobsByClientSchedule = new Map<string, typeof jobs>()
      jobs.forEach(job => {
        const key = `${job.location.client.id}-${job.scheduleId || 'one-off'}`
        if (!jobsByClientSchedule.has(key)) {
          jobsByClientSchedule.set(key, [])
        }
        jobsByClientSchedule.get(key)!.push(job)
      })
      
      let owedAmount = 0
      jobsByClientSchedule.forEach((jobsGroup) => {
        if (jobsGroup.length === 0) return
        
        const schedule = jobsGroup[0].schedule
        const isRecurring = jobsGroup[0].scheduleId !== null
        
        if (schedule?.subcontractorPayType === 'FLAT_RATE' && isRecurring) {
          const firstJob = jobsGroup[0]
          owedAmount += firstJob.subcontractorRate
          firstJob.addOnServices.forEach(addOn => {
            owedAmount += addOn.subcontractorRate
          })
        } else {
          jobsGroup.forEach(job => {
            owedAmount += job.subcontractorRate
            job.addOnServices.forEach(addOn => {
              owedAmount += addOn.subcontractorRate
            })
          })
        }
      })

      // Serialize dates
      const serializedJobs = jobs.map(job => ({
        ...job,
        date: job.date.toISOString(),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        location: {
          ...job.location,
          client: {
            ...job.location.client,
            createdAt: job.location.client.createdAt.toISOString(),
          },
        },
        schedule: job.schedule ? {
          ...job.schedule,
          startDate: job.schedule.startDate.toISOString(),
          endDate: job.schedule.endDate?.toISOString() || null,
          createdAt: job.schedule.createdAt.toISOString(),
          updatedAt: job.schedule.updatedAt.toISOString(),
        } : null,
      }))

      const serializedPayments = payments.map(payment => ({
        ...payment,
        datePaid: payment.datePaid.toISOString(),
        createdAt: payment.createdAt.toISOString(),
        lineItems: payment.lineItems.map(item => ({
          ...item,
          job: item.job ? {
            ...item.job,
            date: item.job.date.toISOString(),
            createdAt: item.job.createdAt.toISOString(),
            updatedAt: item.job.updatedAt.toISOString(),
            location: {
              ...item.job.location,
              client: {
                ...item.job.location.client,
                createdAt: item.job.location.client.createdAt.toISOString(),
              },
            },
          } : null,
        })),
      }))

      return {
        ...sub,
        createdAt: sub.createdAt.toISOString(),
        owedAmount,
        jobs: serializedJobs,
        payments: serializedPayments,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Subcontractors data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch subcontractors data' },
      { status: 500 }
    )
  }
}
