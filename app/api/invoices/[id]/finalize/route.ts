import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Finalize a preview invoice by marking its jobs as invoiced
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get the invoice with its line items
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
        client: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Get all job IDs from line items
    const jobIds = invoice.lineItems
      .map(item => item.jobId)
      .filter((id): id is string => id !== null)

    if (jobIds.length > 0) {
      // Mark jobs as invoiced
      await prisma.job.updateMany({
        where: {
          id: { in: jobIds },
        },
        data: {
          invoiced: true,
        },
      })
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Invoice finalized and jobs marked as invoiced',
      jobsMarked: jobIds.length,
    })
  } catch (error) {
    console.error('Error finalizing invoice:', error)
    return NextResponse.json(
      { error: 'Failed to finalize invoice' },
      { status: 500 }
    )
  }
}
