import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateInvoicePages } from '@/lib/revalidate'
import { updateInvoiceSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { evaluateInvoiceForSend } from '@/lib/invoice-guard'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        client: true,
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
          },
          orderBy: {
            serviceDate: 'asc',
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(invoice)
  } catch (error) {
    logger.error('Error fetching invoice:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoice' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    
    // Validate request body
    const validationResult = updateInvoiceSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    const { status, showPaymentOptions } = validationResult.data
    const confirmMismatch = body?.confirmMismatch === true

    // Pre-send guard: block marking a DRAFT as SENT if it no longer matches the
    // schedule, unless explicitly confirmed. (Un-marking PAID→SENT is exempt.)
    if (status === 'SENT' && !confirmMismatch) {
      const current = await prisma.invoice.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true },
      })
      if (current?.status === 'DRAFT') {
        const guard = await evaluateInvoiceForSend(resolvedParams.id)
        if (!guard.matches) {
          return NextResponse.json(
            {
              error: 'This invoice no longer matches the schedule. Review and confirm before marking it sent.',
              code: 'INVOICE_MISMATCH',
              findings: guard.findings,
            },
            { status: 409 },
          )
        }
      }
    }

    const updateData: { status?: string; showPaymentOptions?: boolean } = {}
    if (status !== undefined) updateData.status = status
    if (showPaymentOptions !== undefined) updateData.showPaymentOptions = showPaymentOptions

    const invoice = await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: updateData,
      include: {
        client: true,
        lineItems: true,
      },
    })

    // Revalidate all invoice-related pages
    revalidateInvoicePages(invoice.client.id)

    return NextResponse.json(invoice)
  } catch (error) {
    logger.error('Error updating invoice:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)

    logger.debug('[DELETE] Deleting invoice:', resolvedParams.id)

    // Get the invoice first to find all associated jobs
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        lineItems: true,
        client: true,
      },
    })

    if (!invoice) {
      logger.debug('[DELETE] Invoice not found:', resolvedParams.id)
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    logger.debug('[DELETE] Found invoice with', invoice.lineItems.length, 'line items')

    // Get all job IDs from line items
    const jobIdsFromLineItems = invoice.lineItems
      .filter(item => item.jobId)
      .map(item => item.jobId as string)

    logger.debug('[DELETE] Job IDs from line items:', jobIdsFromLineItems.length)

    // For flat-rate schedules, recurring invoice line items only store a representative job.
    // Unmark jobs from the represented schedules/month only, not every recurring job for the client.
    let jobIdsToUnmark = jobIdsFromLineItems

    // Determine billing type from the schedule (source of truth)
    let isFlatRate = false
    if (jobIdsFromLineItems.length > 0) {
      const sampleJob = await prisma.job.findFirst({
        where: { id: { in: jobIdsFromLineItems }, scheduleId: { not: null } },
        include: { schedule: true },
      })
      isFlatRate = sampleJob?.schedule?.clientPayType === 'FLAT_RATE'
    }

    if (isFlatRate && jobIdsFromLineItems.length > 0) {
      // Find the service date from the first line item
      const serviceDate = invoice.lineItems[0]?.serviceDate
      if (serviceDate) {
        const lineItemJobs = await prisma.job.findMany({
          where: { id: { in: jobIdsFromLineItems }, scheduleId: { not: null } },
          select: { scheduleId: true },
        })
        const scheduleIds = [...new Set(lineItemJobs.map(job => job.scheduleId).filter(Boolean) as string[])]

        const date = new Date(serviceDate)
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59)

        const relatedJobs = await prisma.job.findMany({
          where: {
            invoiced: true,
            scheduleId: { in: scheduleIds },
            date: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
          select: {
            id: true,
          },
        })

        // Combine recurring jobs with one-off jobs from line items
        const recurringJobIds = relatedJobs.map(job => job.id)
        jobIdsToUnmark = [...new Set([...recurringJobIds, ...jobIdsFromLineItems])]
        logger.debug('[DELETE] Found', recurringJobIds.length, 'recurring jobs and', jobIdsFromLineItems.length, 'one-off jobs to unmark')
      }
    }

    logger.debug('[DELETE] Unmarking', jobIdsToUnmark.length, 'jobs as invoiced')

    // Use transaction to ensure job updates and invoice deletion happen atomically
    await prisma.$transaction(async (tx) => {
      // Mark jobs as not invoiced
      if (jobIdsToUnmark.length > 0) {
        await tx.job.updateMany({
          where: {
            id: { in: jobIdsToUnmark },
          },
          data: {
            invoiced: false,
          },
        })
      }

      // Delete the invoice (line items will be cascade deleted)
      logger.debug('[DELETE] Deleting invoice from database')
      await tx.invoice.delete({
        where: { id: resolvedParams.id },
      })
    })

    logger.info('[DELETE] Invoice deleted successfully')

    // Revalidate all invoice-related pages
    revalidateInvoicePages(invoice.client.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[DELETE] Error deleting invoice:', error)
    return NextResponse.json(
      { error: 'Failed to delete invoice', details: (error as Error).message },
      { status: 500 }
    )
  }
}
