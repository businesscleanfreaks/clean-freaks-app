import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getBillingStartDate } from "@/lib/billing-settings"
import { isJobPayable } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo } from "@/lib/payment-cadence"
import { buildSubcontractorPayLedger } from "@/lib/payout-calculator"
import { ensureJobsForDateRange } from "@/lib/regenerate-schedule-jobs"

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Subcontractors data API for instant page loads
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const periodParam = url.searchParams.get('period')
    const periodQuery = (() => {
      if (!periodParam) return null
      const [year, month] = periodParam.split('-').map(Number)
      if (!year || !month || month < 1 || month > 12) return null
      return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 0, 23, 59, 59, 999),
      }
    })()

    const subcontractors = await prisma.subcontractor.findMany({
      orderBy: {
        name: 'asc',
      },
    })

    const subcontractorIds = subcontractors.map(sub => sub.id)

    const generationRange = periodQuery ?? {
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999),
    }
    await ensureJobsForDateRange({ startDate: generationRange.start, endDate: generationRange.end })

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

    const allPeriodJobs = periodQuery
      ? await prisma.job.findMany({
          where: {
            subcontractorId: { in: subcontractorIds },
            date: { gte: periodQuery.start, lte: periodQuery.end },
            status: { in: ['COMPLETED', 'SCHEDULED'] },
          },
          include: {
            location: {
              include: {
                client: true,
              },
            },
            addOnServices: true,
            schedule: true,
            paymentLineItems: {
              include: {
                payment: { select: { datePaid: true } },
              },
              take: 1,
            },
          },
          orderBy: {
            date: 'asc',
          },
        })
      : []

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
    const periodJobsBySubcontractor = new Map<string, typeof allPeriodJobs>()
    const paymentsBySubcontractor = new Map<string, typeof allPayments>()

    allUnpaidJobs.forEach(job => {
      if (job.subcontractorId) {
        if (!jobsBySubcontractor.has(job.subcontractorId)) {
          jobsBySubcontractor.set(job.subcontractorId, [])
        }
        jobsBySubcontractor.get(job.subcontractorId)!.push(job)
      }
    })

    allPeriodJobs.forEach(job => {
      if (job.subcontractorId) {
        if (!periodJobsBySubcontractor.has(job.subcontractorId)) {
          periodJobsBySubcontractor.set(job.subcontractorId, [])
        }
        periodJobsBySubcontractor.get(job.subcontractorId)!.push(job)
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
      const periodJobs = periodJobsBySubcontractor.get(sub.id) || []
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
      
      // Calculate owed amount using the centralized helper
      const { totalOwed: owedAmount } = buildSubcontractorPayLedger(jobs)

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

      const serializedPeriodJobs = periodJobs
        .filter(job => job.location && job.location.client)
        .map(job => ({
          id: job.id,
          date: job.date.toISOString(),
          subcontractorRate: job.subcontractorRate,
          subcontractorPaid: job.subcontractorPaid,
          scheduleId: job.scheduleId,
          paidDate: job.paymentLineItems?.[0]?.payment?.datePaid
            ? job.paymentLineItems[0].payment.datePaid.toISOString()
            : null,
          schedule: job.schedule ? {
            subcontractorPayType: job.schedule.subcontractorPayType,
            defaultSubcontractorRate: job.schedule.defaultSubcontractorRate,
          } : null,
          addOnServices: (job.addOnServices || []).map(addOn => ({
            id: addOn.id,
            subcontractorRate: addOn.subcontractorRate,
          })),
          location: {
            id: job.location.id,
            name: job.location.name,
            address: job.location.address,
            client: {
              id: job.location.client.id,
              name: job.location.client.name,
              billingType: job.location.client.billingType,
              cleanerPayType: job.location.client.cleanerPayType,
            },
          },
        }))

      return {
        ...sub,
        createdAt: sub.createdAt.toISOString(),
        owedAmount,
        jobs: serializedJobs,
        payments: serializedPayments,
        ...(periodQuery ? { periodJobs: serializedPeriodJobs } : {}),
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
