import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createWithInvoiceNumber } from '@/lib/allocate-invoice-number'
import { revalidateInvoicePages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { parseDateOnlyForStorage } from '@/lib/date-only'

/**
 * POST /api/invoices/from-candidate
 *
 * Creates a DRAFT invoice from a candidate's pre-computed line items.
 * Includes duplicate detection via billing period dates.
 */
export async function POST(request: Request) {
  try {
    await requireAuth()

    const body = await request.json()
    const {
      clientId,
      start,     // YYYY-MM-DD
      end,       // YYYY-MM-DD
      lineItems, // Array<{ description, amount, jobId?, addOnServiceId? }>
      sourceJobIds, // string[]
    } = body

    if (!clientId || !start || !end || !lineItems || lineItems.length === 0) {
      return NextResponse.json(
        { error: 'clientId, start, end, and lineItems are required' },
        { status: 400 }
      )
    }

    const periodStart = new Date(start + 'T00:00:00')
    const periodEnd = new Date(end + 'T23:59:59.999')

    // 1. Duplicate detection. When source jobs are provided, job overlap is
    // the source of truth so separate-location invoices can share a period.
    const duplicateChecks = sourceJobIds && sourceJobIds.length > 0
      ? [{
          lineItems: {
            some: {
              jobId: { in: sourceJobIds },
            },
          },
        }]
      : [{
          billingPeriodStart: { lte: periodEnd },
          billingPeriodEnd: { gte: periodStart },
        }]

    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        clientId,
        status: { not: 'VOID' },
        OR: duplicateChecks,
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
      },
    })

    if (existingInvoice) {
      return NextResponse.json(
        {
          error: 'An invoice already exists for this client and billing period',
          existingInvoice: {
            id: existingInvoice.id,
            invoiceNumber: existingInvoice.invoiceNumber,
            status: existingInvoice.status,
            totalAmount: existingInvoice.totalAmount,
          },
        },
        { status: 409 }
      )
    }

    // 2. Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    })

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    // 3. The invoice number is allocated inside the retry below, so a clash
    //    with a simultaneous create takes the next number instead of failing.

    // 4. Calculate total from line items
    const totalAmount = lineItems.reduce(
      (sum: number, item: { amount: number }) => sum + (item.amount || 0),
      0
    )

    // 5. Create invoice in a transaction
    const invoice = await createWithInvoiceNumber((invoiceNumber) => prisma.$transaction(async (tx) => {
      // Double-check no source jobs have been invoiced in the meantime
      if (sourceJobIds && sourceJobIds.length > 0) {
        const alreadyInvoiced = await tx.job.findMany({
          where: { id: { in: sourceJobIds }, invoiced: true },
          select: { id: true },
        })
        if (alreadyInvoiced.length > 0) {
          throw new Error(
            `${alreadyInvoiced.length} job(s) are already invoiced. Please refresh and try again.`
          )
        }
      }

      // Create the invoice
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          clientId,
          totalAmount,
          status: 'DRAFT',
          // Stored as DAY values at noon UTC, because they are read back with
          // UTC accessors to decide which month the invoice belongs to. Local
          // midnight on the 1st is the last day of the previous month in UTC
          // for anyone ahead of it, which files the invoice a month early.
          billingPeriodStart: parseDateOnlyForStorage(start),
          billingPeriodEnd: parseDateOnlyForStorage(end),
          showPaymentOptions: true,
          lineItems: {
            create: lineItems.map((item: {
              description: string
              amount: number
              jobId?: string
              addOnServiceId?: string
              serviceDate?: string
            }) => ({
              description: item.description,
              amount: item.amount,
              jobId: item.jobId || null,
              addOnServiceId: item.addOnServiceId || null,
              serviceDate: item.serviceDate ? new Date(item.serviceDate) : periodStart,
            })),
          },
        },
        include: {
          client: true,
          lineItems: true,
        },
      })

      // Mark source jobs as invoiced
      if (sourceJobIds && sourceJobIds.length > 0) {
        await tx.job.updateMany({
          where: { id: { in: sourceJobIds } },
          data: { invoiced: true },
        })
      }

      return newInvoice
    }))

    revalidateInvoicePages(clientId)

    return NextResponse.json(invoice)
  } catch (error) {
    logger.error('Error creating invoice from candidate:', error)
    if (error instanceof Error && error.message === 'Unauthorized') {
      return handleApiError(error, 'Failed to create invoice')
    }
    const message = error instanceof Error ? error.message : 'Failed to create invoice'
    const status = message.includes('already invoiced') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
