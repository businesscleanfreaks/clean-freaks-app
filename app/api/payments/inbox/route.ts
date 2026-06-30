import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const CENTS = 0.005

/**
 * GET /api/payments/inbox
 *
 * The reconciliation queue: pending payment matches with the suggested invoice
 * and same-amount candidate invoices for one-click reassignment.
 */
export async function GET() {
  try {
    const [matches, openInvoices] = await Promise.all([
      prisma.paymentMatch.findMany({
        where: { status: 'NEEDS_REVIEW' },
        orderBy: { receivedAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { status: 'SENT', datePaid: null },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          client: { select: { name: true } },
        },
        orderBy: { dateCreated: 'desc' },
      }),
    ])

    const invoiceById = new Map(openInvoices.map((inv) => [inv.id, inv]))
    const shape = (inv: (typeof openInvoices)[number]) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client.name,
      totalAmount: inv.totalAmount,
    })

    const items = matches.map((m) => {
      const suggested = m.matchedInvoiceId ? invoiceById.get(m.matchedInvoiceId) : undefined
      const candidates = openInvoices.filter((inv) => Math.abs(inv.totalAmount - m.amount) < CENTS)
      return {
        id: m.id,
        senderName: m.senderName,
        amount: m.amount,
        receivedAt: m.receivedAt,
        confidence: m.confidence,
        rawSnippet: m.rawSnippet,
        suggestedInvoice: suggested ? shape(suggested) : null,
        candidates: candidates.map(shape),
      }
    })

    return NextResponse.json({
      matches: items,
      count: items.length,
      openInvoices: openInvoices.map(shape),
    })
  } catch (error) {
    logger.error('[payments/inbox] failed:', error)
    return NextResponse.json({ error: 'Failed to load payment inbox' }, { status: 500 })
  }
}
