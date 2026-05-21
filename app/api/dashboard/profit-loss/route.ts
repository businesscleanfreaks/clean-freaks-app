import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns"
import { logger } from "@/lib/logger"
import { requireAuth } from "@/lib/auth"
import { projectSchedulesForMonth, type ProjectableSchedule } from "@/lib/schedule-projection"

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString())
    const month = parseInt(searchParams.get("month") || new Date().getMonth().toString())

    const monthStart = startOfMonth(new Date(year, month, 1))
    const monthEnd = endOfMonth(new Date(year, month, 1))
    const now = new Date()
    const isPastMonth = monthEnd < startOfDay(now)

    let revenue = 0
    let addOnRevenue = 0
    let totalWorkerPayments = 0
    let addOnWorkerPayments = 0

    if (isPastMonth) {
      // ── PAST MONTHS: Use actual Job records (historical actuals) ──
      const jobs = await prisma.job.findMany({
        where: {
          date: { gte: monthStart, lte: monthEnd },
          status: { in: ['COMPLETED'] },
          location: {
            client: {
              isActive: true,
            },
          },
        },
        include: {
          location: { include: { client: true } },
          schedule: {
            include: {
              recurringAddOnServices: { where: { isRecurring: true } },
            },
          },
          addOnServices: true,
        },
      })

      // Group jobs by client-schedule for proper FLAT_RATE handling
      const jobsByClientSchedule = new Map<string, typeof jobs>()
      jobs.forEach(job => {
        const key = `${job.location.client.id}-${job.scheduleId || 'one-off'}`
        if (!jobsByClientSchedule.has(key)) {
          jobsByClientSchedule.set(key, [])
        }
        jobsByClientSchedule.get(key)!.push(job)
      })

      // Track which schedules we've already counted recurring add-ons for
      const countedScheduleAddOns = new Set<string>()

      jobsByClientSchedule.forEach((groupedJobs) => {
        if (groupedJobs.length === 0) return
        const isRecurring = groupedJobs[0].scheduleId !== null
        const schedule = groupedJobs[0].schedule
        const clientPayType = schedule?.clientPayType || 'PER_CLEAN'

        // Revenue: base rates
        if (clientPayType === 'FLAT_RATE' && isRecurring) {
          revenue += groupedJobs[0].clientRate || 0
        } else {
          revenue += groupedJobs.reduce((sum, job) => sum + (job.clientRate || 0), 0)
        }

        // Revenue: recurring add-ons (for ALL schedule types, not just FLAT_RATE)
        if (schedule?.recurringAddOnServices && !countedScheduleAddOns.has(schedule.id)) {
          countedScheduleAddOns.add(schedule.id)
          schedule.recurringAddOnServices.forEach((addon: { clientRate: number }) => {
            addOnRevenue += addon.clientRate || 0
          })
        }

        // Revenue: job-level add-ons (one-time)
        groupedJobs.forEach(job => {
          if (job.addOnServices) {
            job.addOnServices.forEach((addon: { clientRate: number }) => {
              addOnRevenue += addon.clientRate || 0
            })
          }
        })
      })

      // Worker payments: same logic with same FLAT_RATE grouping
      const countedScheduleWorkerAddOns = new Set<string>()

      jobsByClientSchedule.forEach((groupedJobs) => {
        if (groupedJobs.length === 0) return
        const isRecurring = groupedJobs[0].scheduleId !== null
        const schedule = groupedJobs[0].schedule
        const subPayType = schedule?.subcontractorPayType || 'PER_CLEAN'

        if (subPayType === 'FLAT_RATE' && isRecurring) {
          totalWorkerPayments += groupedJobs[0].subcontractorRate || 0
        } else {
          totalWorkerPayments += groupedJobs.reduce((sum, job) => sum + (job.subcontractorRate || 0), 0)
        }

        // Recurring add-on cleaner costs (for ALL schedule types)
        if (schedule?.recurringAddOnServices && !countedScheduleWorkerAddOns.has(schedule.id)) {
          countedScheduleWorkerAddOns.add(schedule.id)
          schedule.recurringAddOnServices.forEach((addon: { subcontractorRate: number }) => {
            addOnWorkerPayments += addon.subcontractorRate || 0
          })
        }

        // Job-level add-on cleaner costs
        groupedJobs.forEach(job => {
          if (job.addOnServices) {
            job.addOnServices.forEach((addon: { subcontractorRate: number }) => {
              addOnWorkerPayments += addon.subcontractorRate || 0
            })
          }
        })
      })

      revenue += addOnRevenue
      totalWorkerPayments += addOnWorkerPayments
    } else {
      // ── CURRENT + FUTURE MONTHS: Project from active schedules ──
      // Uses exact schedule date math to determine how many jobs fall in
      // the target month, then multiplies by rates. Works for any month.
      const schedules = await prisma.schedule.findMany({
        where: {
          isActive: true,
          location: {
            client: {
              isActive: true,
            },
          },
        },
        include: {
          recurringAddOnServices: { where: { isRecurring: true } },
        },
      })

      const projection = projectSchedulesForMonth(
        schedules as unknown as ProjectableSchedule[],
        year,
        month
      )

      revenue = projection.revenue
      totalWorkerPayments = projection.workerPayments
      addOnRevenue = projection.addOnRevenue
      addOnWorkerPayments = projection.addOnWorkerPayments
    }

    // ── EXPENSES (from Expense table) ──
    const expensesStart = startOfDay(monthStart)
    const expensesEnd = endOfDay(monthEnd)

    const expenses = await prisma.expense.findMany({
      where: {
        date: { gte: expensesStart, lte: expensesEnd },
      },
    })

    const fixedExpenses = expenses
      .filter(exp => exp.type === 'FIXED')
      .reduce((sum, exp) => sum + exp.amount, 0)

    const variableExpenses = expenses
      .filter(exp => exp.type === 'VARIABLE')
      .reduce((sum, exp) => sum + exp.amount, 0)

    const cleanerPayFromExpenses = expenses
      .filter(exp => exp.isCleanerPay === true)
      .reduce((sum, exp) => sum + exp.amount, 0)

    const uncategorizedExpenses = expenses
      .filter(exp => exp.type === null || exp.type === 'UNCATEGORIZED')
      .reduce((sum, exp) => sum + exp.amount, 0)

    // Cleaner pay is already counted via job subcontractorRate (workerPayments).
    // Exclude cleanerPayFromExpenses from otherExpenses to avoid double-counting.
    const otherExpenses = fixedExpenses + variableExpenses + uncategorizedExpenses

    return NextResponse.json({
      revenue,
      addOnRevenue,
      workerPayments: totalWorkerPayments,
      addOnWorkerPayments,
      otherExpenses,
      fixedExpenses,
      variableExpenses,
      cleanerPayFromExpenses,
      uncategorizedExpenses,
    })
  } catch (error) {
    logger.error("Error fetching profit/loss:", error)
    return NextResponse.json(
      { error: "Failed to fetch profit/loss data" },
      { status: 500 }
    )
  }
}
