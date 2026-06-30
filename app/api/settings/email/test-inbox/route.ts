import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getEmailConfig, getEmailSettingsRow } from '@/lib/email-settings'
import { fetchRecentInbox } from '@/lib/imap-inbox'
import { ingestMessages, runMatchPass } from '@/lib/payment-ingest'
import { handleApiError } from '@/lib/api-error-handler'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settings/email/test-inbox
 *
 * Runs the same Gmail IMAP payment scan as the cron, but from an authenticated
 * settings user so Josh/Grace can verify the password and inbox sync setup.
 */
export async function POST() {
  try {
    await requireAuth()

    const [settings, config] = await Promise.all([
      getEmailSettingsRow(),
      getEmailConfig(),
    ])

    if (!settings) {
      return NextResponse.json(
        { error: 'Save email settings before testing inbox sync.' },
        { status: 400 },
      )
    }

    if (config.provider !== 'gmail') {
      return NextResponse.json(
        { error: 'Inbox sync uses Gmail. Switch the provider to Gmail first.' },
        { status: 400 },
      )
    }

    if (!config.gmailUser || !config.gmailAppPassword) {
      return NextResponse.json(
        { error: 'Add the Gmail login email and App Password before testing inbox sync.' },
        { status: 400 },
      )
    }

    if (!settings.enableInboxSync) {
      return NextResponse.json(
        { error: 'Turn on inbox sync before running a scan.' },
        { status: 400 },
      )
    }

    const { messages, highestUid } = await fetchRecentInbox({
      sinceUid: settings.lastInboxUid,
      max: 50,
      throwOnError: true,
    })
    const ingest = await ingestMessages(prisma, messages)
    const match = await runMatchPass(prisma)

    if (highestUid && highestUid !== settings.lastInboxUid) {
      await prisma.emailSettings.update({
        where: { id: settings.id },
        data: { lastInboxUid: highestUid },
      })
    }

    return NextResponse.json({
      success: true,
      scanned: messages.length,
      created: ingest.created,
      skipped: ingest.skipped,
      scored: match.scored,
      lastInboxUid: highestUid ?? settings.lastInboxUid,
    })
  } catch (error) {
    logger.error('[settings/email/test-inbox] failed:', error)
    if (error instanceof Error && error.message === 'Unauthorized') {
      return handleApiError(error, 'Failed to test inbox sync')
    }
    return NextResponse.json(
      { error: 'Failed to connect to the Gmail inbox. Check the Gmail login email and App Password.' },
      { status: 500 },
    )
  }
}
