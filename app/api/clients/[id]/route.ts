import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateClientPages } from '@/lib/revalidate'
import { updateClientSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { ensureJobsForDateRange, regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { parseDateOnlyForStorage } from '@/lib/date-only'
import { startOfDay } from 'date-fns'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getClientWithDetails(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      locations: {
        include: {
          schedules: {
            include: {
              subcontractor: true,
              recurringAddOnServices: {
                where: { isRecurring: true },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          jobs: {
            select: {
              id: true,
              date: true,
              startTime: true,
              startWindowBegin: true,
              startWindowEnd: true,
              status: true,
              invoiced: true,
              scheduleId: true,
              clientRate: true,
              subcontractorRate: true,
              subcontractor: {
                select: {
                  id: true,
                  name: true,
                },
              },
              schedule: {
                select: {
                  id: true,
                  frequency: true,
                  daysOfWeek: true,
                  defaultClientRate: true,
                  defaultSubcontractorRate: true,
                  timeType: true,
                  startTime: true,
                  startWindowBegin: true,
                  startWindowEnd: true,
                },
              },
            },
            orderBy: {
              date: 'desc',
            },
          },
        },
      },
      invoices: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          dateCreated: true,
        },
        orderBy: {
          dateCreated: 'desc',
        },
        take: 10,
      },
      _count: {
        select: {
          locations: true,
        },
      },
    },
  })
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const today = new Date()
    await ensureJobsForDateRange({
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      endDate: new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59, 999),
    })
    const client = await getClientWithDetails(params.id)

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(client)
  } catch (error) {
    logger.error('Error fetching client:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch client'
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
    
    const validationResult = updateClientSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    const { locations, startDate, ...clientData } = validationResult.data

    // Detect if this is a pause/resume operation
    const isActiveChanging = clientData.isActive !== undefined
    let previousIsActive: boolean | undefined

    if (isActiveChanging) {
      const existing = await prisma.client.findUnique({
        where: { id: params.id },
        select: { isActive: true },
      })
      previousIsActive = existing?.isActive ?? true
    }

    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        ...clientData,
        ...(startDate !== undefined && { startDate: parseDateOnlyForStorage(startDate) }),
      },
      include: {
        locations: {
          include: {
            schedules: {
              include: { subcontractor: true },
            },
          },
        },
      },
    })

    const isPausing = isActiveChanging && previousIsActive === true && clientData.isActive === false
    const isResuming = isActiveChanging && previousIsActive === false && clientData.isActive === true
    let regenerationErrors: Array<{scheduleId: string, error: string}> = []

    if (isPausing) {
      // Cancel all future SCHEDULED jobs for this client
      const now = startOfDay(new Date())
      await prisma.job.updateMany({
        where: {
          location: { clientId: params.id },
          status: 'SCHEDULED',
          date: { gte: now },
          invoiced: false,
        },
        data: { status: 'CANCELLED' },
      })

      // Deactivate all schedules
      for (const location of client.locations) {
        await prisma.schedule.updateMany({
          where: { locationId: location.id },
          data: { isActive: false },
        })
      }

      logger.info(`[pauseClient] Paused client ${params.id}: cancelled future jobs and deactivated schedules`)
    }

    if (isResuming) {
      // First, clean up stale future jobs from the pause
      // so regeneration doesn't hit unique constraint violations
      const now = startOfDay(new Date())
      const locationIds = client.locations.map(l => l.id)

      try {
        // Find all CANCELLED+SCHEDULED future uninvoiced jobs for cleanup
        const jobsToClean = await prisma.job.findMany({
          where: {
            location: { id: { in: locationIds } },
            status: { in: ['CANCELLED', 'SCHEDULED'] },
            date: { gte: now },
            invoiced: false,
            subcontractorPaid: false,
          },
          select: { id: true },
        })

        if (jobsToClean.length > 0) {
          const jobIds = jobsToClean.map(j => j.id)

          // Delete related payment line items first (FK constraint)
          await prisma.subcontractorPaymentLineItem.deleteMany({
            where: { jobId: { in: jobIds } },
          })

          // Delete related add-on services linked to these jobs
          await prisma.addOnService.deleteMany({
            where: { jobId: { in: jobIds } },
          })

          // Now delete the jobs themselves
          const cleanedUp = await prisma.job.deleteMany({
            where: { id: { in: jobIds } },
          })
          logger.info(`[resumeClient] Cleaned up ${cleanedUp.count} future jobs for client ${params.id}`)
        }
      } catch (cleanupError) {
        logger.error(`[resumeClient] Non-fatal cleanup error for ${params.id}:`, cleanupError)
        // Continue anyway — regeneration may still work if the constraint issue was elsewhere
      }

      // Reactivate all schedules and regenerate jobs
      const allScheduleIds: string[] = []

      for (const location of client.locations) {
        await prisma.schedule.updateMany({
          where: { locationId: location.id },
          data: { isActive: true },
        })

        // Get ALL schedules for this location (not just updated ones)
        const schedules = await prisma.schedule.findMany({
          where: { locationId: location.id, isActive: true },
          select: { id: true },
        })
        allScheduleIds.push(...schedules.map(s => s.id))
      }

      for (const scheduleId of allScheduleIds) {
        try {
          await regenerateJobsForSchedule(scheduleId)
        } catch (regenError) {
          const errorMsg = regenError instanceof Error ? regenError.message : String(regenError)
          regenerationErrors.push({scheduleId, error: errorMsg})
          logger.error(`[resumeClient] Failed to regenerate schedule ${scheduleId}:`, regenError)
        }
      }

      if (regenerationErrors.length > 0 && regenerationErrors.length === allScheduleIds.length) {
        // CRITICAL: If ALL schedules failed, revert the client back to paused state
        // to avoid leaving the client in an inconsistent state
        await prisma.client.update({
          where: { id: params.id },
          data: { isActive: false },
        })
        
        // Also deactivate the schedules we just activated
        for (const location of client.locations) {
          await prisma.schedule.updateMany({
            where: { locationId: location.id },
            data: { isActive: false },
          })
        }

        logger.error(`[resumeClient] Failed to resume client ${params.id}: all schedule regenerations failed. Client reverted to paused state.`)
        return NextResponse.json(
          {
            error: 'Failed to resume client. Schedule regeneration failed. Client remains paused. Please try again.',
            details: {
              failedSchedules: regenerationErrors,
              totalSchedules: allScheduleIds.length,
            }
          },
          { status: 500 }
        )
      }

      logger.info(`[resumeClient] Resumed client ${params.id}: reactivated ${allScheduleIds.length} schedules (${regenerationErrors.length} errors)`)
    }

    revalidateClientPages(client.id)

    // Return pause/resume summary if applicable
    if (isPausing || isResuming) {
      const refreshedClient = await getClientWithDetails(params.id)
      return NextResponse.json({
        ...(refreshedClient || client),
        _pauseResumeApplied: true,
        _scheduleRegenerationErrors: regenerationErrors,
      })
    }

    return NextResponse.json(client)
  } catch (error) {
    logger.error('Error updating client:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to update client'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Safety check: count linked records to prevent destroying real data
    const [jobCount, invoiceCount, scheduleCount, paymentLineCount] = await prisma.$transaction([
      prisma.job.count({ where: { location: { clientId: params.id } } }),
      prisma.invoice.count({ where: { clientId: params.id } }),
      prisma.schedule.count({ where: { location: { clientId: params.id } } }),
      prisma.subcontractorPaymentLineItem.count({
        where: { job: { location: { clientId: params.id } } },
      }),
    ])

    const totalLinked = jobCount + invoiceCount + scheduleCount + paymentLineCount

    if (totalLinked > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete: this client has linked history. Use Archive instead.',
          details: {
            jobs: jobCount,
            invoices: invoiceCount,
            schedules: scheduleCount,
            payments: paymentLineCount,
          },
        },
        { status: 409 }
      )
    }

    // Safe to permanently delete — no linked history
    await prisma.$transaction(async (tx) => {
      // Delete any client contacts
      await tx.clientContact.deleteMany({ where: { clientId: params.id } })

      // Delete the client (cascades locations via schema)
      await tx.client.delete({ where: { id: params.id } })
    })

    // Revalidate all client-related pages
    revalidateClientPages()

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting client:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete client'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
