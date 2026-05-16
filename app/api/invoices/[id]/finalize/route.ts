import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Finalize a preview invoice by marking its jobs as invoiced
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const directJobIds = invoice.lineItems
      .map(item => item.jobId)
      .filter((jobId): jobId is string => jobId !== null)
    const scheduleMonthKeys = new Map<string, { scheduleId: string; monthStart: Date; monthEnd: Date }>()

    invoice.lineItems.forEach((item) => {
      if (!item.job?.scheduleId) return
      const date = new Date(item.job.date)
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
      scheduleMonthKeys.set(`${item.job.scheduleId}:${monthStart.toISOString()}`, {
        scheduleId: item.job.scheduleId,
        monthStart,
        monthEnd,
      })
    })

    const relatedRecurringJobs = scheduleMonthKeys.size > 0
      ? await prisma.job.findMany({
          where: {
            status: { not: 'CANCELLED' },
            OR: Array.from(scheduleMonthKeys.values()).map((entry) => ({
              scheduleId: entry.scheduleId,
              date: { gte: entry.monthStart, lte: entry.monthEnd },
            })),
          },
          select: { id: true },
        })
      : []

    const jobIds = [...new Set([...directJobIds, ...relatedRecurringJobs.map(job => job.id)])]

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
    return NextResponse.json(
      { error: 'Failed to finalize invoice' },
      { status: 500 }
    )
  }
}
