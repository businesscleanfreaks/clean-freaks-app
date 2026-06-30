import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAvgOccurrencesPerMonth } from "@/lib/frequency-utils"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getPrimaryScheduleForDisplay, getScheduleLifecycle } from "@/lib/schedule-timing"

export const dynamic = 'force-dynamic'

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_SORT_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon-Sun ordering

function sortDaysMondayFirst(days: number[]): number[] {
  return [...days].sort(
    (a, b) => DAY_SORT_ORDER.indexOf(a) - DAY_SORT_ORDER.indexOf(b)
  )
}

function parseDaysOfWeek(raw: string | null): number[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(Number).filter((n) => n >= 0 && n <= 6) : []
  } catch {
    return []
  }
}

function deriveFrequencyText(
  schedFreq: string,
  daysOfWeek: number[]
): string {
  const sorted = sortDaysMondayFirst(daysOfWeek)
  const dayNames = sorted.map((d) => DAY_NAMES[d])
  const count = daysOfWeek.length

  if (schedFreq === "DAILY" || (schedFreq === "WEEKLY" && count === 7)) {
    return "Daily (7x week): Mon-Sun"
  }

  if (schedFreq === "WEEKLY") {
    if (count <= 1) return count === 1 ? `Weekly: ${dayNames.join(", ")}` : "Weekly"
    return `${count}x Weekly: ${dayNames.join(", ")}`
  }

  if (schedFreq === "BI_WEEKLY") {
    return count > 0
      ? `Bi-Weekly: ${dayNames.join(", ")}`
      : "Bi-Weekly"
  }

  if (schedFreq === "MONTHLY") return "Monthly"
  if (schedFreq === "2X_MONTHLY" || schedFreq === "BI_MONTHLY") return "2x Monthly"

  return schedFreq
}

export async function GET() {
  try {
    const [clients, subcontractors] = await Promise.all([
      prisma.client.findMany({
        where: { isActive: true },
        include: {
          cleanerAssigned: { select: { id: true, name: true } },
          locations: {
            select: {
              id: true,
              schedules: {
                where: { isActive: true },
                select: {
                  defaultClientRate: true,
                  defaultSubcontractorRate: true,
                  frequency: true,
                  startDate: true,
                  endDate: true,
                  daysOfWeek: true,
                  monthlyPattern: true,
                  customDates: true,
                  excludedDates: true,
                  clientPayType: true,
                  subcontractorPayType: true,
                  subcontractor: { select: { id: true, name: true } },
                  recurringAddOnServices: {
                    where: { isRecurring: true },
                    select: {
                      clientRate: true,
                      subcontractorRate: true,
                      frequency: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.subcontractor.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ])

    const rows = clients.map((client) => {
      // Collect ALL active schedules across all locations
      const allSchedules = client.locations?.flatMap((loc) => loc.schedules) ?? []
      const primarySchedule = getPrimaryScheduleForDisplay(allSchedules)
      const schedCleaner = primarySchedule?.subcontractor

      // Display fields from the most relevant schedule (current first, then next upcoming)
      let frequencyText = client.frequency ?? null
      let recurringVal = client.recurring ?? null
      const clientPriceVal =
        client.clientPrice ?? primarySchedule?.defaultClientRate ?? null

      if (primarySchedule) {
        const days = parseDaysOfWeek(primarySchedule.daysOfWeek)
        if (frequencyText == null) {
          frequencyText = deriveFrequencyText(primarySchedule.frequency, days)
        }
        if (recurringVal == null) {
          recurringVal = getAverageScheduleOccurrencesPerMonth({
            frequency: primarySchedule.frequency,
            startDate: primarySchedule.startDate,
            endDate: primarySchedule.endDate,
            daysOfWeek: primarySchedule.daysOfWeek,
            monthlyPattern: primarySchedule.monthlyPattern,
            customDates: primarySchedule.customDates,
            excludedDates: primarySchedule.excludedDates,
          })
        }
      }

      const currentSchedules = allSchedules.filter(
        (schedule) => getScheduleLifecycle(schedule) === "current"
      )
      const schedulesForCurrentSnapshot =
        currentSchedules.length > 0
          ? currentSchedules
          : primarySchedule
            ? [primarySchedule]
            : []

      // Compute revenue and cleanerPayout from the schedule(s) active now
      let revenueVal = 0
      let cleanerPayoutVal = 0

      if (schedulesForCurrentSnapshot.length > 0) {
        for (const schedule of schedulesForCurrentSnapshot) {
          const clientPayType = schedule.clientPayType || client.billingType || 'PER_CLEAN'
          const subPayType = schedule.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN'
          const cleansPerMonth = getAverageScheduleOccurrencesPerMonth({
            frequency: schedule.frequency,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            daysOfWeek: schedule.daysOfWeek,
            monthlyPattern: schedule.monthlyPattern,
            customDates: schedule.customDates,
            excludedDates: schedule.excludedDates,
          })

          // Revenue from this schedule
          if (clientPayType === 'FLAT_RATE') {
            revenueVal += schedule.defaultClientRate || 0
          } else {
            revenueVal += (schedule.defaultClientRate || 0) * cleansPerMonth
          }

          // Subcontractor cost from this schedule
          if (subPayType === 'FLAT_RATE') {
            cleanerPayoutVal += schedule.defaultSubcontractorRate || 0
          } else {
            cleanerPayoutVal += (schedule.defaultSubcontractorRate || 0) * cleansPerMonth
          }

          // Recurring add-on services on this schedule (matches dashboard logic)
          for (const addon of schedule.recurringAddOnServices) {
            const addonMultiplier = getAvgOccurrencesPerMonth(addon.frequency || 'MONTHLY')
            revenueVal += (addon.clientRate || 0) * addonMultiplier
            cleanerPayoutVal += (addon.subcontractorRate || 0) * addonMultiplier
          }
        }

        revenueVal = Math.round(revenueVal * 100) / 100
        cleanerPayoutVal = Math.round(cleanerPayoutVal * 100) / 100
      }

      return {
        id: client.id,
        name: client.name,
        clientPrice: clientPriceVal,
        revenue: revenueVal || null,
        billingType: client.billingType,
        propertyType: client.propertyType ?? null,
        cleanerPayout: cleanerPayoutVal || null,
        cleanerPayType: client.cleanerPayType,
        frequency: frequencyText,
        recurring: recurringVal,
        rowColor: client.rowColor ?? null,
        cleanerAssignedId: client.cleanerAssignedId ?? schedCleaner?.id ?? null,
        cleanerAssignedName:
          client.cleanerAssigned?.name ?? schedCleaner?.name ?? null,
        addon1Name: client.addon1Name ?? null,
        addon1ClientPrice: client.addon1ClientPrice ?? null,
        addon1Frequency: client.addon1Frequency ?? null,
        addon1CleanerPayout: client.addon1CleanerPayout ?? null,
        addon2Name: client.addon2Name ?? null,
        addon2ClientPrice: client.addon2ClientPrice ?? null,
        addon2Frequency: client.addon2Frequency ?? null,
        addon2CleanerPayout: client.addon2CleanerPayout ?? null,
        phone: client.phone ?? null,
        communicationContactName: client.communicationContactName ?? null,
        communicationEmail: client.communicationEmail ?? null,
        invoicingContactName: client.invoicingContactName ?? null,
        invoicingEmail: client.invoicingEmail ?? null,
        invoicingCcEmail: client.invoicingCcEmail ?? null,
        invoiceFrequency: client.invoiceFrequency ?? null,
        notes: client.notes ?? null,
        startDate: client.startDate?.toISOString() ?? null,
        isActive: client.isActive,
      }
    })

    return NextResponse.json({ rows, subcontractors })
  } catch (error) {
    console.error("Table data error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch table data",
      },
      { status: 500 }
    )
  }
}
