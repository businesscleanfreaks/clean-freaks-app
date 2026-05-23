import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, subWeeks, format } from "date-fns"
import { logger } from "@/lib/logger"
import { getBillingStartDate } from "@/lib/billing-settings"

export const dynamic = 'force-dynamic'

// Invoice frequency options
type InvoiceFrequency = 'AFTER_EACH_CLEAN' | 'BI_WEEKLY' | 'END_OF_MONTH' | 'CUSTOM'

// Invoices data API for instant page loads
// Supports pagination: ?limit=50&cursor=<invoiceId>
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const cursor = searchParams.get('cursor')
    const period = searchParams.get('period') || 'all'

    const now = new Date()
    const currentMonthStart = startOfMonth(now)
    const currentMonthEnd = endOfMonth(now)

    // Parse billing period filter (yyyy-MM format or 'all')
    let periodStart: Date | null = null
    let periodEnd: Date | null = null
    if (period !== 'all') {
      const [year, month] = period.split('-').map(Number)
      if (year && month) {
        periodStart = startOfMonth(new Date(year, month - 1))
        periodEnd = endOfMonth(new Date(year, month - 1))
      }
    }

    // For bi-weekly: current 2-week period (last 2 weeks)
    const biWeeklyStart = subWeeks(startOfWeek(now), 1)
    const biWeeklyEnd = endOfWeek(now)

    // Get billing start date to filter out historical jobs
    const billingStartDate = await getBillingStartDate()

    const [
      invoices,
      draftsCount,
      waitingCount,
      paidCount,
      allUninvoicedJobs,
    ] = await prisma.$transaction([
      // Get invoices with cursor-based pagination (fetch one extra to detect hasMore)
      prisma.invoice.findMany({
        where: {
          status: { not: 'VOID' },
        },
        include: {
          client: true,
          lineItems: true,
        },
        orderBy: {
          dateCreated: 'desc',
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      // Get accurate counts from DB (not from the paginated list)
      prisma.invoice.count({ where: { status: 'DRAFT' } }),
      prisma.invoice.count({ where: { status: 'SENT' } }),
      prisma.invoice.count({ where: { status: 'PAID' } }),
      // Get all uninvoiced, non-cancelled jobs
      prisma.job.findMany({
        where: {
          invoiced: false,
          status: { not: "CANCELLED" },
          ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
        },
        include: {
          location: {
            include: {
              client: true,
            },
          },
          schedule: {
            include: {
              recurringAddOnServices: true,
            },
          },
          addOnServices: true,
        },
        orderBy: {
          date: 'asc',
        },
      }),
    ])

    const hasMore = invoices.length > limit
    if (hasMore) invoices.pop()
    const nextCursor = hasMore ? invoices[invoices.length - 1]?.id : null

    // Group by client based on their invoiceFrequency setting
    type JobWithRelations = typeof allUninvoicedJobs[0]
    type ClientEntry = {
      client: JobWithRelations['location']['client'] & { invoiceFrequency?: string },
      jobs: JobWithRelations[],
      totalAmount: number,
      billingType: string,
      invoiceFrequency: InvoiceFrequency,
      jobsThisMonth: number,
      completedJobs: number,
      scheduledJobs: number,
    }
    
    const clientJobsMap = new Map<string, ClientEntry>()

    allUninvoicedJobs.forEach(job => {
      const client = job.location.client as ClientEntry['client']
      const clientId = client.id
      const invoiceFrequency = (client.invoiceFrequency || 'END_OF_MONTH') as InvoiceFrequency
      
      // Filter jobs based on invoice frequency
      let includeJob = false
      
      switch (invoiceFrequency) {
        case 'AFTER_EACH_CLEAN':
          includeJob = job.status === 'COMPLETED'
          break
        case 'BI_WEEKLY':
          includeJob = job.status === 'COMPLETED' && 
                       job.date >= biWeeklyStart && 
                       job.date <= biWeeklyEnd
          break
        case 'END_OF_MONTH':
          if (periodStart && periodEnd) {
            // Specific month selected: show jobs from that month
            includeJob = job.date >= periodStart && job.date <= periodEnd
          } else {
            // "All" selected: show all uninvoiced non-cancelled jobs
            includeJob = true
          }
          break
        case 'CUSTOM':
          includeJob = true
          break
      }
      
      if (!includeJob) return
      
      if (!clientJobsMap.has(clientId)) {
        clientJobsMap.set(clientId, {
          client,
          jobs: [],
          totalAmount: 0,
          billingType: job.schedule?.clientPayType || client.billingType,
          invoiceFrequency,
          jobsThisMonth: 0,
          completedJobs: 0,
          scheduledJobs: 0,
        })
      }
      
      const entry = clientJobsMap.get(clientId)!
      entry.jobs.push(job)
      
      if (job.status === 'COMPLETED') {
        entry.completedJobs++
      } else {
        entry.scheduledJobs++
      }
      
      if (job.date >= currentMonthStart && job.date <= currentMonthEnd) {
        entry.jobsThisMonth++
      }
    })

    // Calculate totals per client (including all add-ons)
    clientJobsMap.forEach((entry) => {
      if (entry.billingType === 'FLAT_RATE' && entry.invoiceFrequency === 'END_OF_MONTH') {
        // Group by schedule + month so flat rate is charged per month
        const scheduleMonthRates = new Map<string, number>()
        const scheduleMonthAddOnTotals = new Map<string, number>()
        let oneOffTotal = 0

        entry.jobs.forEach(job => {
          if (job.scheduleId) {
            const monthKey = `${job.scheduleId}-${format(job.date, 'yyyy-MM')}`
            if (!scheduleMonthRates.has(monthKey)) {
              // Use schedule rate (source of truth) instead of job rate
              const scheduleRate = job.schedule?.defaultClientRate ?? job.clientRate
              scheduleMonthRates.set(monthKey, scheduleRate)

              // Add recurring add-on totals (once per schedule per month)
              const recurringAddOns = job.schedule?.recurringAddOnServices || []
              const addOnTotal = recurringAddOns.reduce((sum: number, a: { clientRate: number }) => sum + a.clientRate, 0)
              scheduleMonthAddOnTotals.set(monthKey, addOnTotal)
            }
          } else {
            oneOffTotal += job.clientRate
          }

          // Add one-time add-ons from individual jobs
          job.addOnServices.forEach((addOn: { clientRate: number }) => {
            oneOffTotal += addOn.clientRate
          })
        })

        const recurringTotal = Array.from(scheduleMonthRates.values()).reduce((sum, rate) => sum + rate, 0)
        const recurringAddOnTotal = Array.from(scheduleMonthAddOnTotals.values()).reduce((sum, rate) => sum + rate, 0)
        entry.totalAmount = recurringTotal + recurringAddOnTotal + oneOffTotal
      } else {
        // PER_CLEAN: sum all job rates + all add-ons
        entry.totalAmount = entry.jobs.reduce((sum, job) => {
          const jobAddOns = job.addOnServices.reduce((s: number, a: { clientRate: number }) => s + a.clientRate, 0)
          return sum + job.clientRate + jobAddOns
        }, 0)
      }
    })

    const readyToBill = Array.from(clientJobsMap.values())
      .sort((a, b) => a.client.name.localeCompare(b.client.name))
    const flatRateClients = readyToBill.filter(entry => entry.billingType === 'FLAT_RATE')
    const perCleanClients = readyToBill.filter(entry => entry.billingType === 'PER_CLEAN')

    const totalReadyToBill = readyToBill.reduce((sum, entry) => sum + entry.totalAmount, 0)

    // Serialize dates
    type JobType = typeof allUninvoicedJobs[0]
    const serializeJobs = (jobs: JobType[]) =>
      jobs.map(job => ({
        ...job,
        date: job.date.toISOString(),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      }))

    const serializedFlatRate = flatRateClients.map(entry => ({
      ...entry,
      jobs: serializeJobs(entry.jobs),
      completedJobs: entry.completedJobs,
      scheduledJobs: entry.scheduledJobs,
      invoiceFrequency: entry.invoiceFrequency,
    }))

    const serializedPerClean = perCleanClients.map(entry => ({
      ...entry,
      jobs: serializeJobs(entry.jobs),
      completedJobs: entry.completedJobs,
      scheduledJobs: entry.scheduledJobs,
      invoiceFrequency: entry.invoiceFrequency,
    }))

    const serializedInvoices = invoices.map(inv => ({
      ...inv,
      dateCreated: inv.dateCreated?.toISOString() || new Date().toISOString(),
      dateDue: inv.dateDue?.toISOString() || null,
      datePaid: inv.datePaid?.toISOString() || null,
      createdAt: inv.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: inv.updatedAt?.toISOString() || inv.createdAt?.toISOString() || new Date().toISOString(),
    }))

    return NextResponse.json(
      {
        invoices: serializedInvoices,
        hasMore,
        nextCursor,
        flatRateClients: serializedFlatRate,
        perCleanClients: serializedPerClean,
        totalReadyToBill,
        draftsCount,
        waitingCount,
        paidCount,
        readyCount: readyToBill.length,
      },
      {
        headers: {
          'Cache-Control': 's-maxage=15, stale-while-revalidate=60',
        },
      }
    )
  } catch (error) {
    logger.error('Invoices data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch invoices data' },
      { status: 500 }
    )
  }
}
