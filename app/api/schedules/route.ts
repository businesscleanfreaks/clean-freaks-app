import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { revalidateSchedulePages } from '@/lib/revalidate'
import { createScheduleSchema } from '@/lib/validations'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { calculateScheduleDates } from '@/lib/regenerate-schedule-jobs'
import { parseDateOnlyForStorage } from '@/lib/date-only'

// Type for transaction client
type TransactionClient = Prisma.TransactionClient

// Generate jobs for a schedule - can run inside or outside a transaction
async function generateJobsForSchedule(scheduleId: string, tx?: TransactionClient) {
  const db = tx || prisma
  const schedule = await db.schedule.findUnique({
    where: { id: scheduleId },
  })

  if (!schedule || !schedule.isActive) {
    return
  }

  const candidateDates = calculateScheduleDates({
    frequency: schedule.frequency,
    startDate: new Date(schedule.startDate),
    endDate: schedule.endDate,
    daysOfWeek: schedule.daysOfWeek,
    monthlyPattern: schedule.monthlyPattern,
    customDates: schedule.customDates,
    excludedDates: schedule.excludedDates,
  })

  for (const jobDate of candidateDates) {
    const existingJob = await db.job.findFirst({
      where: {
        scheduleId: scheduleId,
        date: jobDate,
      },
    })

    if (!existingJob) {
      await db.job.create({
        data: {
          locationId: schedule.locationId,
          subcontractorId: schedule.subcontractorId,
          scheduleId: scheduleId,
          date: jobDate,
          startTime: schedule.timeType === 'SPECIFIC' ? schedule.startTime : null,
          startWindowBegin: schedule.timeType === 'WINDOW' ? schedule.startWindowBegin : null,
          startWindowEnd: schedule.timeType === 'WINDOW' ? schedule.startWindowEnd : null,
          clientRate: schedule.defaultClientRate,
          subcontractorRate: schedule.defaultSubcontractorRate,
        },
      })
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = createScheduleSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }

    // Use a transaction to ensure schedule + jobs are created atomically
    // If job generation fails, the schedule creation is rolled back
    const scheduleData = {
      ...validationResult.data,
      startDate: parseDateOnlyForStorage(validationResult.data.startDate)!,
      endDate: parseDateOnlyForStorage(validationResult.data.endDate),
    }

    const schedule = await prisma.$transaction(async (tx) => {
      const newSchedule = await tx.schedule.create({
        data: scheduleData,
        include: {
          location: {
            include: {
              client: true,
            },
          },
        },
      })

      // Generate jobs within the same transaction
      await generateJobsForSchedule(newSchedule.id, tx)

      return newSchedule
    }, {
      maxWait: 10000, // 10 seconds max wait for transaction slot
      timeout: 30000, // 30 seconds max for the entire transaction
    })

    // Revalidate all schedule-related pages
    revalidateSchedulePages(schedule.location.client.id)

    return NextResponse.json(schedule, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Failed to create schedule')
  }
}
