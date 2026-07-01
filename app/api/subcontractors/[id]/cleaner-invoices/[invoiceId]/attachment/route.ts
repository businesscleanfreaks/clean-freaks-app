import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { CleanerInvoiceAttachmentError, readCleanerInvoiceAttachment } from '@/lib/cleaner-invoice-attachment'
import { cleanerInvoiceResponseSelect } from '@/lib/cleaner-invoice-select'

function dispositionFileName(name: string | null): string {
  return (name || 'cleaner-invoice.pdf').replace(/["\r\n]/g, '_')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> | { id: string; invoiceId: string } },
) {
  try {
    await requireAuth()
    const { id, invoiceId } = await Promise.resolve(params)
    const invoice = await prisma.cleanerInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        subcontractorId: true,
        attachmentFileName: true,
        attachmentMimeType: true,
        attachmentData: true,
      },
    })

    if (!invoice || invoice.subcontractorId !== id) {
      return NextResponse.json({ error: 'Cleaner invoice not found' }, { status: 404 })
    }
    if (!invoice.attachmentData) {
      return NextResponse.json({ error: 'No cleaner invoice PDF attached' }, { status: 404 })
    }

    const filename = dispositionFileName(invoice.attachmentFileName)
    return new NextResponse(new Uint8Array(invoice.attachmentData), {
      headers: {
        'Content-Type': invoice.attachmentMimeType || 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    return handleApiError(error, 'Failed to load cleaner invoice PDF')
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> | { id: string; invoiceId: string } },
) {
  try {
    await requireAuth()
    const { id, invoiceId } = await Promise.resolve(params)
    const existing = await prisma.cleanerInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, subcontractorId: true },
    })
    if (!existing || existing.subcontractorId !== id) {
      return NextResponse.json({ error: 'Cleaner invoice not found' }, { status: 404 })
    }

    const form = await request.formData()
    const file = form.get('file')
    const attachment = await readCleanerInvoiceAttachment(file instanceof File ? file : null)
    if (!attachment) {
      return NextResponse.json({ error: 'PDF file is required' }, { status: 400 })
    }

    const invoice = await prisma.cleanerInvoice.update({
      where: { id: invoiceId },
      data: attachment,
      select: cleanerInvoiceResponseSelect,
    })
    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof CleanerInvoiceAttachmentError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return handleApiError(error, 'Failed to attach cleaner invoice PDF')
  }
}
