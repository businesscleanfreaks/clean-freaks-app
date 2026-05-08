import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { logger, getErrorMessage } from "@/lib/logger"
import { getBillingStartDate } from "@/lib/billing-settings"
import { isJobPayable } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo } from "@/lib/payment-cadence"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params

    const sub = await prisma.subcontractor.findUnique({
      where: { id },
    })

    if (!sub) {
      return NextResponse.json({ error: "Subcontractor not found" }, { status: 404 })
    }

    const billingStartDate = await getBillingStartDate()
    const today = new Date()
    today.setHours(23, 59, 59, 999)

    // Parallelize DB queries for speed
    const [unpaidJobs, payments, accounts] = await Promise.all([
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
    ])

    // Filter out jobs with missing location/client data (data integrity safety)
    const validJobs = unpaidJobs.filter(job => job.location && job.location.client)

    // Build cadence info and filter jobs
    const cadenceSub: CadenceSubcontractorInfo = {
      paymentCadence: sub.paymentCadence,
      excludeClientIds: sub.excludeClientIds,
    }

    const scheduleMap = new Map<string, CadenceScheduleInfo>()
    validJobs.forEach(job => {
      if (job.scheduleId && job.schedule && !scheduleMap.has(job.scheduleId)) {
        scheduleMap.set(job.scheduleId, {
          paymentCadenceOverride: job.schedule.paymentCadenceOverride ?? null,
        })
      }
    })

    const payableJobs = validJobs.filter(job => {
      const schedule = job.scheduleId ? (scheduleMap.get(job.scheduleId) || null) : null
      return isJobPayable(job, cadenceSub, schedule)
    })

    const jobsByClientSchedule = new Map<string, typeof payableJobs>()
    payableJobs.forEach(job => {
      const key = `${job.location.client.id}-${job.scheduleId || "one-off"}`
      if (!jobsByClientSchedule.has(key)) jobsByClientSchedule.set(key, [])
      jobsByClientSchedule.get(key)!.push(job)
    })

    let owedAmount = 0
    jobsByClientSchedule.forEach(jobsGroup => {
      if (jobsGroup.length === 0) return
      const schedule = jobsGroup[0].schedule
      const isRecurring = jobsGroup[0].scheduleId !== null
      if (schedule?.subcontractorPayType === "FLAT_RATE" && isRecurring) {
        const firstJob = jobsGroup[0]
        owedAmount += firstJob.subcontractorRate
        firstJob.addOnServices.forEach(a => { owedAmount += a.subcontractorRate })
      } else {
        jobsGroup.forEach(job => {
          owedAmount += job.subcontractorRate
          job.addOnServices.forEach(a => { owedAmount += a.subcontractorRate })
        })
      }
    })

    const serializeDate = (d: Date) => d.toISOString()

    const serializedJobs = payableJobs.map(job => ({
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

    const serializedPayments = payments.map(payment => ({
      ...payment,
      datePaid: serializeDate(payment.datePaid),
      createdAt: serializeDate(payment.createdAt),
      lineItems: payment.lineItems.map(item => ({
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

    const serializedAccounts = accounts.map(acct => ({
      ...acct,
      startDate: serializeDate(acct.startDate),
    }))

    return NextResponse.json({
      ...sub,
      createdAt: serializeDate(sub.createdAt),
      owedAmount,
      jobs: serializedJobs,
      payments: serializedPayments,
      accounts: serializedAccounts,
    })
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

