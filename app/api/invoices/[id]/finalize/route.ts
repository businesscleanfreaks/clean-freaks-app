import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { finalizeTargets } from '@/lib/invoice-finalize'

// Finalize a preview invoice by marking its jobs as invoiced
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()

    const { id } = await params

    // Get the invoice with its line items
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            job: {
              select: {
                id: true,
                scheduleId: true,
                date: true,
                schedule: { select: { clientPayType: true } },
              },
            },
          },
        },
        client: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // What this invoice actually bills for. The schedule-month sweep below
    // exists for flat-rate months, where one line covers every clean · it used
    // to run for per-clean schedules too, stamping the cleans the reviewer had
    // taken OFF the invoice as billed. See lib/invoice-finalize.ts.
    const targets = finalizeTargets(
      invoice.lineItems.map((item) => ({
        jobId: item.jobId,
        job: item.job
          ? {
              id: item.job.id,
              scheduleId: item.job.scheduleId,
              date: item.job.date,
              billsMonthly: item.job.schedule?.clientPayType === 'FLAT_RATE',
            }
          : null,
      }))
    )

    const relatedRecurringJobs = targets.scheduleMonths.length > 0
      ? await prisma.job.findMany({
          where: {
            status: { not: 'CANCELLED' },
            OR: targets.scheduleMonths.map((entry) => ({
              scheduleId: entry.scheduleId,
              date: { gte: entry.monthStart, lte: entry.monthEnd },
            })),
          },
          select: { id: true },
        })
      : []

    const jobIds = [...new Set([...targets.jobIds, ...relatedRecurringJobs.map(job => job.id)])]

    if (jobIds.length > 0) {
      // Mark jobs as invoiced
      await prisma.job.updateMany({
        where: {
          id: { in: jobIds },
        },
        data: {
          invoiced: true,
        },
      })
    }

    if (invoice.status === 'VOID') {
      await prisma.invoice.update({
        where: { id },
        data: { status: 'DRAFT' },
      })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Invoice finalized and jobs marked as invoiced',
      jobsMarked: jobIds.length,
    })
  } catch (error) {
    console.error('Error finalizing invoice:', error)
    return handleApiError(error, 'Failed to finalize invoice')
  }
}
