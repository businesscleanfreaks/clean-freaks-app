import { NextResponse } from 'next/server'
import { startOfMonth, endOfMonth } from 'date-fns'
import { computeClientProration } from '@/lib/proration'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clients/[id]/proration?month=YYYY-MM
 * Per-location flat-rate proration for the month (missed cleans → suggested credit).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await Promise.resolve(params)
    const monthParam = new URL(request.url).searchParams.get('month')

    let monthStart: Date
    let monthEnd: Date
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number)
      monthStart = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0))
      monthEnd = new Date(Date.UTC(y, m, 0, 12, 0, 0))
    } else {
      monthStart = startOfMonth(new Date())
      monthEnd = endOfMonth(new Date())
    }

    const rows = await computeClientProration(id, monthStart, monthEnd)
    const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0)
    return NextResponse.json({ rows, totalCredit })
  } catch (error) {
    logger.error('Error computing proration:', error)
    return NextResponse.json({ error: 'Failed to compute proration' }, { status: 500 })
  }
}
