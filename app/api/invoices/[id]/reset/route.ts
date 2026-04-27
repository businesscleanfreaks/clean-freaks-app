import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

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
            job: true,
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
      // Full reset: Delete invoice and unmark jobs
      logger.info('Full reset for invoice:', invoice.invoiceNumber)

      // Get job IDs from line items
      const jobIds = invoice.lineItems
        .filter(item => item.jobId)
        .map(item => item.jobId as string)

      // Unmark jobs as invoiced
      if (jobIds.length > 0) {
        await prisma.job.updateMany({
          where: { id: { in: jobIds } },
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
