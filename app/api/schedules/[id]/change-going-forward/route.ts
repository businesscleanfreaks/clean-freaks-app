import { subDays, startOfDay } from 'date-fns'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidateSchedulePages } from '@/lib/revalidate'
import { triggerSystemRefresh } from '@/lib/cascading-updates'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { changeScheduleGoingForwardSchema } from '@/lib/validations'
import { parseDateOnly, parseDateOnlyForStorage } from '@/lib/date-only'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth()

    const body = await request.json()
    const validationResult = changeScheduleGoingForwardSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    const existingSchedule = await prisma.schedule.findUnique({
      where: { id: params.id },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        recurringAddOnServices: {
          where: { isRecurring: true },
        },
      },
    })

    if (!existingSchedule) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      )
    }

    const {
      carryForwardRecurringAddOns,
      locationId: _ignoredLocationId,
      ...newScheduleData
    } = validationResult.data
    const paymentCadenceOverrideProvided = Object.prototype.hasOwnProperty.call(
      newScheduleData,
      'paymentCadenceOverride',
    )
    const nextPaymentCadenceOverride = paymentCadenceOverrideProvided
      ? newScheduleData.paymentCadenceOverride ?? null
      : existingSchedule.paymentCadenceOverride

    const parsedNewStartDate = parseDateOnly(newScheduleData.startDate)!
    const newStartDate = startOfDay(parsedNewStartDate)
    const currentStartDate = startOfDay(parseDateOnly(existingSchedule.startDate)!)
    const today = startOfDay(new Date())

    if (newStartDate < today) {
      return NextResponse.json(
        { error: 'Start date for a future change must be today or later.' },
        { status: 400 }
      )
    }

    if (newStartDate < currentStartDate) {
      return NextResponse.json(
        { error: 'Start date must be on or after the current schedule start date.' },
        { status: 400 }
      )
    }

    const persistedStartDate = parseDateOnlyForStorage(newScheduleData.startDate)!
    const persistedEndDate = parseDateOnlyForStorage(newScheduleData.endDate)

    if (persistedEndDate && startOfDay(persistedEndDate) < newStartDate) {
      return NextResponse.json(
        { error: 'The new schedule end date cannot be before its start date.' },
        { status: 400 }
      )
    }

    // ── Same-start-date: update the existing schedule in place ─────────────
    const isSameStartDate = newStartDate.getTime() === currentStartDate.getTime()

    if (isSameStartDate) {
      const updatedSchedule = await prisma.schedule.update({
        where: { id: existingSchedule.id },
        data: {
          frequency: newScheduleData.frequency,
          daysOfWeek: newScheduleData.daysOfWeek ?? null,
          monthlyPattern: newScheduleData.monthlyPattern ?? null,
          endDate: persistedEndDate ?? existingSchedule.endDate,
          defaultClientRate: newScheduleData.defaultClientRate,
          defaultSubcontractorRate: newScheduleData.defaultSubcontractorRate,
          clientPayType: newScheduleData.clientPayType,
          subcontractorPayType: newScheduleData.subcontractorPayType,
          paymentCadenceOverride: nextPaymentCadenceOverride,
          subcontractorId: newScheduleData.subcontractorId ?? null,
          timeType: newScheduleData.timeType,
          startTime: newScheduleData.startTime ?? null,
          startWindowBegin: newScheduleData.startWindowBegin ?? null,
          startWindowEnd: newScheduleData.startWindowEnd ?? null,
        },
        include: {
          location: { include: { client: true } },
        },
      })

      await prisma.client.update({
        where: { id: updatedSchedule.location.client.id },
        data: {
          billingType: newScheduleData.clientPayType,
          cleanerPayType: newScheduleData.subcontractorPayType,
        },
      })

      const summary = updatedSchedule.isActive
        ? await regenerateJobsForSchedule(updatedSchedule.id, {
            effectiveDate: updatedSchedule.startDate,
            rebuildDraftInvoicedJobs: true,
          })
        : null

      revalidateSchedulePages(updatedSchedule.location.client.id)
      await triggerSystemRefresh()

      return NextResponse.json({
        oldScheduleId: existingSchedule.id,
        oldScheduleEndDate: null,
        newSchedule: updatedSchedule,
        carriedForwardRecurringAddOns: 0,
        futureProtectedJobsCount: 0,
        regenerationSummary: {
          oldSchedule: null,
          newSchedule: summary,
        },
      })
    }

    // ── Different start date: split into old + new schedule ────────────────

    const requestedOldEndDate = subDays(newStartDate, 1)
    const existingEndDate = existingSchedule.endDate
      ? startOfDay(parseDateOnly(existingSchedule.endDate)!)
      : null
    const oldScheduleEndDate = existingEndDate && existingEndDate < requestedOldEndDate
      ? existingEndDate
      : requestedOldEndDate

    const futureProtectedJobsCount = await prisma.job.count({
      where: {
        scheduleId: existingSchedule.id,
        date: { gte: newStartDate },
        OR: [
          { subcontractorPaid: true },
          { status: 'CANCELLED' },
          { invoiceLineItems: { some: { invoice: { status: { in: ['SENT', 'PAID'] } } } } },
        ],
      },
    })

    const result = await prisma.$transaction(async (tx) => {
      const updatedOldSchedule = await tx.schedule.update({
        where: { id: existingSchedule.id },
        data: {
          endDate: oldScheduleEndDate,
        },
      })

      const newSchedule = await tx.schedule.create({
        data: {
          locationId: existingSchedule.locationId,
          frequency: newScheduleData.frequency,
          daysOfWeek: newScheduleData.daysOfWeek ?? null,
          monthlyPattern: newScheduleData.monthlyPattern ?? null,
          startDate: persistedStartDate,
          endDate: persistedEndDate ?? null,
          defaultClientRate: newScheduleData.defaultClientRate,
          defaultSubcontractorRate: newScheduleData.defaultSubcontractorRate,
          clientPayType: newScheduleData.clientPayType,
          subcontractorPayType: newScheduleData.subcontractorPayType,
          paymentCadenceOverride: nextPaymentCadenceOverride,
          subcontractorId: newScheduleData.subcontractorId ?? null,
          timeType: newScheduleData.timeType,
          startTime: newScheduleData.startTime ?? null,
          startWindowBegin: newScheduleData.startWindowBegin ?? null,
          startWindowEnd: newScheduleData.startWindowEnd ?? null,
          isActive: existingSchedule.isActive,
          excludedDates: existingSchedule.excludedDates,
        },
        include: {
          location: {
            include: {
              client: true,
            },
          },
        },
      })

      await tx.client.update({
        where: { id: existingSchedule.location.client.id },
        data: {
          billingType: newScheduleData.clientPayType,
          cleanerPayType: newScheduleData.subcontractorPayType,
        },
      })

      let carriedForwardRecurringAddOns = 0

      if (carryForwardRecurringAddOns && existingSchedule.recurringAddOnServices.length > 0) {
        const created = await tx.addOnService.createMany({
          data: existingSchedule.recurringAddOnServices.map((addOn) => ({
            scheduleId: newSchedule.id,
            description: addOn.description,
            clientRate: addOn.clientRate,
            subcontractorRate: addOn.subcontractorRate,
            frequency: addOn.frequency,
            isRecurring: true,
          })),
        })
        carriedForwardRecurringAddOns = created.count
      }

      return {
        updatedOldSchedule,
        newSchedule,
        carriedForwardRecurringAddOns,
      }
    })

    const oldSummary = existingSchedule.isActive
      ? await regenerateJobsForSchedule(existingSchedule.id, { rebuildDraftInvoicedJobs: true })
      : null
    const newSummary = result.newSchedule.isActive
      ? await regenerateJobsForSchedule(result.newSchedule.id, {
          effectiveDate: result.newSchedule.startDate,
          rebuildDraftInvoicedJobs: true,
        })
      : null

    if (oldScheduleEndDate < today && existingSchedule.isActive) {
      await prisma.schedule.update({
        where: { id: existingSchedule.id },
        data: { isActive: false },
      })
    }

    revalidateSchedulePages(existingSchedule.location.client.id)
    await triggerSystemRefresh()

    return NextResponse.json({
      oldScheduleId: existingSchedule.id,
      oldScheduleEndDate: oldScheduleEndDate.toISOString(),
      newSchedule: result.newSchedule,
      carriedForwardRecurringAddOns: result.carriedForwardRecurringAddOns,
      futureProtectedJobsCount,
      regenerationSummary: {
        oldSchedule: oldSummary,
        newSchedule: newSummary,
      },
    })
  } catch (error) {
    logger.error('Error creating future schedule change:', error)
    return handleApiError(error, 'Failed to create future schedule change')
  }
}
