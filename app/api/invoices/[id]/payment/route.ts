import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    const { method, amount } = body

    if (!method || !amount) {
      return NextResponse.json(
        { error: 'Payment method and amount are required' },
        { status: 400 }
      )
    }

    // Get invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    // Verify amount matches
    if (Math.abs(amount - invoice.totalAmount) > 0.01) {
      return NextResponse.json(
        { error: 'Payment amount does not match invoice total' },
        { status: 400 }
      )
    }

    // Update invoice based on payment method
    if (method === 'ZELLE') {
      // Zelle payments are marked as pending (require verification)
      await prisma.invoice.update({
        where: { id: resolvedParams.id },
        data: {
          paymentMethod: 'ZELLE',
          paymentReceivedAt: new Date(),
          paymentNotes: 'Payment submitted via Zelle - pending verification',
          // Status remains SENT until verified by admin
        },
      })
    } else if (method === 'SQUARE') {
      // Square payments are automatically confirmed
      await prisma.invoice.update({
        where: { id: resolvedParams.id },
        data: {
          paymentMethod: 'SQUARE',
          paymentReceivedAt: new Date(),
          datePaid: new Date(),
          status: 'PAID',
          paymentNotes: 'Payment processed via Square',
        },
      })
    } else {
      return NextResponse.json(
        { error: 'Invalid payment method' },
        { status: 400 }
      )
    }

    // Revalidate invoice pages
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${resolvedParams.id}`)
    revalidatePath(`/view-invoice/[token]`)

    return NextResponse.json({
      success: true,
      message: method === 'ZELLE' 
        ? 'Payment submitted. We will verify and update the invoice status.'
        : 'Payment processed successfully.',
    })
  } catch (error) {
    logger.error('Error processing payment:', error)
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}

