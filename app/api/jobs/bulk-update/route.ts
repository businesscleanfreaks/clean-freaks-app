import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

const bulkUpdateSchema = z.object({
  jobIds: z.array(z.string()).min(1, 'At least one job ID is required'),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  subcontractorId: z.string().nullable().optional(),
  invoiced: z.boolean().optional(),
})

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    
    const validationResult = bulkUpdateSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }

    const { jobIds, status, subcontractorId, invoiced } = validationResult.data

    // Verify all jobs exist
    const existingJobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
      },
    })

    if (existingJobs.length !== jobIds.length) {
      return createErrorResponse(
        'Some jobs were not found',
        404,
        'NOT_FOUND'
      )
    }

    // Build update data
    const updateData: { status?: string; subcontractorId?: string | null; invoiced?: boolean } = {}
    if (status !== undefined) {
      updateData.status = status
    }
    if (subcontractorId !== undefined) {
      updateData.subcontractorId = subcontractorId
    }
    if (invoiced !== undefined) {
      updateData.invoiced = invoiced
    }

    // Update all jobs
    const result = await prisma.job.updateMany({
      where: {
        id: { in: jobIds },
      },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      updated: result.count,
      message: `Successfully updated ${result.count} job${result.count !== 1 ? 's' : ''}`,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to update jobs')
  }
}

// Frontend sends POST for mark-as-invoiced — reuse the same handler
export const POST = PUT
