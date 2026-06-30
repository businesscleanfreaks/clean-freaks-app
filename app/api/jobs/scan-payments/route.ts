import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { authorizeCron } from '@/lib/cron-auth'
import { getEmailSettingsRow } from '@/lib/email-settings'
import { fetchRecentInbox } from '@/lib/imap-inbox'
import { ingestMessages, runMatchPass } from '@/lib/payment-ingest'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/scan-payments
 *
 * Reads new INBOX mail over IMAP, detects Zelle/bank payment notifications, and
 * stores them as NEEDS_REVIEW PaymentMatch rows scored against open invoices.
 * Review-only — never marks an invoice paid (that's the human Confirm action).
 * Gated by CRON_SECRET and the `enableInboxSync` email setting (default off).
 */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const settings = await getEmailSettingsRow()
    if (!settings?.enableInboxSync) {
      return NextResponse.json({ skipped: true, reason: 'Inbox sync disabled' })
    }

    const { messages, highestUid } = await fetchRecentInbox({ sinceUid: settings.lastInboxUid })
    const ingest = await ingestMessages(prisma, messages)
    const match = await runMatchPass(prisma)

    if (highestUid && highestUid !== settings.lastInboxUid) {
      await prisma.emailSettings.update({
        where: { id: settings.id },
        data: { lastInboxUid: highestUid },
      })
    }

    logger.info('[scan-payments] complete', {
      scanned: messages.length,
      created: ingest.created,
      scored: match.scored,
    })
    return NextResponse.json({
      success: true,
      scanned: messages.length,
      created: ingest.created,
      skipped: ingest.skipped,
      scored: match.scored,
    })
  } catch (error) {
    logger.error('[scan-payments] failed:', error)
    return NextResponse.json({ error: 'Failed to scan payments' }, { status: 500 })
  }
}

export const GET = POST
