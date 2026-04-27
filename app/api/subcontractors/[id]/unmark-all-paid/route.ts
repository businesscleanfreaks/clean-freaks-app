import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateSubcontractorPages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { id: subcontractorId } = resolvedParams

    // Unmark ALL paid jobs for this subcontractor
    const result = await prisma.job.updateMany({
      where: {
        subcontractorId: subcontractorId,
        subcontractorPaid: true,
      },
      data: {
        subcontractorPaid: false,
      },
    })

    // Also delete all payment records for this subcontractor since jobs are now unpaid
    await prisma.subcontractorPayment.deleteMany({
      where: {
        subcontractorId: subcontractorId,
      },
    })

    // Revalidate all subcontractor-related pages
    revalidateSubcontractorPages(subcontractorId)

    return NextResponse.json({
      success: true,
      message: `Unmarked ${result.count} job(s) as unpaid and deleted all payment records.`,
      count: result.count,
    })
  } catch (error) {
    logger.error('Error unmarking all paid jobs:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to unmark all paid jobs'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

