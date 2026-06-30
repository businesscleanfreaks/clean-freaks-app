import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

/**
 * Mark jobs as already invoiced (without creating an invoice)
 * Used for historical jobs that were invoiced outside the system
 */
export async function POST(request: Request) {
  try {
    await requireAuth()

    const body = await request.json()
    const { jobIds } = body

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json(
        { error: 'jobIds array is required' },
        { status: 400 }
      )
    }

    // Validate all job IDs exist and are completed
    const jobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
      },
    })

    if (jobs.length !== jobIds.length) {
      return NextResponse.json(
        { error: 'Some job IDs not found' },
        { status: 404 }
      )
    }

    // Check that no jobs are cancelled
    const cancelledJobs = jobs.filter(job => job.status === 'CANCELLED')
    if (cancelledJobs.length > 0) {
      return NextResponse.json(
        { 
          error: `Cannot mark cancelled jobs as invoiced. ${cancelledJobs.length} job(s) are cancelled.`,
          cancelledJobs: cancelledJobs.map(j => ({ id: j.id, status: j.status }))
        },
        { status: 400 }
      )
    }

    // Auto-complete any SCHEDULED jobs as part of marking invoiced
    const scheduledJobs = jobs.filter(job => job.status === 'SCHEDULED')
    if (scheduledJobs.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: scheduledJobs.map(j => j.id) } },
        data: { status: 'COMPLETED' },
      })
    }

    // Check that jobs aren't already invoiced
    const alreadyInvoiced = jobs.filter(job => job.invoiced === true)
    if (alreadyInvoiced.length > 0) {
      return NextResponse.json(
        { 
          error: `${alreadyInvoiced.length} job(s) are already marked as invoiced.`,
          alreadyInvoiced: alreadyInvoiced.map(j => ({ id: j.id }))
        },
        { status: 400 }
      )
    }

    // Update jobs to invoiced = true
    const result = await prisma.job.updateMany({
      where: {
        id: { in: jobIds },
        invoiced: false,
      },
      data: {
        invoiced: true,
      },
    })

    logger.info(`[Mark Invoiced] Marked ${result.count} job(s) as already invoiced`)

    return NextResponse.json({
      success: true,
      message: `Marked ${result.count} job(s) as already invoiced`,
      count: result.count,
    })
  } catch (error) {
    logger.error('Error marking jobs as invoiced:', error)
    return handleApiError(error, 'Failed to mark jobs as invoiced')
  }
}
