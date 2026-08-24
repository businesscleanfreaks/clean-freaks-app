import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getErrorMessage } from '@/lib/logger'
import { buildRecipientWorklist, outstandingCount } from '@/lib/recipient-audit'

export const dynamic = 'force-dynamic'

/**
 * The invoice-recipient worklist: every active client, worst first, with what
 * an invoice would do for them today. Josh is setting these by hand, so this
 * exists to tell him where to start and when he is finished.
 */
export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const clients = await prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        invoicingEmail: true,
        invoicingContactName: true,
        communicationEmail: true,
        communicationContactName: true,
        _count: { select: { invoices: true } },
      },
    })

    const rows = buildRecipientWorklist(
      clients.map(c => ({
        id: c.id,
        name: c.name,
        invoicingEmail: c.invoicingEmail,
        invoicingContactName: c.invoicingContactName,
        communicationEmail: c.communicationEmail,
        communicationContactName: c.communicationContactName,
        activeInvoiceCount: c._count.invoices,
      })),
    )

    return NextResponse.json({
      rows,
      outstanding: outstandingCount(rows),
      total: rows.length,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
