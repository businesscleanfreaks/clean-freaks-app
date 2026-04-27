import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleApiError } from '@/lib/api-error-handler'

/**
 * Fetches jobs for a specific date range (for lazy loading calendar)
 * GET /api/jobs/by-date-range?start=2025-01-01&end=2025-03-31
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startStr = searchParams.get('start')
    const endStr = searchParams.get('end')

    if (!startStr || !endStr) {
      return NextResponse.json(
        { error: 'start and end query parameters are required' },
        { status: 400 }
      )
    }

    const startDate = new Date(startStr)
    const endDate = new Date(endStr)

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      )
    }

    // Limit range to 6 months max to prevent abuse
    const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000
    if (endDate.getTime() - startDate.getTime() > sixMonthsMs) {
      return NextResponse.json(
        { error: 'Date range cannot exceed 6 months' },
        { status: 400 }
      )
    }

    const jobs = await prisma.job.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
        status: { not: 'CANCELLED' },
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        schedule: true,
        subcontractor: true,
        addOnServices: true,
        invoiceLineItems: {
          include: {
            invoice: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    })

    return NextResponse.json({ jobs })
  } catch (error) {
    return handleApiError(error, 'Failed to fetch jobs')
  }
}
