import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { sendEmail } from '@/lib/email'
import { daysLate, reminderStage, replySubject } from '@/lib/invoice-tracking'

/** Reminder history for the tracking panel, newest first. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const reminders = await prisma.invoiceReminder.findMany({
      where: { invoiceId: id },
      orderBy: { sentAt: 'desc' },
    })
    return NextResponse.json({ reminders })
  } catch (error) {
    return handleApiError(error, 'Failed to load reminders')
  }
}

/**
 * Sends a late-payment reminder, or logs the stage-3 phone call.
 *
 * The ladder rung is recomputed HERE from the due date rather than trusted from
 * the client: the stage decides whether anything is emailed at all, and a
 * stale browser tab must not be able to email a client we have decided to call.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const body = await request.json().catch(() => ({}))
    const note: string = typeof body?.body === 'string' ? body.body.trim() : ''

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (invoice.status === 'PAID') {
      return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 })
    }
    if (invoice.status !== 'SENT') {
      return NextResponse.json(
        { error: 'Only a sent invoice can be reminded about.' },
        { status: 400 },
      )
    }

    const days = daysLate(invoice)
    const ladder = reminderStage(invoice)
    if (!ladder) {
      return NextResponse.json(
        { error: 'This invoice is not past due yet.' },
        { status: 400 },
      )
    }
    if (!note) {
      return NextResponse.json({ error: 'Add a message before sending.' }, { status: 400 })
    }

    // Stage 3 is a phone call. Record it and email nobody.
    if (ladder.isCall) {
      await prisma.invoiceReminder.create({
        data: { invoiceId: id, stage: ladder.stage, channel: 'CALL', daysLate: days, body: note },
      })
      return NextResponse.json({ success: true, channel: 'CALL', stage: ladder.stage })
    }

    const to = invoice.sentTo || invoice.client.invoicingEmail || invoice.client.communicationEmail
    if (!to) {
      return NextResponse.json(
        { error: 'No email address on file for this client.' },
        { status: 400 },
      )
    }

    const subject = replySubject(invoice.emailSubject, `Invoice ${invoice.invoiceNumber}`)
    const html = note
      .split('\n')
      .map(line => (line.trim() ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : '<p style="margin:0 0 12px">&nbsp;</p>'))
      .join('')

    const result = await sendEmail({
      to,
      subject,
      html,
      text: note,
      // Threads the reminder onto the original invoice email when we recorded
      // its Message-ID; older invoices simply start a new thread.
      inReplyTo: invoice.emailMessageId || undefined,
      references: invoice.emailMessageId || undefined,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send the reminder.' }, { status: 502 })
    }

    await prisma.invoiceReminder.create({
      data: { invoiceId: id, stage: ladder.stage, channel: 'EMAIL', daysLate: days, body: note },
    })

    return NextResponse.json({
      success: true,
      channel: 'EMAIL',
      stage: ladder.stage,
      threaded: Boolean(invoice.emailMessageId),
      // Surfaced so the UI can say the email was held rather than claiming it sent.
      warning: result.warning,
    })
  } catch (error) {
    logger.error('Error sending invoice reminder:', error)
    return handleApiError(error, 'Failed to send the reminder')
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
