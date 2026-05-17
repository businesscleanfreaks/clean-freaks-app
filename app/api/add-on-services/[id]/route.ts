import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateJobPages, revalidateInvoicePages } from '@/lib/revalidate'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { recalculateInvoiceTotal } from '@/lib/invoice-utils'
import { cascadeAddOnUpdate } from '@/lib/cascading-updates'
import { requireAuth } from '@/lib/auth'
import { hasFinalInvoice } from '@/lib/invoice-status'

const updateAddOnServiceSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  clientRate: z.number().min(0, 'Client rate must be positive').optional(),
  subcontractorRate: z.number().min(0, 'Subcontractor rate must be positive').optional(),
  frequency: z.string().optional().nullable(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()

    const validationResult = updateAddOnServiceSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    // Get the add-on service with job and invoice info
    const addOnService = await prisma.addOnService.findUnique({
      where: { id: resolvedParams.id },
      include: {
        job: {
          include: {
            invoiceLineItems: {
              include: {
                invoice: true,
              },
            },
            location: {
              include: {
                client: true,
              },
            },
          },
        },
      },
    })

    if (!addOnService) {
      return NextResponse.json(
        { error: 'Add-on service not found' },
        { status: 404 }
      )
    }

    const finalInvoice = hasFinalInvoice(addOnService.job?.invoiceLineItems)
    if (finalInvoice) {
      return NextResponse.json(
        { error: 'Cannot edit add-on service: job has a sent or paid invoice' },
        { status: 400 }
      )
    }

    const updated = await prisma.addOnService.update({
      where: { id: resolvedParams.id },
      data: validationResult.data,
      include: {
        job: {
          include: {
            location: {
              include: {
                client: true,
              },
            },
          },
        },
      },
    })

    // Revalidate related pages
    revalidateJobPages()
    if (updated.job?.location?.client?.id) {
      revalidateInvoicePages(updated.job.location.client.id)
    }

    // Trigger cascading updates
    await cascadeAddOnUpdate(updated.id, 'update', updated.jobId || null)

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error updating add-on service:', error)
    return NextResponse.json(
      { error: 'Failed to update add-on service' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()
    const resolvedParams = await Promise.resolve(params)

    // Get the add-on service with job and invoice info
    const addOnService = await prisma.addOnService.findUnique({
      where: { id: resolvedParams.id },
      include: {
        job: {
          include: {
            invoiceLineItems: {
              include: {
                invoice: true,
              },
            },
            location: {
              include: {
                client: true,
              },
            },
          },
        },
        invoiceLineItems: true,
      },
    })

    if (!addOnService) {
      return NextResponse.json(
        { error: 'Add-on service not found' },
        { status: 404 }
      )
    }

    const finalInvoice = hasFinalInvoice(addOnService.job?.invoiceLineItems)
    if (finalInvoice) {
      return NextResponse.json(
        { error: 'Cannot delete add-on service: job has a sent or paid invoice' },
        { status: 400 }
      )
    }

    // Get all invoices that include this add-on
    const affectedInvoices = await prisma.invoice.findMany({
      where: {
        lineItems: {
          some: {
            addOnServiceId: resolvedParams.id,
          },
        },
      },
      select: {
        id: true,
        status: true,
      },
    })

    const clientId = addOnService.job?.location?.client?.id

    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the add-on service (invoice line items will be set to null via onDelete: SetNull)
      await tx.addOnService.delete({
        where: { id: resolvedParams.id },
      })

      // Recalculate totals for non-paid invoices
      for (const invoice of affectedInvoices) {
        if (invoice.status !== 'PAID') {
          try {
            await recalculateInvoiceTotal(invoice.id)
            logger.info(`[DELETE] Recalculated invoice ${invoice.id} after add-on deletion`)
          } catch (error) {
            logger.error(`[DELETE] Error recalculating invoice ${invoice.id}:`, error)
            // Continue with other invoices even if one fails
          }
        }
      }
    })

    // Revalidate related pages
    revalidateJobPages()
    if (clientId) {
      revalidateInvoicePages(clientId)
    }

    // Trigger cascading updates
    await cascadeAddOnUpdate(resolvedParams.id, 'delete', addOnService.jobId || null)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting add-on service:', error)
    return NextResponse.json(
      { error: 'Failed to delete add-on service' },
      { status: 500 }
    )
  }
}
