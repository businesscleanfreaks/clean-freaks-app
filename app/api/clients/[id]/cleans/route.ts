import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * One client's cleans for one month, for the invoice review's schedule check.
 *
 * The client profile route deliberately returns a rolling window around today
 * (60 days back, 6 months forward), which is right for the profile page but
 * silently empty when a VA reviews a month that has since scrolled out of it.
 * The schedule check has to show the month being invoiced, whichever month
 * that is, so it asks for exactly that month and nothing else.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const month = new URL(request.url).searchParams.get('month') || ''
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
    }
    const [y, m] = month.split('-').map(Number)
    if (m < 1 || m > 12) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
    }

    const jobs = await prisma.job.findMany({
      where: {
        location: { clientId: params.id },
        date: { gte: new Date(y, m - 1, 1, 0, 0, 0, 0), lte: new Date(y, m, 0, 23, 59, 59, 999) },
      },
      select: {
        id: true,
        date: true,
        status: true,
        scheduleId: true,
        clientRate: true,
        cancellationFee: true,
        // What the cleaner is owed for this clean, and whether it is settled —
        // the review workspace shows the payout alongside the invoice.
        subcontractorRate: true,
        subcontractorPaid: true,
        subcontractor: { select: { name: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    })

    const cleans = jobs.map(j => ({
      jobId: j.id,
      date: j.date,
      status: j.status,
      // A clean with no schedule is one-off work, which the grid marks amber.
      isOneOff: !j.scheduleId,
      clientRate: j.clientRate,
      cancellationFee: j.cancellationFee,
      subcontractorRate: j.subcontractorRate,
      subcontractorPaid: j.subcontractorPaid,
      cleanerName: j.subcontractor?.name || j.vendor?.name || null,
    }))

    // No caching on purpose. A correction is followed immediately by a
    // revalidation, and a cached body would show the reviewer the state they
    // just changed away from.
    return NextResponse.json(
      { cleans },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
