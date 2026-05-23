import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns"
import { logger } from "@/lib/logger"
import { requireAuth } from "@/lib/auth"

export const dynamic = 'force-dynamic'

type TimePeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly"

function getDateRange(period: TimePeriod): { start: Date; end: Date } {
  const now = new Date()
  
  switch (period) {
    case "daily":
      return {
        start: startOfDay(now),
        end: endOfDay(now),
      }
    case "weekly":
      return {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      }
    case "monthly":
      return {
        start: startOfMonth(now),
        end: endOfMonth(now),
      }
    case "quarterly":
      return {
        start: startOfQuarter(now),
        end: endOfQuarter(now),
      }
    case "yearly":
      return {
        start: startOfYear(now),
        end: endOfYear(now),
      }
  }
}

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const period = (searchParams.get("period") || "monthly") as TimePeriod
    const startDateParam = searchParams.get("startDate")
    const endDateParam = searchParams.get("endDate")
    
    // Use custom date range if provided, otherwise use period-based range
    const dateRange = startDateParam && endDateParam
      ? {
          start: startOfDay(new Date(startDateParam)),
          end: endOfDay(new Date(endDateParam)),
        }
      : getDateRange(period)
    
    // Calculate MRR: Sum of all active FLAT_RATE client monthly rates
    const activeSchedules = await prisma.schedule.findMany({
      where: {
        isActive: true,
        location: {
          client: {
            isActive: true,
            billingType: "FLAT_RATE",
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
    })

    // Group by client to avoid double-counting
    const clientMRRMap = new Map<string, number>()
    activeSchedules.forEach(schedule => {
      const clientId = schedule.location.client.id
      if (!clientMRRMap.has(clientId)) {
        clientMRRMap.set(clientId, schedule.defaultClientRate)
      }
    })
    
    const mrr = Array.from(clientMRRMap.values()).reduce((sum, rate) => sum + rate, 0)
    const recurringClients = clientMRRMap.size

    // Calculate Income: Paid invoices + uninvoiced completed jobs within date range
    const paidInvoices = await prisma.invoice.findMany({
      where: {
        status: "PAID",
        dateCreated: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    })
    
    const invoiceIncome = paidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0)

    // Get uninvoiced completed jobs within date range, including add-ons
    const uninvoicedJobs = await prisma.job.findMany({
      where: {
        status: "COMPLETED",
        invoiced: false,
        date: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        addOnServices: true,
        schedule: true,
      },
    })

    // Calculate income from uninvoiced jobs (handle FLAT_RATE correctly)
    const jobsByClientSchedule = new Map<string, typeof uninvoicedJobs>()
    uninvoicedJobs.forEach(job => {
      const key = `${job.location.client.id}-${job.scheduleId || 'one-off'}`
      if (!jobsByClientSchedule.has(key)) {
        jobsByClientSchedule.set(key, [])
      }
      jobsByClientSchedule.get(key)!.push(job)
    })

    let uninvoicedIncome = 0
    jobsByClientSchedule.forEach((jobs) => {
      if (jobs.length === 0) return
      
      const isRecurring = jobs[0].scheduleId !== null
      const schedule = jobs[0].schedule
      const clientPayType = schedule?.clientPayType || 'PER_CLEAN'

      if (clientPayType === 'FLAT_RATE' && isRecurring) {
        const firstJob = jobs[0]
        uninvoicedIncome += firstJob.clientRate
        // Add add-on client rates
        firstJob.addOnServices.forEach(addOn => {
          uninvoicedIncome += addOn.clientRate
        })
      } else {
        uninvoicedIncome += jobs.reduce((sum, job) => {
          let jobTotal = job.clientRate
          // Add add-on client rates
          job.addOnServices.forEach(addOn => {
            jobTotal += addOn.clientRate
          })
          return sum + jobTotal
        }, 0)
      }
    })

    const income = invoiceIncome + uninvoicedIncome

    // Calculate Expenses: Subcontractor payments within date range + unpaid balances
    const payments = await prisma.subcontractorPayment.findMany({
      where: {
        datePaid: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    })

    const paidExpenses = payments.reduce((sum, payment) => sum + payment.totalAmount, 0)

    // Get unpaid completed jobs within date range, including add-ons
    const unpaidJobs = await prisma.job.findMany({
      where: {
        status: "COMPLETED",
        subcontractorPaid: false,
        subcontractorId: {
          not: null,
        },
        date: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        addOnServices: true, // Include add-on services
        schedule: true, // Include schedule for FLAT_RATE handling
      },
    })

    // Calculate unpaid expenses (handle FLAT_RATE correctly)
    const unpaidJobsBySubSchedule = new Map<string, typeof unpaidJobs>()
    unpaidJobs.forEach(job => {
      const key = `${job.subcontractorId}-${job.scheduleId || 'one-off'}`
      if (!unpaidJobsBySubSchedule.has(key)) {
        unpaidJobsBySubSchedule.set(key, [])
      }
      unpaidJobsBySubSchedule.get(key)!.push(job)
    })

    let unpaidExpenses = 0
    unpaidJobsBySubSchedule.forEach((jobs) => {
      if (jobs.length === 0) return
      
      const isRecurring = jobs[0].scheduleId !== null
      const unpaidSchedule = jobs[0].schedule
      const subPayType = unpaidSchedule?.subcontractorPayType || 'PER_CLEAN'

      if (subPayType === 'FLAT_RATE' && isRecurring) {
        const firstJob = jobs[0]
        unpaidExpenses += firstJob.subcontractorRate
        // Add add-on subcontractor rates
        firstJob.addOnServices.forEach(addOn => {
          unpaidExpenses += addOn.subcontractorRate
        })
      } else {
        unpaidExpenses += jobs.reduce((sum, job) => {
          let jobTotal = job.subcontractorRate
          // Add add-on subcontractor rates
          job.addOnServices.forEach(addOn => {
            jobTotal += addOn.subcontractorRate
          })
          return sum + jobTotal
        }, 0)
      }
    })

    // Calculate cleaner pay expenses (subcontractor payments)
    const cleanerPayExpenses = paidExpenses + unpaidExpenses

    // Get all business expenses from Expense model (includes fixed, variable, uncategorized)
    const businessExpenses = await prisma.expense.findMany({
      where: {
        date: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    })

    const totalBusinessExpenses = businessExpenses.reduce((sum, exp) => sum + exp.amount, 0)
    const fixedExpenses = businessExpenses
      .filter(exp => exp.type === 'FIXED')
      .reduce((sum, exp) => sum + exp.amount, 0)
    const variableExpenses = businessExpenses
      .filter(exp => exp.type === 'VARIABLE')
      .reduce((sum, exp) => sum + exp.amount, 0)
    const uncategorizedExpenses = businessExpenses
      .filter(exp => exp.type === null || exp.type === 'UNCATEGORIZED')
      .reduce((sum, exp) => sum + exp.amount, 0)
    
    // Cleaner pay from Expense model (if tracked there)
    const cleanerPayFromExpenses = businessExpenses
      .filter(exp => exp.isCleanerPay === true)
      .reduce((sum, exp) => sum + exp.amount, 0)

    // Total expenses = all business expenses + cleaner pay (subcontractor payments)
    // Note: cleanerPayFromExpenses might overlap with cleanerPayExpenses if tracked in both places
    // For now, use cleanerPayExpenses (from subcontractor payments) as the source of truth for cleaner pay
    const totalExpenses = totalBusinessExpenses + cleanerPayExpenses

    return NextResponse.json(
      {
        mrr,
        income,
        expenses: totalExpenses, // Total expenses (all business expenses + cleaner pay)
        cleanerPay: cleanerPayExpenses, // Cleaner pay from subcontractor payments
        fixedExpenses,
        variableExpenses,
        uncategorizedExpenses,
        businessExpenses: totalBusinessExpenses, // All expenses from Expense model
        recurringClients,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    )
  } catch (error) {
    logger.error("Error fetching business metrics:", error)
    return NextResponse.json(
      { error: "Failed to fetch business metrics" },
      { status: 500 }
    )
  }
}
