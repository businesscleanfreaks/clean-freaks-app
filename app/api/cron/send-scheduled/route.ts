import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { generateInvoiceEmail } from '@/lib/email-templates'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { logger } from '@/lib/logger'
import { generateInvoiceToken } from '@/lib/invoice-tokens'
import { getBaseUrl } from '@/lib/url'
import { authorizeCron } from '@/lib/cron-auth'

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
      status: { notIn: ['SENT', 'PAID'] },
    },
    include: { client: true, lineItems: true },
    orderBy: { scheduledSendAt: 'asc' },
    take: 50,
  })

  const allowRealEmails = process.env.ALLOW_REAL_CLIENT_EMAILS === 'true'
  const enableSending = process.env.ENABLE_EMAIL_SENDING === 'true'
  const hasCredentials = !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD

  const results: Array<{ id: string; status: string; error?: string }> = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const invoice of due) {
    const payload = invoice.scheduledPayload as unknown as ScheduledPayload | null

    // Malformed/empty schedule — clear it so the cron doesn't loop on it.
    if (!payload || !Array.isArray(payload.to) || payload.to.length === 0) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { scheduledSendAt: null, scheduledPayload: Prisma.DbNull },
      })
      skipped++
      results.push({ id: invoice.id, status: 'skipped:no-payload' })
      continue
    }

    // Safety gates — leave it scheduled to retry once sending is enabled.
    if (!allowRealEmails || !enableSending) {
      skipped++
      results.push({ id: invoice.id, status: 'skipped:sending-disabled' })
      continue
    }
    if (!hasCredentials) {
      skipped++
      results.push({ id: invoice.id, status: 'skipped:no-credentials' })
      continue
    }

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
        customMessage: payload.message || undefined,
        showPaymentOptions: payload.showPaymentOptions ?? (invoice.showPaymentOptions ?? true),
      })

      const ccList = payload.cc
        ? payload.cc.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
        : []

      const result = await sendEmail({
        to: payload.to,
        subject: payload.subject,
        html: emailHtml,
        cc: ccList.length > 0 ? ccList : undefined,
      })

      if (!result.success) {
        failed++
        results.push({ id: invoice.id, status: 'failed', error: result.error })
        continue
      }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          dateSent: new Date(),
          sentTo: payload.to.join(', '),
          emailSubject: payload.subject,
          emailBody: payload.message,
          status: 'SENT',
          scheduledSendAt: null,
          scheduledPayload: Prisma.DbNull,
        },
      })
      sent++
      results.push({ id: invoice.id, status: 'sent' })
    } catch (err) {
      failed++
      results.push({ id: invoice.id, status: 'failed', error: (err as Error).message })
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
    return NextResponse.json({ success: true, ...summary })
  } catch (error) {
    logger.error('[cron:send-scheduled] run failed', error)
    return NextResponse.json({ error: 'Cron run failed' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
