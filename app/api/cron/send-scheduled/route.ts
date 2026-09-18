import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { getEmailConfig } from '@/lib/email-settings'
import { classifySendResult, marksInvoiceSent, realSendingEnabled } from '@/lib/email-send-outcome'
import { generateInvoiceEmail } from '@/lib/email-templates'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { logger } from '@/lib/logger'
import { generateInvoiceToken } from '@/lib/invoice-tokens'
import { getBaseUrl } from '@/lib/url'
import { authorizeCron } from '@/lib/cron-auth'
import { alertOperationalIssue } from '@/lib/error-alerting'
import { threadableMessageId } from '@/lib/email-send-outcome'
import { evaluateInvoiceForSend } from '@/lib/invoice-guard'
import { decideScheduledSend, SENDABLE_STATUSES } from '@/lib/scheduled-send'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ScheduledPayload {
  to: string[]
  cc?: string
  subject: string
  message: string
  showPaymentOptions?: boolean
}

/**
 * Find invoices whose scheduled send time has arrived and email them, reusing
 * the same helpers as the manual send. Respects the email safety flags: when
 * sending is disabled the invoice is left scheduled so it goes out once enabled.
 */
async function processDueInvoices() {
  const now = new Date()
  const due = await prisma.invoice.findMany({
    where: {
      // `lte` on a nullable column already excludes NULLs (unscheduled invoices).
      scheduledSendAt: { lte: now },
      // An explicit allow-list. This was `notIn: ['SENT', 'PAID']`, and VOID is
      // neither · so a deliberately voided invoice with a schedule still on it
      // would have been emailed to the client.
      status: { in: [...SENDABLE_STATUSES] },
    },
    include: { client: true, lineItems: true },
    orderBy: { scheduledSendAt: 'asc' },
    take: 50,
  })

  // From the same config Settings → Email writes, not the environment. Reading
  // env here while `sendEmail` reads the row meant a paused send could still
  // stamp an invoice SENT with nothing delivered.
  const emailConfig = await getEmailConfig()
  const realSendingOn = realSendingEnabled(emailConfig)
  const hasCredentials =
    emailConfig.provider === 'resend'
      ? !!emailConfig.resendApiKey
      : !!emailConfig.gmailUser && !!emailConfig.gmailAppPassword

  const results: Array<{ id: string; status: string; error?: string }> = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const invoice of due) {
    const payload = invoice.scheduledPayload as unknown as ScheduledPayload | null
    const hasPayload = !!payload && Array.isArray(payload.to) && payload.to.length > 0

    // The same check a person gets before a real manual send: does this invoice
    // still match the work it bills for. The clock ran no check at all, so a
    // scheduled invoice could go out billing a clean that had been cancelled.
    let scheduleMatches = true
    if (hasPayload) {
      try {
        scheduleMatches = (await evaluateInvoiceForSend(invoice.id)).matches
      } catch (err) {
        // Cannot tell: hold rather than send. Late is a nuisance, wrong is not.
        logger.warn(`[cron:send-scheduled] guard failed for ${invoice.id}`, err)
        scheduleMatches = false
      }
    }

    const decision = decideScheduledSend({
      status: invoice.status,
      hasPayload,
      realSendingOn,
      hasCredentials,
      scheduleMatches,
    })

    if (decision.action === 'discard') {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { scheduledSendAt: null, scheduledPayload: Prisma.DbNull },
      })
      skipped++
      results.push({ id: invoice.id, status: `discarded:${decision.reason}` })
      continue
    }

    if (decision.action === 'hold') {
      skipped++
      results.push({ id: invoice.id, status: `skipped:${decision.reason}` })
      continue
    }

    // CLAIM IT. One UPDATE, conditional on the schedule still being the one we
    // read, so of two overlapping runs exactly one proceeds · the other's
    // update matches no rows. Clearing the schedule here also means a crash
    // mid-send leaves the invoice OUT of the queue rather than queued for
    // another attempt: an invoice that needs a human beats one sent twice.
    const claimedAt = invoice.scheduledSendAt
    const claim = await prisma.invoice.updateMany({
      where: {
        id: invoice.id,
        scheduledSendAt: claimedAt,
        status: { in: [...SENDABLE_STATUSES] },
      },
      data: { scheduledSendAt: null },
    })
    if (claim.count === 0) {
      skipped++
      results.push({ id: invoice.id, status: 'skipped:claimed-elsewhere' })
      continue
    }

    /** Put it back in the queue · only for outcomes where nothing was sent. */
    const releaseClaim = async () => {
      await prisma.invoice
        .updateMany({
          where: { id: invoice.id, scheduledSendAt: null, status: { in: [...SENDABLE_STATUSES] } },
          data: { scheduledSendAt: claimedAt },
        })
        .catch(err => logger.error(`[cron:send-scheduled] could not requeue ${invoice.id}`, err))
    }

    // Past the decision above, so this is known good.
    const sending = payload as ScheduledPayload

    try {
      const baseUrl = getBaseUrl()
      // Include a signed token so the client can open this PDF link without a
      // session (the generate-pdf GET now requires auth OR a valid token).
      const hostedPdfUrl = `${baseUrl}/api/invoices/${invoice.id}/generate-pdf?token=${generateInvoiceToken(invoice.id)}`
      if (!invoice.pdfUrl) {
        await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: hostedPdfUrl } })
      }

      const token = generateInvoiceToken(invoice.id)
      const publicInvoiceUrl = `${baseUrl}/view-invoice/${token}`

      const emailHtml = generateInvoiceEmail({
        clientName: invoice.client.name,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: formatCurrency(invoice.totalAmount),
        dueDate: invoice.dateDue ? format(new Date(invoice.dateDue), 'MMMM d, yyyy') : null,
        invoiceUrl: publicInvoiceUrl,
        customMessage: sending.message || undefined,
        showPaymentOptions: sending.showPaymentOptions ?? (invoice.showPaymentOptions ?? true),
      })

      const ccList = sending.cc
        ? sending.cc.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
        : []

      const result = await sendEmail({
        to: sending.to,
        subject: sending.subject,
        html: emailHtml,
        cc: ccList.length > 0 ? ccList : undefined,
      })

      if (!result.success) {
        // Nothing left the building, so it is safe to queue it again.
        await releaseClaim()
        failed++
        results.push({ id: invoice.id, status: 'failed', error: result.error })
        continue
      }

      // Held rather than delivered: leave it scheduled so it goes out for real
      // once sending is switched back on. Counting it as sent here would drop
      // it from the queue having emailed nobody.
      if (!marksInvoiceSent(classifySendResult(result))) {
        await releaseClaim()
        skipped++
        results.push({ id: invoice.id, status: 'skipped:held-not-delivered' })
        continue
      }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          dateSent: new Date(),
          sentTo: sending.to.join(', '),
          emailSubject: sending.subject,
          emailBody: sending.message,
          status: 'SENT',
          scheduledSendAt: null,
          scheduledPayload: Prisma.DbNull,
          // The provider's own id, which reminders quote to keep the thread
          // together. The manual send stored this and the scheduled one did
          // not, so an auto-sent invoice started a new thread every time.
          emailMessageId: threadableMessageId(result.messageId),
        },
      })
      sent++
      results.push({ id: invoice.id, status: 'sent' })
    } catch (err) {
      // Deliberately NOT requeued. The throw may have come after the provider
      // accepted the mail, and this is the one case where we cannot tell · so
      // the invoice is left claimed and unsent, visible and needing a person,
      // rather than queued to be sent a second time.
      failed++
      results.push({
        id: invoice.id,
        status: 'failed:needs-review',
        error: (err as Error).message,
      })
      await alertOperationalIssue(
        'Scheduled invoice send ended in an unknown state',
        err instanceof Error ? err : new Error(String(err)),
        { details: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }, severity: 'warning' },
      )
    }
  }

  return { processed: due.length, sent, skipped, failed, results }
}

async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const summary = await processDueInvoices()
    logger.info('[cron:send-scheduled] run complete', summary)
    if (summary.failed > 0) {
      await alertOperationalIssue(
        'cron:send-scheduled had invoice send failures',
        new Error(`${summary.failed} scheduled invoice send(s) failed`),
        { details: { summary }, severity: 'warning' },
      )
    }
    return NextResponse.json({ success: true, ...summary })
  } catch (error) {
    logger.error('[cron:send-scheduled] run failed', error)
    await alertOperationalIssue('cron:send-scheduled failed', error)
    return NextResponse.json({ error: 'Cron run failed' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
