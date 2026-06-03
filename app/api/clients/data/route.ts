import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getPrimaryScheduleForDisplay } from "@/lib/schedule-timing"

export const dynamic = 'force-dynamic'

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_SORT_ORDER = [1, 2, 3, 4, 5, 6, 0]

function parseDaysOfWeek(raw: string | null): number[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(Number).filter((n) => n >= 0 && n <= 6) : []
  } catch {
    return []
  }
}

function deriveScheduleText(frequency: string, daysOfWeek: number[]): string {
  const sorted = [...daysOfWeek].sort(
    (a, b) => DAY_SORT_ORDER.indexOf(a) - DAY_SORT_ORDER.indexOf(b)
  )
  const dayNames = sorted.map((d) => DAY_NAMES[d])
  const count = daysOfWeek.length

  if (frequency === "DAILY" || (frequency === "WEEKLY" && count === 7)) return "Daily: M-Su"
  if (frequency === "WEEKLY") {
    if (count === 5 && [1, 2, 3, 4, 5].every(d => daysOfWeek.includes(d))) return "5x Weekly: M-F"
    if (count <= 1) return count === 1 ? `Weekly: ${dayNames.join(", ")}` : "Weekly"
    return `${count}x Weekly: ${dayNames.join(", ")}`
  }
  if (frequency === "BI_WEEKLY") return count > 0 ? `Bi-Weekly: ${dayNames.join(", ")}` : "Bi-Weekly"
  if (frequency === "EVERY_3_WEEKS") return count > 0 ? `Every 3 Weeks: ${dayNames.join(", ")}` : "Every 3 Weeks"
  if (frequency === "EVERY_4_WEEKS") return count > 0 ? `Every 4 Weeks: ${dayNames.join(", ")}` : "Every 4 Weeks"
  if (frequency === "EVERY_6_WEEKS") return count > 0 ? `Every 6 Weeks: ${dayNames.join(", ")}` : "Every 6 Weeks"
  if (frequency === "MONTHLY") return "Monthly"
  if (frequency === "2X_MONTHLY" || frequency === "BI_MONTHLY") return "2x Monthly"
  return frequency
}

function deriveAreaFromAddress(address: string | null): string {
  if (!address) return ""
  // Try to grab the city portion: "123 Main St, Santa Monica, CA 90405"
  // We pick the second-to-last comma-separated part if it looks like a city.
  const parts = address.split(",").map(s => s.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[parts.length - 2]
  if (parts.length === 2) return parts[1]
  return parts[0] || ""
}

// Clients data API for instant page loads
export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            accessInfo: true,
            schedules: {
              where: { isActive: true },
              select: {
                id: true,
                frequency: true,
                daysOfWeek: true,
                monthlyPattern: true,
                customDates: true,
                excludedDates: true,
                startDate: true,
                endDate: true,
                defaultClientRate: true,
                defaultSubcontractorRate: true,
                clientPayType: true,
                subcontractor: {
                  select: { id: true, name: true },
                },
              },
            },
            jobs: {
              select: { status: true, date: true },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    })

    const serializedClients = clients.map(client => {
      const cleanerNames = new Set<string>()
      let hasSchedules = false
      for (const loc of client.locations) {
        for (const sch of loc.schedules) {
          hasSchedules = true
          if (sch.subcontractor?.name) cleanerNames.add(sch.subcontractor.name)
        }
      }
      let cleanerDisplay = 'Unassigned'
      if (cleanerNames.size === 1) cleanerDisplay = [...cleanerNames][0]
      else if (cleanerNames.size > 1) cleanerDisplay = 'Mixed'
      else if (!hasSchedules) cleanerDisplay = 'Unassigned'

      // Primary schedule (across all locations) for rate + schedule text
      const allSchedules = client.locations.flatMap(loc => loc.schedules)
      const primarySchedule = getPrimaryScheduleForDisplay(allSchedules)
      const primaryRate = primarySchedule?.defaultClientRate ?? null
      const primaryFrequency = primarySchedule?.frequency ?? null
      const primaryDays = primarySchedule ? parseDaysOfWeek(primarySchedule.daysOfWeek) : []
      const primaryClientPayType = primarySchedule?.clientPayType || client.billingType || 'PER_CLEAN'
      const scheduleText = primarySchedule ? deriveScheduleText(primarySchedule.frequency, primaryDays) : ''
      const primaryArea = client.locations[0] ? deriveAreaFromAddress(client.locations[0].address) : ''

      const locationsClean = client.locations.map(({ schedules: _s, jobs, ...rest }) => ({
        ...rest,
        area: deriveAreaFromAddress(rest.address),
        jobs: jobs.map((job) => ({
          ...job,
          date: job.date.toISOString(),
        })),
      }))

      return {
        ...client,
        createdAt: client.createdAt.toISOString(),
        startDate: client.startDate?.toISOString() ?? null,
        locations: locationsClean,
        cleanerDisplay,
        primaryRate,
        primaryClientPayType,
        primaryFrequency,
        scheduleText,
        primaryArea,
      }
    })

    return NextResponse.json(serializedClients, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
      },
    })
  } catch (error) {
    console.error('Clients data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}
