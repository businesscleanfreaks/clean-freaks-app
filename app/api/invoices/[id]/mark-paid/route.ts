import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { markInvoicePaidSchema, formatZodErrors } from '@/lib/validations'
import { markInvoicePaid } from '@/lib/mark-invoice-paid'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()

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

    const result = await markInvoicePaid(prisma, resolvedParams.id, {
      method: paymentMethod || 'MANUAL',
      notes: paymentNotes || 'Marked as paid manually',
    })

    if (result.status === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

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
    return handleApiError(error, 'Failed to mark invoice as paid')
  }
}
