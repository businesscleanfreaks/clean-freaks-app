import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { monthBounds, isValidPeriod, currentPeriod } from '@/lib/invoice-overview'
import { toLedgerRow, sortRows, tabCounts, computeStats, type LedgerSource } from '@/lib/invoice-ledger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const requested = searchParams.get('period')
    const period = isValidPeriod(requested) ? requested : currentPeriod()
    const { start, end } = monthBounds(period)

    // VOID rows are invoice PREVIEWS (invoices/route.ts `previewOnly ? 'VOID' : 'DRAFT'`),
    // never real invoices — they must never appear in the ledger or its totals.
    const rows = await prisma.invoice.findMany({
      where: { dateCreated: { gte: start, lte: end }, status: { not: 'VOID' } },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        dateDue: true,
        datePaid: true,
        scheduledSendAt: true,
        clearingSince: true,
        paymentMethod: true,
        paymentTransactionId: true,
        client: { select: { name: true, billingType: true, billingDelivery: true } },
        // A one-off invoice is one whose billed work is all unscheduled jobs.
        lineItems: { select: { job: { select: { scheduleId: true } } } },
      },
      orderBy: { dateCreated: 'desc' },
    })

    const sources: LedgerSource[] = rows.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client?.name ?? 'Unknown client',
      status: inv.status,
      totalAmount: inv.totalAmount,
      dateDue: inv.dateDue?.toISOString() ?? null,
      datePaid: inv.datePaid?.toISOString() ?? null,
      scheduledSendAt: inv.scheduledSendAt?.toISOString() ?? null,
      billingType: inv.client?.billingType ?? null,
      // Only call it one-off when there are job-backed lines AND none are scheduled.
      isOneOff: (() => {
        const jobLines = inv.lineItems.filter(li => li.job)
        return jobLines.length > 0 && jobLines.every(li => !li.job?.scheduleId)
      })(),
      paymentMethod: inv.paymentMethod,
      paymentReference: inv.paymentTransactionId,
      clearingSince: inv.clearingSince?.toISOString() ?? null,
      trackOnly: inv.client?.billingDelivery === 'TRACK_ONLY',
    }))

    const ledger = sortRows(sources.map(s => toLedgerRow(s)))

    return NextResponse.json({
      period,
      rows: ledger,
      counts: tabCounts(ledger),
      stats: computeStats(ledger),
    })
  } catch (error) {
    return handleApiError(error, 'Failed to load invoices overview')
  }
}
