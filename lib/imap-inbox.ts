/**
 * IMAP reader for the payment scan. Pulls recent INBOX messages from the Gmail
 * account already configured for sending (same app password works for IMAP),
 * MIME-parses them, and returns plain `RawInboxMessage`s for the pure ingest core.
 *
 * ⚠️ LIVE VALIDATION REQUIRED: this transport cannot be unit-tested and has not
 * been run against a live mailbox yet. The ingest/parse/match logic it feeds is
 * fully tested; this file is the one piece that needs a real Gmail box + app
 * password + `enableInboxSync` to verify. It degrades safely: on any failure it
 * logs and returns what it has, so the cron never throws.
 *
 * imapflow + mailparser are loaded dynamically so they only load when inbox sync
 * actually runs.
 */
import { getEmailConfig } from '@/lib/email-settings'
import { getEmailSettingsRow } from '@/lib/email-settings'
import { logger } from '@/lib/logger'
import type { RawInboxMessage } from '@/lib/payment-ingest'

export interface FetchInboxResult {
  messages: RawInboxMessage[]
  highestUid: string | null
}

const DEFAULT_BACKFILL_DAYS = 14

export async function fetchRecentInbox(opts: {
  sinceUid?: string | null
  sinceDate?: Date
  max?: number
} = {}): Promise<FetchInboxResult> {
  const config = await getEmailConfig()
  if (!config.gmailUser || !config.gmailAppPassword) {
    logger.warn('[inbox] No Gmail credentials configured; skipping IMAP fetch')
    return { messages: [], highestUid: opts.sinceUid ?? null }
  }

  const { ImapFlow } = await import('imapflow')
  const { simpleParser } = await import('mailparser')

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    logger: false,
  })

  const messages: RawInboxMessage[] = []
  let highestUid: string | null = opts.sinceUid ?? null

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = opts.sinceDate ?? new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 86400000)
      // Incremental by UID when we have a watermark; otherwise a bounded date backfill.
      const criteria = opts.sinceUid ? { uid: `${Number(opts.sinceUid) + 1}:*` } : { since }
      const uids = (await client.search(criteria, { uid: true })) || []

      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        const parsed = await simpleParser(msg.source)
        messages.push({
          messageId: parsed.messageId || `gmail-uid-${uid}`,
          from: parsed.from?.text || '',
          subject: parsed.subject || null,
          text: parsed.text || null,
          html: typeof parsed.html === 'string' ? parsed.html : null,
          receivedAt: parsed.date || new Date(),
        })
        if (highestUid === null || uid > Number(highestUid)) highestUid = String(uid)
        if (opts.max && messages.length >= opts.max) break
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    logger.error('[inbox] IMAP fetch failed:', err)
    return { messages, highestUid }
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  return { messages, highestUid }
}

/** Read the stored IMAP watermark from the singleton email settings row. */
export async function getInboxWatermark(): Promise<string | null> {
  const row = await getEmailSettingsRow()
  return row?.lastInboxUid ?? null
}
