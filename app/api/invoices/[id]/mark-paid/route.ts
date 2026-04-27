import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { markInvoicePaidSchema, formatZodErrors } from '@/lib/validations'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    
    // Validate input using Zod schema
    const validationResult = markInvoicePaidSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = formatZodErrors(validationResult.error)
      return NextResponse.json(
        { error: errors[0] || 'Invalid payment data' },
        { status: 400 }
      )
    }
    
    const { paymentMethod, paymentNotes } = validationResult.data

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

    // Update invoice to paid status
    await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        status: 'PAID',
        datePaid: new Date(),
        paymentReceivedAt: new Date(),
        paymentMethod: paymentMethod || 'MANUAL',
        paymentNotes: paymentNotes || 'Marked as paid manually',
      },
    })

    // Revalidate invoice pages
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${resolvedParams.id}`)
    revalidatePath(`/view-invoice/[token]`)

    return NextResponse.json({
      success: true,
      message: 'Invoice marked as paid',
    })
  } catch (error) {
    logger.error('Error marking invoice as paid:', error)
    return NextResponse.json(
      { error: 'Failed to mark invoice as paid' },
      { status: 500 }
    )
  }
}

