import { differenceInCalendarDays, endOfDay, endOfMonth, format, startOfMonth } from "date-fns"
import { NextRequest, NextResponse } from "next/server"
import { handleApiError } from "@/lib/api-error-handler"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

function getPeriod(request: NextRequest) {
  const now = new Date()
  const params = new URL(request.url).searchParams
  const year = Number(params.get("year") ?? now.getFullYear())
  const month = Number(params.get("month") ?? now.getMonth())
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error("Invalid dashboard month")
  }
  const date = new Date(year, month, 1)
  return { start: startOfMonth(date), end: endOfMonth(date), key: format(date, "yyyy-MM") }
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth()
    const period = getPeriod(request)
    const now = endOfDay(new Date())

    const jobs = await prisma.job.findMany({
      where: {
        date: { gte: period.start, lte: period.end },
        status: { not: "CANCELLED" },
        location: { client: { isActive: true } },
      },
      select: {
        id: true,
        date: true,
        status: true,
        clientRate: true,
        subcontractorRate: true,
        invoiced: true,
        subcontractorPaid: true,
        vendorPaid: true,
        isTrial: true,
        scheduleId: true,
        subcontractorId: true,
        vendorId: true,
        location: {
          select: {
            id: true,
            name: true,
            client: {
              select: {
                id: true,
                name: true,
                propertyType: true,
                invoiceFrequency: true,
                preferredPaymentMethod: true,
              },
            },
          },
        },
        schedule: {
          select: {
            id: true,
            startDate: true,
            frequency: true,
            clientPayType: true,
          },
        },
        subcontractor: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { location: { client: { name: "asc" } } }],
    })

    const launchMap = new Map<string, {
      id: string
      clientId: string
      clientName: string
      date: Date
      locationIds: Set<string>
      isTrial: boolean
    }>()
    const seenSchedules = new Set<string>()

    for (const job of jobs) {
      const daysFromStart = job.schedule
        ? differenceInCalendarDays(job.date, job.schedule.startDate)
        : Number.POSITIVE_INFINITY
      const isFirstClean = Boolean(job.scheduleId && !seenSchedules.has(job.scheduleId) && daysFromStart >= 0 && daysFromStart <= 14)
      if (job.scheduleId) seenSchedules.add(job.scheduleId)
      if (!job.isTrial && !isFirstClean) continue

      const client = job.location.client
      const existing = launchMap.get(client.id)
      if (existing) {
        existing.locationIds.add(job.location.id)
        existing.isTrial = existing.isTrial || job.isTrial
        if (job.date < existing.date) existing.date = job.date
      } else {
        launchMap.set(client.id, {
          id: job.id,
          clientId: client.id,
          clientName: client.name,
          date: job.date,
          locationIds: new Set([job.location.id]),
          isTrial: job.isTrial,
        })
      }
    }

    const trials = Array.from(launchMap.values()).map((item) => ({
      id: item.id,
      clientId: item.clientId,
      clientName: item.clientName,
      date: item.date.toISOString(),
      kind: item.isTrial ? "TRIAL" : "FIRST_CLEAN",
      detail: item.locationIds.size > 1
        ? `${item.locationIds.size} locations starting ${format(item.date, "EEEE")}`
        : `${item.isTrial ? "Trial" : "First clean"} ${format(item.date, "EEEE")}`,
    }))

    const manualCharges = jobs
      .filter((job) => {
        const client = job.location.client
        const isDue = job.status === "COMPLETED" || job.date <= now
        const isPerClean = (job.schedule?.clientPayType ?? "PER_CLEAN") !== "FLAT_RATE"
        const isManualFlow = client.invoiceFrequency === "AFTER_EACH_CLEAN"
          || client.propertyType === "RESIDENTIAL"
          || client.preferredPaymentMethod === "ZELLE"
        return Boolean(job.scheduleId && !job.invoiced && job.clientRate > 0 && isDue && isPerClean && isManualFlow)
      })
      .map((job) => ({
        id: job.id,
        clientId: job.location.client.id,
        clientName: job.location.client.name,
        amount: job.clientRate,
        date: job.date.toISOString(),
        detail: [job.schedule?.frequency?.replaceAll("_", " "), job.location.client.preferredPaymentMethod || "Invoice"]
          .filter(Boolean)
          .join(" · "),
      }))

    const oneOffJobs = jobs.filter((job) => !job.scheduleId && (job.status === "COMPLETED" || job.date <= now))
    const cleanerIds = Array.from(new Set(oneOffJobs.flatMap((job) => job.subcontractorId ? [job.subcontractorId] : [])))
    const vendorIds = Array.from(new Set(oneOffJobs.flatMap((job) => job.vendorId ? [job.vendorId] : [])))
    const oneOffPeriods = Array.from(new Set(oneOffJobs.map((job) => format(job.date, "yyyy-MM"))))

    const [cleanerInvoices, vendorInvoices] = await Promise.all([
      cleanerIds.length && oneOffPeriods.length
        ? prisma.cleanerInvoice.findMany({
            where: { subcontractorId: { in: cleanerIds }, period: { in: oneOffPeriods }, status: { in: ["MATCHED", "RESOLVED"] } },
            select: { subcontractorId: true, period: true },
          })
        : [],
      vendorIds.length && oneOffPeriods.length
        ? prisma.vendorInvoice.findMany({
            where: { vendorId: { in: vendorIds }, period: { in: oneOffPeriods }, status: { in: ["MATCHED", "RESOLVED"] } },
            select: { vendorId: true, period: true },
          })
        : [],
    ])

    const invoiceKeys = new Set([
      ...cleanerInvoices.map((invoice) => `cleaner:${invoice.subcontractorId}:${invoice.period}`),
      ...vendorInvoices.map((invoice) => `vendor:${invoice.vendorId}:${invoice.period}`),
    ])

    const oneOffs = oneOffJobs.map((job) => {
      const workerType = job.vendorId ? "vendor" : "cleaner"
      const workerId = job.vendorId || job.subcontractorId
      const workerName = job.vendor?.name || job.subcontractor?.name || "Unassigned"
      const workerPaid = job.vendorId ? job.vendorPaid : job.subcontractorPaid
      const hasWorkerInvoice = workerId
        ? invoiceKeys.has(`${workerType}:${workerId}:${format(job.date, "yyyy-MM")}`)
        : true
      const stage = !job.invoiced
        ? "INVOICE_CLIENT"
        : !workerPaid && !hasWorkerInvoice
          ? "GET_WORKER_INVOICE"
          : !workerPaid && job.subcontractorRate > 0
            ? "PAY_WORKER"
            : "DONE"

      return {
        id: job.id,
        clientId: job.location.client.id,
        clientName: job.location.client.name,
        locationName: job.location.name,
        date: job.date.toISOString(),
        clientAmount: job.clientRate,
        workerAmount: job.subcontractorRate,
        workerId,
        workerName,
        workerType,
        invoiced: job.invoiced,
        hasWorkerInvoice,
        workerPaid,
        stage,
      }
    })

    return NextResponse.json(
      { trials, manualCharges, oneOffs, period: period.key },
      { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=59" } },
    )
  } catch (error) {
    return handleApiError(error, "Failed to load dashboard operations")
  }
}
