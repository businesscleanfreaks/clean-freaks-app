import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import {
  computeOverviewMetrics,
  monthBounds,
  isValidPeriod,
  currentPeriod,
  type OverviewInvoice,
} from '@/lib/invoice-overview'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const requested = searchParams.get('period')
    const period = isValidPeriod(requested) ? requested : currentPeriod()
    const { start, end } = monthBounds(period)

    // VOID is excluded: creating an invoice PREVIEW stores a VOID row
    // (see invoices/route.ts `previewOnly ? 'VOID' : 'DRAFT'`), so a month can
    // hold dozens of throwaway rows that would bury the real invoices and make
    // the list count disagree with the metric cards.
    const rows = await prisma.invoice.findMany({
      where: { dateCreated: { gte: start, lte: end }, status: { not: 'VOID' } },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        dateCreated: true,
        dateDue: true,
        datePaid: true,
        client: { select: { name: true } },
      },
      orderBy: { dateCreated: 'desc' },
    })

    const invoices: OverviewInvoice[] = rows.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client?.name ?? 'Unknown client',
      status: inv.status,
      totalAmount: inv.totalAmount,
      dateCreated: inv.dateCreated.toISOString(),
      dateDue: inv.dateDue?.toISOString() ?? null,
      datePaid: inv.datePaid?.toISOString() ?? null,
    }))

    // Which months of this period's year have any invoices — drives the dots in
    // the month picker so empty months are obvious before clicking.
    const year = Number(period.split('-')[0])
    const yearRows = await prisma.invoice.findMany({
      where: {
        status: { not: 'VOID' },
        dateCreated: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
        },
      },
      select: { dateCreated: true },
    })
    const monthsWithInvoices = Array.from(
      new Set(yearRows.map(row => row.dateCreated.getUTCMonth() + 1)),
    ).sort((a, b) => a - b)

    return NextResponse.json({
      period,
      metrics: computeOverviewMetrics(invoices),
      invoices,
      monthsWithInvoices,
    })
  } catch (error) {
    return handleApiError(error, 'Failed to load invoices overview')
  }
}
