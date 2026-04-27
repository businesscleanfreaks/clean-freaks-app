import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateSubcontractorPages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> | { id: string; paymentId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const { paymentId, id: subcontractorId } = resolvedParams

    // Get the payment with line items to find which jobs to unmark
    const payment = await prisma.subcontractorPayment.findUnique({
      where: { id: paymentId },
      include: {
        lineItems: {
          select: {
            jobId: true,
          },
        },
      },
    })

    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    // Verify this payment belongs to this subcontractor
    if (payment.subcontractorId !== subcontractorId) {
      return NextResponse.json(
        { error: 'Payment does not belong to this subcontractor' },
        { status: 400 }
      )
    }

    // Get all job IDs from line items
    const jobIds = payment.lineItems.map(item => item.jobId)

    // Use transaction to ensure job updates and payment deletion happen atomically
    await prisma.$transaction(async (tx) => {
      // Unmark ALL jobs as unpaid (regardless of current status)
      // This ensures consistency - if we're voiding a payment, all jobs in that payment should be unpaid
      if (jobIds.length > 0) {
        await tx.job.updateMany({
          where: {
            id: { in: jobIds },
          },
          data: {
            subcontractorPaid: false,
          },
        })
      }

      // Delete the payment (line items will be cascade deleted)
      await tx.subcontractorPayment.delete({
        where: { id: paymentId },
      })
    })

    // Revalidate all subcontractor-related pages
    revalidateSubcontractorPages(subcontractorId)

    return NextResponse.json({ 
      success: true,
      message: `Payment voided. ${jobIds.length} job(s) marked as unpaid.`
    })
  } catch (error) {
    logger.error('Error voiding payment:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to void payment'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

