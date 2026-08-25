import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

/**
 * Mark an invoice as billed by hand outside the app.
 *
 * Josh's case (2026-08-25): a client was invoiced through QuickBooks, so the
 * app's own draft is redundant — but deleting it loses the record of what was
 * billed for that month. This keeps the invoice and takes it out of the send
 * queue, leaving something to look up later.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json().catch(() => ({}))
    const rawNote = typeof body?.note === 'string' ? body.note.trim() : ''
    if (rawNote.length > 500) {
      return NextResponse.json({ error: 'Note is too long' }, { status: 400 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, status: true, clientId: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    // A sent or paid invoice went out through the app; calling it externally
    // billed would make the history contradict itself.
    if (invoice.status === 'SENT' || invoice.status === 'PAID') {
      return NextResponse.json(
        { error: 'This invoice was already sent from the app.' },
        { status: 409 },
      )
    }

    const updated = await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        externallyBilledAt: new Date(),
        externallyBilledNote: rawNote || null,
      },
      select: { id: true, externallyBilledAt: true, externallyBilledNote: true },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${resolvedParams.id}`)
    return NextResponse.json({ success: true, invoice: updated })
  } catch (error) {
    logger.error('Error marking invoice as externally billed:', error)
    return handleApiError(error, 'Failed to mark as billed outside the app')
  }
}

/** Undo it — the mark is a note about reality, and reality gets corrected. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const resolvedParams = await Promise.resolve(params)

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: { externallyBilledAt: null, externallyBilledNote: null },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${resolvedParams.id}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error clearing external-billing mark:', error)
    return handleApiError(error, 'Failed to undo')
  }
}
