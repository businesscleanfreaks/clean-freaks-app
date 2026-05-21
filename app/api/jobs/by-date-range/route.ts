import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleApiError } from '@/lib/api-error-handler'
import { ensureJobsForDateRange } from '@/lib/regenerate-schedule-jobs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    // Keep the API safe for accidental huge requests, while still allowing
    // historical calendar navigation and wider prefetch windows.
    const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000
    if (endDate.getTime() - startDate.getTime() > twoYearsMs) {
      return NextResponse.json(
        { error: 'Date range cannot exceed 2 years' },
        { status: 400 }
      )
    }

    // Past months should be a fast read. Current/future months can generate
    // missing recurring jobs so the calendar remains self-healing.
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    if (endDate >= currentMonthStart) {
      await ensureJobsForDateRange({ startDate, endDate })
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

    return NextResponse.json(
      { jobs },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
        },
      }
    )
  } catch (error) {
    return handleApiError(error, 'Failed to fetch jobs')
  }
}
