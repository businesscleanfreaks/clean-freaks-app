import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subDays } from "date-fns"
import { requireAuth } from "@/lib/auth"
import { getAvgOccurrencesPerMonth } from "@/lib/frequency-utils"
import { getBillingStartDate } from "@/lib/billing-settings"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { isJobPayable } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo } from "@/lib/payment-cadence"
import { buildSubcontractorPayLedger } from "@/lib/payout-calculator"

export const dynamic = 'force-dynamic'

// Dashboard stats API - fetched client-side for instant page loads
export async function GET() {
  try {
    await requireAuth()
    const now = new Date()
    const todayStart = startOfDay(now)
    const thirtyDaysAgo = subDays(now, 30)
    const monthStart = startOfMonth(now)
    const monthEnd = endOfMonth(now)

    // Get billing start date to filter out historical jobs from balance calculations
    const billingStartDate = await getBillingStartDate()
    const billingDateFilter = billingStartDate ? { date: { gte: billingStartDate } } : {}

    const todayEnd = endOfDay(now)

    const [
      recurringClientsCount,
      completedUninvoicedJobs,
      completedUnpaidJobs,
      totalJobsThisMonth,
      unassignedJobsCount,
      jobsTodayCount,
      jobsCompletedTodayCount,
      overdueInvoicesCount,
      pendingInvoicesCount,
      pendingInvoices,
      activeSchedules,
      recurringAddOns,
      sentInvoices,
      todaysJobs,
    ] = await prisma.$transaction([
      // Recurring clients (with active schedules)
      prisma.client.count({
        where: {
          isActive: true,
          locations: {
            some: {
              schedules: {
                some: {
                  isActive: true,
                  startDate: {
                    lte: todayStart,
                  },
                  OR: [
                    { endDate: null },
                    {
                      endDate: {
                        gte: todayStart,
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      }),
      // Uninvoiced jobs (assumed completion: past SCHEDULED + COMPLETED)
      prisma.job.findMany({
        where: {
          invoiced: false,
          OR: [
            { status: "COMPLETED" },
            { status: "SCHEDULED", date: { lte: todayEnd } },
          ],
          ...billingDateFilter,
        },
        include: {
          location: {
            include: {
              client: true,
            },
          },
          schedule: {
            include: {
              location: {
                include: {
                  client: true,
                },
              },
            },
          },
        },
      }),
      // Unpaid subcontractor jobs (assumed completion: past SCHEDULED + COMPLETED)
      prisma.job.findMany({
        where: {
          subcontractorPaid: false,
          subcontractorId: {
            not: null,
          },
          OR: [
            { status: "COMPLETED" },
            { status: "SCHEDULED", date: { lte: todayEnd } },
          ],
          ...billingDateFilter,
        },
        include: {
          subcontractor: true,
          location: {
            include: {
              client: true,
            },
          },
          schedule: true,
          invoiceLineItems: {
            include: {
              invoice: { select: { status: true } },
            },
          },
        },
      }),
      prisma.job.count({
        where: {
          date: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      }),
      // Jobs still needing a cleaner: no assignee on the job AND no default cleaner on the linked schedule.
      // (Many recurring jobs inherit the schedule's cleaner even when job.subcontractorId is null.)
      prisma.job.count({
        where: {
          status: "SCHEDULED",
          date: {
            gte: startOfDay(now),
          },
          AND: [
            { subcontractorId: null },
            {
              OR: [
                { scheduleId: null },
                { schedule: { subcontractorId: null } },
              ],
            },
          ],
        },
      }),
      // Jobs scheduled for today
      prisma.job.count({
        where: {
          date: {
            gte: startOfDay(now),
            lte: endOfDay(now),
          },
          status: "SCHEDULED",
        },
      }),
      // Jobs completed today
      prisma.job.count({
        where: {
          date: {
            gte: startOfDay(now),
            lte: endOfDay(now),
          },
          status: "COMPLETED",
        },
      }),
      // Overdue invoices (sent but not paid, older than 30 days)
      prisma.invoice.count({
        where: {
          status: "SENT",
          dateCreated: {
            lte: thirtyDaysAgo,
          },
        },
      }),
      // Pending/draft invoices count
      prisma.invoice.count({
        where: {
          status: "DRAFT",
        },
      }),
      // Pending invoices with amounts
      prisma.invoice.findMany({
        where: {
          status: "DRAFT",
        },
      }),
      // Active schedules for MRR calculation
      prisma.schedule.findMany({
        where: {
          isActive: true,
          startDate: {
            lte: todayStart,
          },
          OR: [
            { endDate: null },
            {
              endDate: {
                gte: todayStart,
              },
            },
          ],
          location: {
            client: {
              isActive: true,
            },
          },
        },
        include: {
          location: {
            include: {
              client: true,
            },
          },
        },
      }),
      // Recurring add-ons for MRR calculation
      prisma.addOnService.findMany({
        where: {
          isRecurring: true,
          schedule: {
            isActive: true,
            startDate: {
              lte: todayStart,
            },
            OR: [
              { endDate: null },
              {
                endDate: {
                  gte: todayStart,
                },
              },
            ],
            location: {
              client: {
                isActive: true,
              },
            },
          },
        },
        include: {
          schedule: {
            include: {
              location: {
                include: {
                  client: true,
                },
              },
            },
          },
        },
      }),
      // Sent invoices (waiting for payment) for Money to Collect
      prisma.invoice.findMany({
        where: {
          status: "SENT",
        },
      }),
      // Today's jobs for dashboard job list
      prisma.job.findMany({
        where: {
          date: {
            gte: startOfDay(now),
            lte: endOfDay(now),
          },
          status: { in: ["SCHEDULED", "COMPLETED"] },
        },
        include: {
          location: {
            include: {
              client: true,
            },
          },
          subcontractor: true,
        },
        orderBy: [
          { startTime: 'asc' },
          { date: 'asc' },
        ],
      }),
    ])

    // Calculate MRR from active schedules
    const clientMRRMap = new Map<string, number>()

    activeSchedules.forEach((schedule) => {
      const client = schedule.location.client
      const clientId = client.id
      const clientPayType = schedule.clientPayType || 'PER_CLEAN'
      const defaultClientRate = schedule.defaultClientRate || 0

      let scheduleMonthlyRevenue = 0

      if (clientPayType === 'FLAT_RATE') {
        scheduleMonthlyRevenue = defaultClientRate
      } else {
        const cleansPerMonth = getAverageScheduleOccurrencesPerMonth({
          frequency: schedule.frequency,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          daysOfWeek: schedule.daysOfWeek,
          monthlyPattern: schedule.monthlyPattern,
          customDates: schedule.customDates,
          excludedDates: schedule.excludedDates,
        })
        scheduleMonthlyRevenue = defaultClientRate * cleansPerMonth
      }

      const currentMRR = clientMRRMap.get(clientId) || 0
      clientMRRMap.set(clientId, currentMRR + scheduleMonthlyRevenue)
    })

    recurringAddOns.forEach(addon => {
      const clientId = addon.schedule!.location.client.id
      const multiplier = getAvgOccurrencesPerMonth(addon.frequency || 'MONTHLY')
      const addonMonthlyRevenue = addon.clientRate * multiplier

      const currentMRR = clientMRRMap.get(clientId) || 0
      clientMRRMap.set(clientId, currentMRR + addonMonthlyRevenue)
    })

    const mrr = Array.from(clientMRRMap.values()).reduce((sum, rate) => sum + rate, 0)

    // Calculate average monthly subcontractor cost
    const clientSubcontractorCostMap = new Map<string, number>()

    activeSchedules.forEach((schedule) => {
      const client = schedule.location.client
      const clientId = client.id
      const subcontractorPayType = schedule.subcontractorPayType || 'PER_CLEAN'
      const defaultSubcontractorRate = schedule.defaultSubcontractorRate || 0
      
      let scheduleMonthlySubcontractorCost = 0
      
      if (subcontractorPayType === 'FLAT_RATE') {
        scheduleMonthlySubcontractorCost = defaultSubcontractorRate
      } else {
        const cleansPerMonth = getAverageScheduleOccurrencesPerMonth({
          frequency: schedule.frequency,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          daysOfWeek: schedule.daysOfWeek,
          monthlyPattern: schedule.monthlyPattern,
          customDates: schedule.customDates,
          excludedDates: schedule.excludedDates,
        })
        scheduleMonthlySubcontractorCost = defaultSubcontractorRate * cleansPerMonth
      }

      const currentCost = clientSubcontractorCostMap.get(clientId) || 0
      clientSubcontractorCostMap.set(clientId, currentCost + scheduleMonthlySubcontractorCost)
    })

    recurringAddOns.forEach(addon => {
      const clientId = addon.schedule!.location.client.id
      const multiplier = getAvgOccurrencesPerMonth(addon.frequency || 'MONTHLY')
      const addonMonthlySubcontractorCost = addon.subcontractorRate * multiplier

      const currentCost = clientSubcontractorCostMap.get(clientId) || 0
      clientSubcontractorCostMap.set(clientId, currentCost + addonMonthlySubcontractorCost)
    })

    const avgMonthlySubcontractorCost = Array.from(clientSubcontractorCostMap.values()).reduce((sum, cost) => sum + cost, 0)
    const recurringProfit = mrr - avgMonthlySubcontractorCost

    // Calculate outstanding client balance
    const clientJobsMap = new Map<string, typeof completedUninvoicedJobs>()
    completedUninvoicedJobs.forEach(job => {
      const clientId = job.location.client.id
      if (!clientJobsMap.has(clientId)) {
        clientJobsMap.set(clientId, [])
      }
      clientJobsMap.get(clientId)!.push(job)
    })

    let outstandingClientBalance = 0
    clientJobsMap.forEach((jobs) => {
      if (jobs.length === 0) return
      
      const recurringJobs = jobs.filter(job => job.scheduleId !== null)
      const oneOffJobs = jobs.filter(job => job.scheduleId === null)
      
      if (recurringJobs.length > 0) {
        const schedule = recurringJobs[0].schedule
        if (schedule) {
          const clientPayType = schedule.clientPayType || 'PER_CLEAN'
          if (clientPayType === 'FLAT_RATE') {
            outstandingClientBalance += (schedule.defaultClientRate || 0)
          } else {
            outstandingClientBalance += recurringJobs.reduce((sum, job) => sum + (job.clientRate || 0), 0)
          }
        } else {
          outstandingClientBalance += recurringJobs.reduce((sum, job) => sum + (job.clientRate || 0), 0)
        }
      }
      
      outstandingClientBalance += oneOffJobs.reduce((sum, job) => sum + (job.clientRate || 0), 0)
    })

    // Calculate pending invoices amount
    const pendingInvoicesAmount = pendingInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)

    // Calculate pending subcontractor payouts (with FLAT_RATE handling + cadence filtering)
    // Filter unpaid jobs through cadence rules per subcontractor
    const cadenceFilteredUnpaidJobs = completedUnpaidJobs.filter(job => {
      if (!job.subcontractor) return true // safety
      
      const cadenceSub: CadenceSubcontractorInfo = {
        paymentCadence: job.subcontractor.paymentCadence,
        excludeClientIds: job.subcontractor.excludeClientIds,
      }
      const cadenceSchedule: CadenceScheduleInfo | null = job.schedule ? {
        paymentCadenceOverride: job.schedule.paymentCadenceOverride ?? null
      } : null

      return isJobPayable(job, cadenceSub, cadenceSchedule)
    })

    const { totalOwed: pendingPayoutsTotal } = buildSubcontractorPayLedger(cadenceFilteredUnpaidJobs)
    
    // Calculate unique subcontractors owed
    const uniqueSubcontractorsOwed = new Set(
      cadenceFilteredUnpaidJobs
        .filter(j => j.subcontractorId)
        .map(j => j.subcontractorId)
    ).size

    // Sent invoices totals (Money to Collect)
    const sentInvoicesCount = sentInvoices.length
    const sentInvoicesAmount = sentInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)

    // Today's jobs mapped for frontend
    const todaysJobsList = todaysJobs.map(job => ({
      id: job.id,
      clientName: job.location.client.name,
      locationName: job.location.name,
      cleanerName: job.subcontractor?.name || null,
      startTime: job.startTime || null,
      status: job.status,
    }))

    return NextResponse.json({
      mrr,
      recurringProfit,
      recurringClientsCount,
      outstandingClientBalance,
      totalJobsThisMonth,
      jobsTodayCount,
      jobsCompletedTodayCount,
      overdueInvoicesCount,
      pendingInvoicesCount,
      pendingInvoicesAmount,
      unassignedJobsCount,
      pendingPayoutsCount: uniqueSubcontractorsOwed,
      pendingPayoutsTotal,
      sentInvoicesCount,
      sentInvoicesAmount,
      todaysJobsList,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}
