import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateInvoicePages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'

/**
 * POST /api/invoices/from-candidate
 *
 * Creates a DRAFT invoice from a candidate's pre-computed line items.
 * Includes duplicate detection via billing period dates.
 */
export async function POST(request: Request) {
  try {
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

    // 1. Duplicate detection — check by billing period overlap
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        clientId,
        status: { not: 'VOID' },
        OR: [
          // Exact billing period match
          {
            billingPeriodStart: { lte: periodEnd },
            billingPeriodEnd: { gte: periodStart },
          },
          // Fallback: check if any of the source jobs are already invoiced
          ...(sourceJobIds && sourceJobIds.length > 0 ? [{
            lineItems: {
              some: {
                jobId: { in: sourceJobIds },
              },
            },
          }] : []),
        ],
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

    // 3. Generate invoice number
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
    const latestInvoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: { startsWith: `INV-${dateStr}-` } },
      orderBy: { invoiceNumber: 'desc' },
    })
    let sequence = 1
    if (latestInvoice) {
      const lastSeq = parseInt(latestInvoice.invoiceNumber.split('-')[2])
      sequence = lastSeq + 1
    }
    const invoiceNumber = `INV-${dateStr}-${sequence.toString().padStart(4, '0')}`

    // 4. Calculate total from line items
    const totalAmount = lineItems.reduce(
      (sum: number, item: { amount: number }) => sum + (item.amount || 0),
      0
    )

    // 5. Create invoice in a transaction
    const invoice = await prisma.$transaction(async (tx) => {
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
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
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
    })

    revalidateInvoicePages(clientId)

    return NextResponse.json(invoice)
  } catch (error) {
    logger.error('Error creating invoice from candidate:', error)
    const message = error instanceof Error ? error.message : 'Failed to create invoice'
    const status = message.includes('already invoiced') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
