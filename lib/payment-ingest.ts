/**
 * Pure-ish core of the payment scan: turn raw inbox messages into PaymentMatch
 * rows, then score the pending ones against open invoices. Kept separate from the
 * IMAP transport so it is fully unit/integration testable with fake messages.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { parseZelleNotification } from '@/lib/zelle-parse'
import { scoreMatch } from '@/lib/payment-matching'

type DbClient = typeof prisma | Prisma.TransactionClient

export interface RawInboxMessage {
  messageId: string
  from: string
  subject: string | null
  text: string | null
  html: string | null
  receivedAt: Date
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse each message; for payment notifications, create a NEEDS_REVIEW PaymentMatch.
 * Idempotent: skips messages already ingested (by messageId) or whose confirmation
 * number was already seen, so re-scanning the same inbox never double-creates.
 */
export async function ingestMessages(
  db: DbClient,
  messages: RawInboxMessage[],
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  for (const msg of messages) {
    const seen = await db.paymentMatch.findUnique({ where: { messageId: msg.messageId } })
    if (seen) { skipped++; continue }

    const parsed = parseZelleNotification(msg.subject, msg.text || stripHtml(msg.html))
    if (!parsed) { skipped++; continue }

    if (parsed.confirmationNumber) {
      const dup = await db.paymentMatch.findUnique({
        where: { confirmationNumber: parsed.confirmationNumber },
      })
      if (dup) { skipped++; continue }
    }

    await db.paymentMatch.create({
      data: {
        messageId: msg.messageId,
        confirmationNumber: parsed.confirmationNumber,
        senderName: parsed.senderName,
        amount: parsed.amount,
        sentAt: parsed.sentAt,
        receivedAt: msg.receivedAt,
        rawSnippet: (msg.text || stripHtml(msg.html) || msg.subject || '').slice(0, 280),
        status: 'NEEDS_REVIEW',
      },
    })
    created++
  }

  return { created, skipped }
}

/** Score every NEEDS_REVIEW match against current open invoices + the alias map. */
export async function runMatchPass(db: DbClient): Promise<{ scored: number }> {
  const pending = await db.paymentMatch.findMany({ where: { status: 'NEEDS_REVIEW' } })
  if (pending.length === 0) return { scored: 0 }

  const openInvoices = await db.invoice.findMany({
    where: { status: 'SENT', datePaid: null },
    select: { id: true, clientId: true, totalAmount: true },
  })
  const aliasRows = await db.clientPaymentAlias.findMany({
    select: { normalizedSenderName: true, clientId: true },
  })
  const aliasMap = new Map(aliasRows.map((a) => [a.normalizedSenderName, a.clientId]))

  let scored = 0
  for (const m of pending) {
    const res = scoreMatch({ senderName: m.senderName, amount: m.amount }, openInvoices, aliasMap)
    await db.paymentMatch.update({
      where: { id: m.id },
      data: { matchedInvoiceId: res.suggestedInvoiceId, confidence: res.confidence },
    })
    scored++
  }
  return { scored }
}
