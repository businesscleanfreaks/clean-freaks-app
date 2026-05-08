import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateClientPages } from '@/lib/revalidate'
import { updateClientSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { startOfDay } from 'date-fns'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const client = await prisma.client.findUnique({
      where: { id: params.id },
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
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
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
        const updated = await prisma.schedule.updateMany({
          where: { locationId: location.id },
          data: { isActive: true },
        })
        if (updated.count > 0) {
          const schedules = await prisma.schedule.findMany({
            where: { locationId: location.id },
            select: { id: true },
          })
          allScheduleIds.push(...schedules.map(s => s.id))
        }
      }

      let regenerationErrors = 0
      for (const scheduleId of allScheduleIds) {
        try {
          await regenerateJobsForSchedule(scheduleId)
        } catch (regenError) {
          regenerationErrors++
          logger.error(`[resumeClient] Failed to regenerate schedule ${scheduleId}:`, regenError)
        }
      }

      if (regenerationErrors > 0 && regenerationErrors === allScheduleIds.length) {
        // Only fail if ALL schedules failed
        return NextResponse.json(
          { error: 'Failed to resume client. Schedule regeneration failed. Please try again.' },
          { status: 500 }
        )
      }

      logger.info(`[resumeClient] Resumed client ${params.id}: reactivated ${allScheduleIds.length} schedules (${regenerationErrors} errors)`)
    }

    revalidateClientPages(client.id)

    // Return pause/resume summary if applicable
    if (isPausing || isResuming) {
      return NextResponse.json({ ...client, _pauseResumeApplied: true })
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
    // Get all jobs for this client to find related payments
    const clientJobs = await prisma.job.findMany({
      where: {
        location: {
          clientId: params.id,
        },
      },
      select: {
        id: true,
      },
    })

    const jobIds = clientJobs.map(job => job.id)

    // Use transaction to ensure all deletions happen atomically
    await prisma.$transaction(async (tx) => {
      // 1. Delete all invoices for this client (this will cascade delete invoice line items)
      // Jobs will be automatically unmarked as invoiced when invoices are deleted
      await tx.invoice.deleteMany({
        where: {
          clientId: params.id,
        },
      })

      // 2. Find all subcontractor payments that reference jobs from this client
      const paymentsToDelete = await tx.subcontractorPayment.findMany({
        where: {
          lineItems: {
            some: {
              jobId: {
                in: jobIds,
              },
            },
          },
        },
        select: {
          id: true,
        },
      })

      const paymentIds = paymentsToDelete.map(p => p.id)

      // 3. Delete subcontractor payment line items that reference these jobs
      // This will unlink the payments from the jobs
      await tx.subcontractorPaymentLineItem.deleteMany({
        where: {
          jobId: {
            in: jobIds,
          },
        },
      })

      // 4. Delete payments that no longer have any line items (orphaned payments)
      // First, find payments with no remaining line items
      const orphanedPayments = await tx.subcontractorPayment.findMany({
        where: {
          id: {
            in: paymentIds,
          },
        },
        include: {
          lineItems: true,
        },
      })

      const paymentsToRemove = orphanedPayments
        .filter(payment => payment.lineItems.length === 0)
        .map(payment => payment.id)

      if (paymentsToRemove.length > 0) {
        await tx.subcontractorPayment.deleteMany({
          where: {
            id: {
              in: paymentsToRemove,
            },
          },
        })
      }

      // 5. Unmark all jobs as paid (since we're deleting the payments)
      await tx.job.updateMany({
        where: {
          id: {
            in: jobIds,
          },
          subcontractorPaid: true,
        },
        data: {
          subcontractorPaid: false,
        },
      })

      // 6. Finally, delete the client (this will cascade delete locations, schedules, and jobs)
      await tx.client.delete({
        where: { id: params.id },
      })
    })

    // Revalidate all client-related pages
    revalidateClientPages()

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting client:', error)
    // Provide more helpful error message
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete client'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
