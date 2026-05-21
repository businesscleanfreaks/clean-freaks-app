import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

const FINAL_INVOICE_STATUSES = ['SENT', 'PAID']

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/**
 * Reset invoice for testing purposes
 * POST /api/invoices/[id]/reset
 * 
 * Options:
 * - type: 'status' - Just reset status from PAID back to SENT
 * - type: 'full' - Delete invoice and unmark jobs as invoiced
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params)
    const { id } = resolvedParams
    const body = await request.json().catch(() => ({}))
    const resetType = body.type || 'status'

    // Get the invoice with line items
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
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    if (resetType === 'full') {
      if (FINAL_INVOICE_STATUSES.includes(invoice.status)) {
        return NextResponse.json(
          { error: `Invoice ${invoice.invoiceNumber} is ${invoice.status.toLowerCase()} and cannot be returned to Review. Void or status-reset it first.` },
          { status: 409 }
        )
      }

      // Full reset: Delete invoice and unmark jobs
      logger.info('Full reset for invoice:', invoice.invoiceNumber)

      // Get direct jobs from line items, and expand flat-rate recurring
      // line items to every job in the same schedule/month.
      const directJobIds = uniqueStrings(invoice.lineItems.map(item => item.jobId))
      const scheduleMonthKeys = new Map<string, { scheduleId: string; monthStart: Date; monthEnd: Date }>()

      invoice.lineItems.forEach(item => {
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
              OR: Array.from(scheduleMonthKeys.values()).map(entry => ({
                scheduleId: entry.scheduleId,
                date: { gte: entry.monthStart, lte: entry.monthEnd },
              })),
              invoiceLineItems: {
                none: { invoice: { status: { in: FINAL_INVOICE_STATUSES } } },
              },
            },
            select: { id: true },
          })
        : []

      const jobIds = uniqueStrings([
        ...directJobIds,
        ...relatedRecurringJobs.map(job => job.id),
      ])

      // Unmark jobs as invoiced
      if (jobIds.length > 0) {
        await prisma.job.updateMany({
          where: {
            id: { in: jobIds },
            invoiceLineItems: {
              none: { invoice: { status: { in: FINAL_INVOICE_STATUSES } } },
            },
          },
          data: { invoiced: false },
        })
        logger.info('Unmarked jobs as invoiced:', jobIds.length)
      }

      // Delete the invoice (cascades to line items)
      await prisma.invoice.delete({
        where: { id },
      })

      logger.info('Invoice deleted:', invoice.invoiceNumber)

      revalidatePath('/invoices')
      revalidatePath(`/clients/${invoice.clientId}`)

      return NextResponse.json({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} deleted. ${jobIds.length} job(s) returned to ready-to-bill.`,
        deletedInvoice: invoice.invoiceNumber,
        jobsReset: jobIds.length,
        redirectTo: `/clients/${invoice.clientId}`,
      })
    } else {
      // Status reset: Just reset payment info
      logger.info('Status reset for invoice:', invoice.invoiceNumber)

      const updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: {
          status: 'SENT',
          paymentMethod: null,
          paymentTransactionId: null,
          paymentReceivedAt: null,
          datePaid: null,
          paymentNotes: null,
        },
      })

      logger.info('Invoice reset to SENT:', updatedInvoice.invoiceNumber)

      revalidatePath('/invoices')
      revalidatePath(`/invoices/${id}`)
      revalidatePath('/view-invoice/[token]')

      return NextResponse.json({
        success: true,
        message: `Invoice ${invoice.invoiceNumber} reset to SENT status. You can test payment again.`,
        invoice: {
          id: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          status: updatedInvoice.status,
        },
      })
    }
  } catch (error) {
    logger.error('Error resetting invoice:', error)
    return NextResponse.json(
      { error: 'Failed to reset invoice' },
      { status: 500 }
    )
  }
}
