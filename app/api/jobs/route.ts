import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateJobPages } from '@/lib/revalidate'
import { createJobSchema } from '@/lib/validations'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { cascadeJobUpdate } from '@/lib/cascading-updates'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = createJobSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }
    
    const {
      locationId,
      subcontractorId,
      vendorId,
      scheduleId,
      date,
      startTime,
      startWindowBegin,
      startWindowEnd,
      clientRate,
      subcontractorRate,
      notes,
      isTrial,
      trialNotes,
    } = validationResult.data

    // Create the job - scheduleId can be provided for one-time jobs linked to a schedule.
    // Vendor-performed jobs are standalone one-offs, so they intentionally do
    // not also carry a cleaner assignment.
    const job = await prisma.job.create({
      data: {
        locationId,
        subcontractorId: vendorId ? null : (subcontractorId || null),
        vendorId: vendorId || null,
        scheduleId: scheduleId || null, // Link to schedule if provided (for flat rate billing)
        date: new Date(date + 'T12:00:00'),
        startTime: startTime || null,
        startWindowBegin: startWindowBegin || null,
        startWindowEnd: startWindowEnd || null,
        clientRate,
        subcontractorRate,
        notes: notes || null,
        status: 'SCHEDULED',
        isTrial: isTrial || false,
        trialNotes: trialNotes || null,
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        subcontractor: true,
        vendor: true,
      },
    })

    // Revalidate all job-related pages
    revalidateJobPages(job.location.client.id)

    // Trigger cascading updates
    await cascadeJobUpdate(job.id, 'create', job.subcontractorId || null, job.location.client.id)

    return NextResponse.json(job)
  } catch (error) {
    return handleApiError(error, 'Failed to create job')
  }
}
