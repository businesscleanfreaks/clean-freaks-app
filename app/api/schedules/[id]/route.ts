import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateSchedulePages } from '@/lib/revalidate'
import { updateScheduleSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { triggerSystemRefresh } from '@/lib/cascading-updates'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { parseDateOnlyForStorage } from '@/lib/date-only'

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Get schedule with client info before deleting
    const schedule = await prisma.schedule.findUnique({
      where: { id: params.id },
      include: {
        location: {
          include: {
            client: true,
          },
        },
      },
    })

    if (!schedule) {
      return NextResponse.json(
        { error: 'Schedule not found' },
        { status: 404 }
      )
    }

    // Check if schedule has any invoiced or paid jobs before deletion
    // Jobs that aren't invoiced or paid will be automatically deleted (cascade)
    const invoicedJobCount = await prisma.job.count({
      where: {
        scheduleId: params.id,
        invoiced: true,
      },
    })

    const paidJobCount = await prisma.job.count({
      where: {
        scheduleId: params.id,
        subcontractorPaid: true,
      },
    })

    if (invoicedJobCount > 0) {
      return NextResponse.json(
        { 
          error: `Cannot delete schedule. This schedule has ${invoicedJobCount} invoiced job(s). Please delete the associated invoices first.` 
        },
        { status: 400 }
      )
    }

    if (paidJobCount > 0) {
      return NextResponse.json(
        { 
          error: `Cannot delete schedule. This schedule has ${paidJobCount} job(s) that have been paid to subcontractors. Please handle those payments first.` 
        },
        { status: 400 }
      )
    }

    await prisma.schedule.delete({
      where: { id: params.id },
    })

    // Revalidate all schedule-related pages
    revalidateSchedulePages(schedule.location.client.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting schedule:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete schedule'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}


export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = updateScheduleSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    // Convert date strings to Date objects for Prisma if they're strings
    // Also exclude locationId from update data (it's a relation field and can't be updated)
    // Fix any field name mismatches (e.g., subcontractor -> subcontractorId)
    const { locationId, subcontractor, ...updateData } = validationResult.data as Record<string, unknown>
    if (subcontractor && !updateData.subcontractorId) {
      updateData.subcontractorId = subcontractor
    }
    if (updateData.startDate) {
      updateData.startDate = parseDateOnlyForStorage(updateData.startDate as string | Date)
    }
    if (updateData.endDate) {
      updateData.endDate = parseDateOnlyForStorage(updateData.endDate as string | Date)
    }
    
    // Ensure only valid Prisma fields are included (remove any undefined or null values that might cause issues)
    const cleanUpdateData: Record<string, unknown> = {}
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        cleanUpdateData[key] = updateData[key]
      }
    })
    
    const schedule = await prisma.schedule.update({
      where: { id: params.id },
      data: cleanUpdateData,
      include: {
        location: {
          include: {
            client: true,
          },
        },
      },
    })

    // Regenerate all jobs with updated settings (an explicit edit rebuilds this
    // month's cleans even when a DRAFT invoice was auto-generated for them).
    const summary = await regenerateJobsForSchedule(schedule.id, { rebuildDraftInvoicedJobs: true })

    // Revalidate all schedule-related pages
    revalidateSchedulePages(schedule.location.client.id)

    // Trigger system refresh since job regeneration affects many entities
    await triggerSystemRefresh()

    return NextResponse.json({ ...schedule, regenerationSummary: summary })
  } catch (error) {
    logger.error('Error updating schedule:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to update schedule'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
