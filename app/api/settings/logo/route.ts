import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { readInvoiceLogoUpload, InvoiceLogoUploadError } from '@/lib/invoice-logo-upload'
import { logger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

async function currentRow() {
  return prisma.invoiceLogoSettings.findFirst({ orderBy: { createdAt: 'desc' } })
}

/** Serves the stored logo bytes for the Settings preview. */
export async function GET() {
  try {
    await requireAuth()
    const row = await currentRow()
    if (!row?.logoData) {
      return NextResponse.json({ hasLogo: false })
    }
    return new NextResponse(Buffer.from(row.logoData), {
      status: 200,
      headers: {
        'Content-Type': row.logoMimeType || 'image/png',
        'Content-Length': String(row.logoSize ?? row.logoData.length),
        // The preview must reflect a replacement immediately.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return handleApiError(error, 'Failed to load logo')
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth()

    const formData = await request.formData()
    const file = formData.get('logo')
    const upload = await readInvoiceLogoUpload(file instanceof File ? file : null)

    const existing = await currentRow()
    if (existing) {
      await prisma.invoiceLogoSettings.update({
        where: { id: existing.id },
        data: { ...upload, enabled: true },
      })
    } else {
      await prisma.invoiceLogoSettings.create({ data: { ...upload, enabled: true } })
    }

    // Invoice PDFs embed the logo, so their cache must regenerate.
    revalidatePath('/settings')
    revalidatePath('/invoices')

    logger.info(`[logo] uploaded ${upload.logoFileName} (${upload.logoSize} bytes)`)
    return NextResponse.json({
      hasLogo: true,
      fileName: upload.logoFileName,
      size: upload.logoSize,
      mimeType: upload.logoMimeType,
    })
  } catch (error) {
    if (error instanceof InvoiceLogoUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return handleApiError(error, 'Failed to upload logo')
  }
}

/** Removes the uploaded logo (the bundled default logo then applies again). */
export async function DELETE() {
  try {
    await requireAuth()
    const existing = await currentRow()
    if (existing?.logoData) {
      await prisma.invoiceLogoSettings.update({
        where: { id: existing.id },
        data: { logoData: null, logoMimeType: null, logoFileName: null, logoSize: null },
      })
    }
    revalidatePath('/settings')
    revalidatePath('/invoices')
    return NextResponse.json({ hasLogo: false })
  } catch (error) {
    return handleApiError(error, 'Failed to remove logo')
  }
}
