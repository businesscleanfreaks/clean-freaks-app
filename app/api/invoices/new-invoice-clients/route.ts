import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Clients for the New-invoice picker, most recently invoiced first.
 *
 * Carries just enough to recognise the right one at a glance — who cleans for
 * them and what their last invoice was — so the VA does not raise an extra
 * against the wrong account.
 */
export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const clients = await prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        billingType: true,
        invoices: {
          where: { status: { not: 'VOID' } },
          orderBy: { dateCreated: 'desc' },
          take: 1,
          select: { totalAmount: true, dateDue: true, dateCreated: true },
        },
        locations: {
          select: {
            schedules: {
              where: { isActive: true },
              take: 1,
              select: { subcontractor: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    const rows = clients.map(c => {
      const last = c.invoices[0]
      const cleaner = c.locations
        .flatMap(l => l.schedules)
        .map(s => s.subcontractor?.name)
        .find(Boolean) ?? null
      return {
        id: c.id,
        name: c.name,
        billingType: c.billingType,
        cleanerName: cleaner,
        lastInvoiceTotal: last?.totalAmount ?? null,
        lastInvoiceDue: last?.dateDue ?? null,
        lastInvoicedAt: last?.dateCreated ?? null,
      }
    })

    // Recently invoiced first — that is who an extra is usually for — then the
    // rest alphabetically so the list is still predictable.
    rows.sort((a, b) => {
      const at = a.lastInvoicedAt ? new Date(a.lastInvoicedAt).getTime() : 0
      const bt = b.lastInvoicedAt ? new Date(b.lastInvoicedAt).getTime() : 0
      if (at !== bt) return bt - at
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json(
      { clients: rows },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
