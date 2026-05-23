import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfMonth, endOfMonth, startOfDay, format } from "date-fns"
import { formatFrequency, formatPayType, getAvgOccurrencesPerMonth } from "@/lib/frequency-utils"
import { logger } from "@/lib/logger"
import { handleApiError } from "@/lib/api-error-handler"
import { requireAuth } from "@/lib/auth"
import { projectSingleScheduleForMonth, type ProjectableSchedule } from "@/lib/schedule-projection"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getPrimaryScheduleForDisplay, getScheduleLifecycle, sortSchedulesForDisplay } from "@/lib/schedule-timing"

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    logger.debug("[client-overview] Starting request...")

    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString())
    const month = parseInt(searchParams.get("month") || new Date().getMonth().toString())

    const periodStart = startOfMonth(new Date(year, month, 1))
    const periodEnd = endOfMonth(new Date(year, month, 1))
    const now = new Date()
    const isPastMonth = periodEnd < startOfDay(now)

    logger.debug(`[client-overview] Fetching clients for ${year}-${month+1}...`)

    // Get all clients with their schedules, locations, and add-ons
    const clients = await prisma.client.findMany({
      where: {
        isActive: true,
      },
      include: {
        locations: {
          include: {
            schedules: {
              where: { isActive: true },
              include: {
                subcontractor: true,
                recurringAddOnServices: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    logger.debug(`[client-overview] Found ${clients.length} clients`)

    // For past months, fetch actual job records and group by client-schedule
    const pastJobInclude = {
      location: { include: { client: true } },
      schedule: { include: { recurringAddOnServices: { where: { isRecurring: true as const } } } },
      addOnServices: true,
    } as const

    const pastJobs = isPastMonth
      ? await prisma.job.findMany({
          where: {
            date: { gte: periodStart, lte: periodEnd },
            status: { in: ['COMPLETED'] },
            location: {
              client: {
                isActive: true,
              },
            },
          },
          include: pastJobInclude,
        })
      : []

    type PastJob = typeof pastJobs[number]
    const jobsByClientSchedule = new Map<string, PastJob[]>()

    if (isPastMonth) {
      pastJobs.forEach(job => {
        const key = `${job.location.clientId}-${job.scheduleId || 'one-off'}`
        if (!jobsByClientSchedule.has(key)) {
          jobsByClientSchedule.set(key, [])
        }
        jobsByClientSchedule.get(key)!.push(job)
      })

      logger.debug(`[client-overview] Past month: found ${pastJobs.length} completed jobs`)
    }

    // Calculate AVG and Period data for each client
    const clientData = clients.map(client => {
      // Flatten all schedules for this client
      const schedules = client.locations.flatMap(loc => loc.schedules)

      if (schedules.length === 0) {
        return null // Skip clients with no active schedules
      }

      const sortedSchedules = sortSchedulesForDisplay(schedules)
      const primarySchedule = getPrimaryScheduleForDisplay(sortedSchedules) || schedules[0]
      const displaySchedules = sortedSchedules.filter(schedule => getScheduleLifecycle(schedule) !== 'ended')
      const displayFrequencySchedules = displaySchedules.length > 0 ? displaySchedules : sortedSchedules

      const currentAverageSchedules = schedules.filter(
        schedule => getScheduleLifecycle(schedule) === 'current'
      )
      const avgSchedules = currentAverageSchedules.length > 0
        ? currentAverageSchedules
        : primarySchedule
          ? [primarySchedule]
          : []

      // Calculate AVG values (based on the schedule(s) in effect now)
      let avgRevenue = 0
      let avgCleanerCost = 0
      let avgAddonRevenue = 0
      let avgAddonCleanerCost = 0

      // Period values
      let periodRevenue = 0
      let periodCleanerCost = 0
      let periodJobCount = 0

      const subcontractorName = primarySchedule?.subcontractor?.name || 'Unassigned'

      // Collect add-ons for display
      const addOns: string[] = []

      avgSchedules.forEach(schedule => {
        const projectableSchedule = schedule as unknown as ProjectableSchedule
        const avgOccurrences = getAverageScheduleOccurrencesPerMonth({
          frequency: projectableSchedule.frequency,
          startDate: projectableSchedule.startDate,
          endDate: projectableSchedule.endDate ?? null,
          daysOfWeek: projectableSchedule.daysOfWeek,
          monthlyPattern: projectableSchedule.monthlyPattern,
          customDates: projectableSchedule.customDates,
          excludedDates: projectableSchedule.excludedDates,
        })
        const clientPayType = schedule.clientPayType || 'PER_CLEAN'
        const subPayType = schedule.subcontractorPayType || 'PER_CLEAN'

        // ── AVG Base Revenue ──
        if (clientPayType === 'FLAT_RATE') {
          avgRevenue += schedule.defaultClientRate
        } else {
          avgRevenue += schedule.defaultClientRate * avgOccurrences
        }

        // ── AVG Base Cleaner Cost ──
        if (subPayType === 'FLAT_RATE') {
          avgCleanerCost += schedule.defaultSubcontractorRate
        } else {
          avgCleanerCost += schedule.defaultSubcontractorRate * avgOccurrences
        }

        // ── AVG Add-ons ──
        schedule.recurringAddOnServices?.forEach(addon => {
          const addonFreq = addon.frequency || 'MONTHLY'
          const addonAvgOccurrences = getAvgOccurrencesPerMonth(addonFreq, undefined)

          avgAddonRevenue += addon.clientRate * addonAvgOccurrences
          avgAddonCleanerCost += addon.subcontractorRate * addonAvgOccurrences

          const freqDisplay = addonFreq === 'MONTHLY' ? 'monthly' :
                             addonFreq === 'EVERY_6_WEEKS' ? 'every 6 weeks' : addonFreq.toLowerCase()
          addOns.push(`${addon.description}: $${addon.clientRate} ${freqDisplay}${addon.subcontractorRate > 0 ? `, Cleaner $${addon.subcontractorRate}` : ''}`)
        })

        // ── Period calculations ──
        if (isPastMonth) {
          // Past months: use actual job records
          const scheduleKey = `${client.id}-${schedule.id}`
          const scheduleJobs = jobsByClientSchedule.get(scheduleKey) || []

          periodJobCount += scheduleJobs.length

          if (clientPayType === 'FLAT_RATE') {
            if (scheduleJobs.length > 0) {
              periodRevenue += scheduleJobs[0].clientRate
            }
          } else {
            periodRevenue += scheduleJobs.reduce((sum, job) => sum + job.clientRate, 0)
          }

          if (subPayType === 'FLAT_RATE') {
            if (scheduleJobs.length > 0) {
              periodCleanerCost += scheduleJobs[0].subcontractorRate
            }
          } else {
            periodCleanerCost += scheduleJobs.reduce((sum, job) => sum + job.subcontractorRate, 0)
          }

          // Add recurring add-ons for past months (was missing before)
          if (scheduleJobs.length > 0 && schedule.recurringAddOnServices) {
            schedule.recurringAddOnServices.forEach(addon => {
              periodRevenue += addon.clientRate
              periodCleanerCost += addon.subcontractorRate
            })
          }

          // Add job-level add-ons for past months
          scheduleJobs.forEach(job => {
            job.addOnServices.forEach(addon => {
              periodRevenue += addon.clientRate
              periodCleanerCost += addon.subcontractorRate
            })
          })
        } else {
          // Current + future months: project from schedule date math
          const projection = projectSingleScheduleForMonth(
            projectableSchedule,
            year,
            month
          )
          periodRevenue += projection.revenue
          periodCleanerCost += projection.workerPayments
          periodJobCount += projection.jobCount
        }
      })

      // One-off jobs (only relevant for past months with actual job data)
      if (isPastMonth) {
        const oneOffKey = `${client.id}-one-off`
        const oneOffJobs = jobsByClientSchedule.get(oneOffKey) || []

        if (oneOffJobs.length > 0) {
          periodJobCount += oneOffJobs.length
          periodRevenue += oneOffJobs.reduce((sum, job) => sum + job.clientRate, 0)
          periodCleanerCost += oneOffJobs.reduce((sum, job) => sum + job.subcontractorRate, 0)
        }
      }

      // Combine frequencies for display
      const frequencies = displayFrequencySchedules.map(s => formatFrequency(s.frequency, s.daysOfWeek || undefined, s.monthlyPattern || undefined))
      const uniqueFreqs = [...new Set(frequencies)]

      return {
        id: client.id,
        name: client.name,
        cleanerAssigned: subcontractorName,
        frequency: uniqueFreqs.join('; '),
        clientPayType: formatPayType(primarySchedule.clientPayType || 'PER_CLEAN'),
        cleanerPayType: formatPayType(primarySchedule.subcontractorPayType || 'PER_CLEAN'),
        addOns: addOns.length > 0 ? addOns.join('; ') : '-',

        // AVG calculations
        avgRevenue: avgRevenue + avgAddonRevenue,
        avgCleanerCost: avgCleanerCost + avgAddonCleanerCost,
        avgProfit: (avgRevenue + avgAddonRevenue) - (avgCleanerCost + avgAddonCleanerCost),

        // Period calculations
        periodJobCount,
        periodRevenue,
        periodCleanerCost,
        periodProfit: periodRevenue - periodCleanerCost,

        // Breakdown for drill-down
        breakdown: {
          avgBaseRevenue: avgRevenue,
          avgBaseCleanerCost: avgCleanerCost,
          avgAddonRevenue,
          avgAddonCleanerCost,
          scheduleCount: schedules.length,
          oneOffCount: isPastMonth ? (jobsByClientSchedule.get(`${client.id}-one-off`) || []).length : 0,
        }
      }
    }).filter(Boolean)

    // Calculate totals
    const totals = {
      avgRevenue: clientData.reduce((sum, c) => sum + (c?.avgRevenue || 0), 0),
      avgCleanerCost: clientData.reduce((sum, c) => sum + (c?.avgCleanerCost || 0), 0),
      avgProfit: clientData.reduce((sum, c) => sum + (c?.avgProfit || 0), 0),
      periodRevenue: clientData.reduce((sum, c) => sum + (c?.periodRevenue || 0), 0),
      periodCleanerCost: clientData.reduce((sum, c) => sum + (c?.periodCleanerCost || 0), 0),
      periodProfit: clientData.reduce((sum, c) => sum + (c?.periodProfit || 0), 0),
      periodJobCount: clientData.reduce((sum, c) => sum + (c?.periodJobCount || 0), 0),
    }

    return NextResponse.json(
      {
        clients: clientData,
        totals,
        period: {
          year,
          month,
          label: format(periodStart, 'MMMM yyyy'),
          isFuture: !isPastMonth && periodStart > now,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    )
  } catch (error) {
    logger.error("[client-overview] Error:", {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    })
    return handleApiError(error, "Failed to fetch client overview data")
  }
}
