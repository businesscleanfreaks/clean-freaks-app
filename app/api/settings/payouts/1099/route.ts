import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getCleaner1099Totals, summarize1099, build1099Csv } from '@/lib/payouts-1099'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(req.url)
    const parsedYear = parseInt(searchParams.get('year') || '', 10)
    const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()

    const rows = await getCleaner1099Totals(year)

    if (searchParams.get('format') === 'csv') {
      const csv = build1099Csv(year, rows)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="1099-totals-${year}.csv"`,
        },
      })
    }

    return NextResponse.json({ year, summary: summarize1099(year, rows), rows })
  } catch (error) {
    return handleApiError(error, 'Failed to load 1099 totals')
  }
}
