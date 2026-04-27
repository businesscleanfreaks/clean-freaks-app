import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

// Schema for line item updates
const lineItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().min(0, 'Amount must be positive'),
  serviceDate: z.string().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  createAddOnService: z.boolean().optional(),
})

const updateLineItemsSchema = z.object({
  lineItems: z.array(lineItemSchema),
})

/**
 * GET - Get line items for an invoice
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params)
    const { id } = resolvedParams

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
          },
          orderBy: { serviceDate: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      lineItems: invoice.lineItems,
      totalAmount: invoice.totalAmount,
    })
  } catch (error) {
    logger.error('Error fetching line items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch line items' },
      { status: 500 }
    )
  }
}

/**
 * PUT - Update line items for an invoice
 * Allows editing descriptions, amounts, and adding/removing items
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params)
    const { id } = resolvedParams

    // Get the invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    // Only allow editing DRAFT or SENT invoices
    if (invoice.status === 'PAID') {
      return NextResponse.json(
        { error: 'Cannot edit line items on a paid invoice' },
        { status: 400 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = updateLineItemsSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }

    const { lineItems: newLineItems } = validationResult.data

    // Get existing line item IDs
    const existingIds = new Set(invoice.lineItems.map(item => item.id))
    const newIds = new Set(newLineItems.filter(item => item.id).map(item => item.id))

    // Items to delete (in existing but not in new)
    const idsToDelete = [...existingIds].filter(id => !newIds.has(id))

    // Items to update (in both existing and new)
    const itemsToUpdate = newLineItems.filter(item => item.id && existingIds.has(item.id))

    // Items to create (no id or id not in existing)
    const itemsToCreate = newLineItems.filter(item => !item.id || !existingIds.has(item.id))

    // Execute updates in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete removed items
      if (idsToDelete.length > 0) {
        await tx.invoiceLineItem.deleteMany({
          where: {
            id: { in: idsToDelete },
            invoiceId: id,
          },
        })
        logger.info('Deleted line items:', idsToDelete.length)
      }

      // Update existing items
      for (const item of itemsToUpdate) {
        await tx.invoiceLineItem.update({
          where: { id: item.id! },
          data: {
            description: item.description,
            amount: item.amount,
            serviceDate: item.serviceDate ? new Date(item.serviceDate) : null,
          },
        })
      }
      if (itemsToUpdate.length > 0) {
        logger.info('Updated line items:', itemsToUpdate.length)
      }

      // Create new items (optionally creating AddOnService records for system sync)
      for (const item of itemsToCreate) {
        let addOnServiceId: string | null = null

        if (item.createAddOnService && item.jobId && item.description && item.amount > 0) {
          const addOnService = await tx.addOnService.create({
            data: {
              jobId: item.jobId,
              description: item.description,
              clientRate: item.amount,
              subcontractorRate: 0,
              isRecurring: false,
            },
          })
          addOnServiceId = addOnService.id
          logger.info('Created AddOnService for job:', item.jobId, 'id:', addOnService.id)
        }

        await tx.invoiceLineItem.create({
          data: {
            invoiceId: id,
            description: item.description,
            amount: item.amount,
            serviceDate: item.serviceDate ? new Date(item.serviceDate) : null,
            jobId: item.jobId || null,
            addOnServiceId,
          },
        })
      }
      if (itemsToCreate.length > 0) {
        logger.info('Created line items:', itemsToCreate.length)
      }

      // Recalculate total
      const newTotal = newLineItems.reduce((sum, item) => sum + item.amount, 0)
      await tx.invoice.update({
        where: { id },
        data: {
          totalAmount: newTotal,
          updatedAt: new Date(),
          // Clear PDF since line items changed
          pdfUrl: null,
          pdfPath: null,
        },
      })
      logger.info('Updated invoice total:', newTotal)
    })

    // Fetch updated invoice
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
          },
          orderBy: { serviceDate: 'asc' },
        },
        client: true,
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${id}`)

    return NextResponse.json({
      success: true,
      message: 'Line items updated. PDF will need to be regenerated.',
      invoice: updatedInvoice,
      needsPdfRegeneration: true,
    })
  } catch (error) {
    logger.error('Error updating line items:', error)
    return NextResponse.json(
      { error: 'Failed to update line items' },
      { status: 500 }
    )
  }
}
