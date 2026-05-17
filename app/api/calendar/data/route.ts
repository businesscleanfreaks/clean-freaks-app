import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { ensureJobsForDateRange } from "@/lib/regenerate-schedule-jobs"

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Calendar data API for instant page loads
export async function GET() {
  try {
    await requireAuth()
    // Load 1 month of past data and 2 months of future data
    const today = new Date()
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59)

    await ensureJobsForDateRange({ startDate, endDate })

    const [jobs, clients, subcontractors] = await Promise.all([
      prisma.job.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          locationId: true,
          subcontractorId: true,
          scheduleId: true,
          date: true,
          startTime: true,
          startWindowBegin: true,
          startWindowEnd: true,
          clientRate: true,
          subcontractorRate: true,
          status: true,
          invoiced: true,
          subcontractorPaid: true,
          createdAt: true,
          updatedAt: true,
          location: {
            select: {
              id: true,
              name: true,
              address: true,
              clientId: true,
              client: {
                select: {
                  id: true,
                  name: true,
                  billingType: true,
                  cleanerPayType: true,
                  isActive: true,
                  createdAt: true,
                },
              },
            },
          },
          schedule: {
            select: {
              id: true,
              frequency: true,
              daysOfWeek: true,
              monthlyPattern: true,
              timeType: true,
              startTime: true,
              startWindowBegin: true,
              startWindowEnd: true,
              defaultClientRate: true,
              defaultSubcontractorRate: true,
              clientPayType: true,
              subcontractorPayType: true,
              startDate: true,
              endDate: true,
              excludedDates: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              locationId: true,
              subcontractorId: true,
            },
          },
          subcontractor: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              isActive: true,
            },
          },
          addOnServices: {
            select: {
              id: true,
              description: true,
              clientRate: true,
              subcontractorRate: true,
              frequency: true,
              isRecurring: true,
            },
          },
          invoiceLineItems: {
            select: {
              id: true,
              invoiceId: true,
              amount: true,
              description: true,
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  status: true,
                  dateCreated: true,
                  datePaid: true,
                },
              },
            },
          },
        },
        orderBy: {
          date: 'asc',
        },
      }),
      prisma.client.findMany({
        select: {
          id: true,
          name: true,
          phone: true,
          communicationEmail: true,
          invoicingEmail: true,
          billingType: true,
          cleanerPayType: true,
          isActive: true,
          createdAt: true,
          locations: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      }),
      prisma.subcontractor.findMany({
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          createdAt: true,
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },
      }),
    ])

    // Serialize dates for JSON
    // Note: cast to any[] because prisma client types may be stale (needs prisma generate)
    const serializedJobs = (jobs as any[]).map((job: any) => ({
      ...job,
      date: job.date.toISOString(),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      schedule: job.schedule ? {
        ...job.schedule,
        startDate: job.schedule.startDate.toISOString(),
        endDate: job.schedule.endDate?.toISOString() || null,
        createdAt: job.schedule.createdAt.toISOString(),
        updatedAt: job.schedule.updatedAt.toISOString(),
      } : null,
      location: {
        ...job.location,
        client: {
          ...job.location.client,
          createdAt: job.location.client.createdAt.toISOString(),
        },
      },
      subcontractor: job.subcontractor ? {
        ...job.subcontractor,
        createdAt: job.subcontractor.createdAt.toISOString(),
      } : null,
      invoiceLineItems: job.invoiceLineItems.map((item: any) => ({
        ...item,
        invoice: item.invoice ? {
          ...item.invoice,
          dateCreated: item.invoice.dateCreated.toISOString(),
          datePaid: item.invoice.datePaid?.toISOString() || null,
        } : null,
      })),
    }))

    const serializedClients = clients.map(client => ({
      ...client,
      createdAt: client.createdAt.toISOString(),
    }))

    const serializedSubcontractors = subcontractors.map(sub => ({
      ...sub,
      createdAt: sub.createdAt.toISOString(),
    }))

    // Deduplicate only true recurring duplicates. Different schedules at the
    // same location may legitimately create separate jobs on the same day.
    const jobsByScheduleDate = new Map<string, typeof serializedJobs>()
    for (const job of serializedJobs) {
      const dateStr = job.date.split('T')[0]
      const key = job.scheduleId ? `${job.scheduleId}-${dateStr}` : `job-${job.id}`
      const existing = jobsByScheduleDate.get(key)
      if (existing) {
        existing.push(job)
      } else {
        jobsByScheduleDate.set(key, [job])
      }
    }

    const dedupedJobs: typeof serializedJobs = []
    let duplicatesFound = 0
    for (const [, group] of jobsByScheduleDate) {
      if (group.length > 1) {
        duplicatesFound += group.length - 1
        // Sort: prefer COMPLETED, then invoiced/paid, then oldest
        group.sort((a, b) => {
          if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return -1
          if (b.status === 'COMPLETED' && a.status !== 'COMPLETED') return 1
          if (a.invoiced && !b.invoiced) return -1
          if (b.invoiced && !a.invoiced) return 1
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        })
      }
      dedupedJobs.push(group[0])
    }

    if (duplicatesFound > 0) {
      logger.warn(`[calendar] Found ${duplicatesFound} duplicate jobs (same schedule + date). Showing only one per date.`)
    }

    return NextResponse.json({
      jobs: dedupedJobs,
      clients: serializedClients,
      subcontractors: serializedSubcontractors,
    })
  } catch (error) {
    logger.error('Calendar data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch calendar data' },
      { status: 500 }
    )
  }
}
