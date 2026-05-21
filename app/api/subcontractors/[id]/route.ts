import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { logger, getErrorMessage } from "@/lib/logger"
import { getBillingStartDate } from "@/lib/billing-settings"
import { isJobPayable } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo } from "@/lib/payment-cadence"
import { buildSubcontractorPayLedger } from "@/lib/payout-calculator"

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params

    // Parse optional period query param (e.g. ?period=2026-05)
    const url = new URL(request.url)
    const periodParam = url.searchParams.get('period')

    const sub = await prisma.subcontractor.findUnique({
      where: { id },
    })

    if (!sub) {
      return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 })
    }

    const billingStartDate = await getBillingStartDate()
    const today = new Date()
    today.setHours(23, 59, 59, 999)

    // Build period query if period param provided
    const periodQuery = (() => {
      if (!periodParam) return null
      const [y, m] = periodParam.split('-').map(Number)
      if (!y || !m || m < 1 || m > 12) return null
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 0, 23, 59, 59, 999)
      return { start, end }
    })()

    // Parallelize DB queries for speed
    const queries: [any, any, any, any?] = [
      prisma.job.findMany({
        where: {
          subcontractorId: id,
          subcontractorPaid: false,
          ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
          OR: [
            { status: "COMPLETED" },
            { status: "SCHEDULED", date: { lte: today } },
          ],
        },
        include: {
          location: { include: { client: true } },
          addOnServices: true,
          schedule: true,
          invoiceLineItems: {
            include: {
              invoice: { select: { status: true } },
            },
          },
        },
        orderBy: { date: "asc" },
      }),
      prisma.subcontractorPayment.findMany({
        where: { subcontractorId: id },
        include: {
          lineItems: {
            include: {
              job: {
                include: {
                  location: { include: { client: true } },
                },
              },
            },
          },
        },
        orderBy: { datePaid: "desc" },
      }),
      // Accounts: active schedules this cleaner is assigned to
      prisma.schedule.findMany({
        where: { subcontractorId: id, isActive: true },
        select: {
          id: true,
          frequency: true,
          daysOfWeek: true,
          monthlyPattern: true,
          startTime: true,
          startWindowBegin: true,
          startWindowEnd: true,
          timeType: true,
          defaultClientRate: true,
          defaultSubcontractorRate: true,
          startDate: true,
          location: {
            select: {
              id: true,
              name: true,
              address: true,
              client: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
    ]

    // If period requested, also query ALL jobs for that month (paid + unpaid)
    if (periodQuery) {
      queries.push(
        prisma.job.findMany({
          where: {
            subcontractorId: id,
            date: { gte: periodQuery.start, lte: periodQuery.end },
            status: { in: ['COMPLETED', 'SCHEDULED'] },
          },
          include: {
            location: { include: { client: true } },
            schedule: true,
            addOnServices: true,
            paymentLineItems: {
              include: {
                payment: { select: { datePaid: true } },
              },
              take: 1,
            },
          },
          orderBy: { date: "asc" },
        })
      )
    }

    const [unpaidJobs, payments, accounts, rawPeriodJobs] = await Promise.all(queries)

    // Filter out jobs with missing location/client data (data integrity safety)
    const validJobs = unpaidJobs.filter((job: any) => job.location && job.location.client)

    // Build cadence info and filter jobs
    const cadenceSub: CadenceSubcontractorInfo = {
      paymentCadence: sub.paymentCadence,
      excludeClientIds: sub.excludeClientIds,
    }

    const scheduleMap = new Map<string, CadenceScheduleInfo>()
    validJobs.forEach((job: any) => {
      if (job.scheduleId && job.schedule && !scheduleMap.has(job.scheduleId)) {
        scheduleMap.set(job.scheduleId, {
          paymentCadenceOverride: job.schedule.paymentCadenceOverride ?? null,
        })
      }
    })

    const payableJobs = validJobs.filter((job: any) => {
      const schedule = job.scheduleId ? (scheduleMap.get(job.scheduleId) || null) : null
      return isJobPayable(job, cadenceSub, schedule)
    })

    const { totalOwed: owedAmount } = buildSubcontractorPayLedger(payableJobs)

    const serializeDate = (d: Date) => d.toISOString()

    const serializedJobs = payableJobs.map((job: any) => ({
      ...job,
      date: serializeDate(job.date),
      createdAt: serializeDate(job.createdAt),
      updatedAt: serializeDate(job.updatedAt),
      location: {
        ...job.location,
        client: {
          ...job.location.client,
          createdAt: serializeDate(job.location.client.createdAt),
        },
      },
      schedule: job.schedule
        ? {
            ...job.schedule,
            startDate: serializeDate(job.schedule.startDate),
            endDate: job.schedule.endDate?.toISOString() || null,
            createdAt: serializeDate(job.schedule.createdAt),
            updatedAt: serializeDate(job.schedule.updatedAt),
          }
        : null,
    }))

    const serializedPayments = payments.map((payment: any) => ({
      ...payment,
      datePaid: serializeDate(payment.datePaid),
      createdAt: serializeDate(payment.createdAt),
      lineItems: payment.lineItems.map((item: any) => ({
        ...item,
        job: item.job && item.job.location && item.job.location.client
          ? {
              ...item.job,
              date: serializeDate(item.job.date),
              createdAt: serializeDate(item.job.createdAt),
              updatedAt: serializeDate(item.job.updatedAt),
              location: {
                ...item.job.location,
                client: {
                  ...item.job.location.client,
                  createdAt: serializeDate(item.job.location.client.createdAt),
                },
              },
            }
          : null,
      })),
    }))

    const serializedAccounts = accounts.map((acct: any) => ({
      ...acct,
      startDate: serializeDate(acct.startDate),
    }))

    // Serialize period jobs if present
    // IMPORTANT: include schedule data so the frontend payout helper can determine
    // the correct flat-rate amount per location (e.g. Beverly Hills $3,400 vs DTLA $4,500)
    const serializedPeriodJobs = rawPeriodJobs
      ? (rawPeriodJobs as any[]).filter((j: any) => j.location && j.location.client).map((job: any) => ({
          id: job.id,
          date: serializeDate(job.date),
          subcontractorRate: job.subcontractorRate,
          subcontractorPaid: job.subcontractorPaid,
          scheduleId: job.scheduleId,
          paidDate: job.paymentLineItems?.[0]?.payment?.datePaid
            ? serializeDate(job.paymentLineItems[0].payment.datePaid)
            : null,
          schedule: job.schedule
            ? {
                subcontractorPayType: job.schedule.subcontractorPayType,
                defaultSubcontractorRate: job.schedule.defaultSubcontractorRate,
              }
            : null,
          addOnServices: (job.addOnServices || []).map((a: any) => ({
            id: a.id,
            subcontractorRate: a.subcontractorRate,
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
      : undefined

    return NextResponse.json(
      {
        ...sub,
        createdAt: serializeDate(sub.createdAt),
        owedAmount,
        jobs: serializedJobs,
        payments: serializedPayments,
        accounts: serializedAccounts,
        ...(serializedPeriodJobs ? { periodJobs: serializedPeriodJobs } : {}),
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    )
  } catch (error) {
    logger.error("Subcontractor detail error:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}

// PATCH — update subcontractor settings (including cadence)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()

    const allowedFields = [
      'name', 'phone', 'email', 'notes', 'teamMembers',
      'paymentCadence', 'paymentCadenceNotes', 'excludeClientIds',
      'isActive'
    ]

    const data: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) {
        data[field] = body[field]
      }
    }

    // Validate paymentCadence value
    if (data.paymentCadence) {
      const validCadences = ['IMMEDIATE', 'AFTER_CLIENT_PAYS', 'END_OF_MONTH', 'SEMI_MONTHLY', 'ON_CLEANER_INVOICE']
      if (!validCadences.includes(data.paymentCadence as string)) {
        return NextResponse.json({ error: 'Invalid payment cadence' }, { status: 400 })
      }
    }

    const updated = await prisma.subcontractor.update({
      where: { id },
      data,
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error("Subcontractor update error:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}

// DELETE — permanently delete subcontractor (only if no linked history)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params

    // Safety check: count linked records
    const [jobCount, scheduleCount, paymentCount] = await Promise.all([
      prisma.job.count({ where: { subcontractorId: id } }),
      prisma.schedule.count({ where: { subcontractorId: id } }),
      prisma.subcontractorPayment.count({ where: { subcontractorId: id } }),
    ])

    const totalLinked = jobCount + scheduleCount + paymentCount

    if (totalLinked > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete: this cleaner has linked history',
          details: {
            jobs: jobCount,
            schedules: scheduleCount,
            payments: paymentCount,
          },
        },
        { status: 409 }
      )
    }

    await prisma.subcontractor.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("Subcontractor delete error:", error)
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    )
  }
}
