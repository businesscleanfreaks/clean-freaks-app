import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { evaluateInvoiceForSend } from '@/lib/invoice-guard'

/**
 * Mark an invoice as SENT without emailing it — for invoices that were sent to
 * the client outside the app ("taken care of"). Never downgrades a PAID invoice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)

    let confirmMismatch = false
    try {
      const body = await request.json()
      confirmMismatch = body?.confirmMismatch === true
    } catch {
      // No JSON body — treat as unconfirmed.
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Already paid → leave it; sending status is a step behind paid.
    if (invoice.status === 'PAID') {
      return NextResponse.json({ success: true, message: 'Invoice already paid' })
    }

    // Pre-send guard: don't let a stale invoice go out unless explicitly confirmed.
    if (!confirmMismatch) {
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

    await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        status: 'SENT',
        dateSent: invoice.dateSent || new Date(),
        sentTo: invoice.sentTo || 'Sent outside the app',
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${resolvedParams.id}`)

    return NextResponse.json({ success: true, message: 'Invoice marked as sent' })
  } catch (error) {
    logger.error('Error marking invoice as sent:', error)
    return NextResponse.json({ error: 'Failed to mark invoice as sent' }, { status: 500 })
  }
}
