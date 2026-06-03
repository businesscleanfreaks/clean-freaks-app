import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { InvoicePDF } from '@/components/invoices/invoice-pdf'
import type { LogoSettings } from '@/components/invoices/invoice-pdf'
import { logger } from '@/lib/logger'
import type { InvoiceWithRelations } from '@/types'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Bump when invoice-pdf.tsx (the template) changes, to invalidate every cached PDF.
const PDF_TEMPLATE_VERSION = 'v2-grouped'

interface PdfFingerprintSource {
  invoiceNumber: string | null
  totalAmount: number
  dateDue: Date | null
  dateCreated: Date
  notes: string | null
  showPaymentOptions: boolean | null
  client: {
    name: string
    communicationContactName: string | null
    communicationEmail: string | null
    invoicingEmail: string | null
    communicationPhone: string | null
    phone: string | null
    billingType: string
    locations: Array<{ name: string; address: string }>
  } | null
  lineItems: Array<{
    id: string
    description: string
    amount: number
    serviceDate: Date | null
    jobId: string | null
    addOnServiceId: string | null
  }>
}

type CachedInvoice = {
  id: string
  pdfCache?: Uint8Array | Buffer | null
  pdfFingerprint?: string | null
}

/**
 * Deterministic content fingerprint. Deliberately excludes timestamps and the
 * cache columns so storing the cache never invalidates it, and includes a
 * template version so a renderer change forces regeneration.
 */
function computePdfFingerprint(invoice: PdfFingerprintSource, logoSettings: LogoSettings | undefined): string {
  const c = invoice.client
  const payload = {
    v: PDF_TEMPLATE_VERSION,
    inv: {
      n: invoice.invoiceNumber,
      t: invoice.totalAmount,
      due: invoice.dateDue,
      created: invoice.dateCreated,
      notes: invoice.notes,
      spo: invoice.showPaymentOptions,
    },
    client: c
      ? {
          name: c.name,
          ccn: c.communicationContactName,
          ce: c.communicationEmail,
          ie: c.invoicingEmail,
          cp: c.communicationPhone,
          p: c.phone,
          bt: c.billingType,
          loc: (c.locations || [])
            .map((l) => ({ n: l.name, a: l.address }))
            .sort((a, b) => (a.a || '').localeCompare(b.a || '')),
        }
      : null,
    items: invoice.lineItems
      .map((li) => ({ id: li.id, d: li.description, a: li.amount, sd: li.serviceDate, j: li.jobId, ao: li.addOnServiceId }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    logo: logoSettings || null,
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/**
 * Serve the cached PDF when the content fingerprint matches; otherwise render a
 * fresh PDF and store it. Keeps repeat previews instant without ever serving a
 * stale PDF — any line-item, clean, amount, or contact change bumps the fp.
 */
async function getOrRenderInvoicePdf(invoice: CachedInvoice, logoSettings: LogoSettings | undefined): Promise<Buffer> {
  const fingerprint = computePdfFingerprint(invoice as unknown as PdfFingerprintSource, logoSettings)

  if (invoice.pdfFingerprint === fingerprint && invoice.pdfCache) {
    return Buffer.from(invoice.pdfCache)
  }

  const element = React.createElement(InvoicePDF, {
    invoice: invoice as unknown as InvoiceWithRelations,
    logoSettings,
  })
  const buffer = await renderToBuffer(element as React.ReactElement)

  try {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfCache: buffer, pdfFingerprint: fingerprint },
    })
  } catch (err) {
    logger.warn('[invoice:generate-pdf] cache store failed (non-fatal):', err)
  }

  return buffer
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const requestId = crypto.randomUUID()
  let resolvedParams: { id: string } | undefined = undefined
  try {
    resolvedParams = await Promise.resolve(params)
    console.info('[invoice:generate-pdf] start', {
      requestId,
      invoiceId: resolvedParams!.id,
    })

    // Get invoice with all necessary data
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams!.id },
      include: {
        client: {
          include: {
            locations: true,
          },
        },
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
          },
        },
      },
    })

    if (!invoice) {
      console.warn('[invoice:generate-pdf] not-found', {
        requestId,
        invoiceId: resolvedParams!.id,
      })
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    // Fetch logo settings from DB
    let logoSettings: LogoSettings | undefined
    try {
      const dbSettings = await prisma.invoiceLogoSettings.findFirst({
        orderBy: { createdAt: 'desc' },
      })
      if (dbSettings) {
        logoSettings = {
          positionX: (dbSettings.positionX as 'left' | 'center' | 'right') || 'left',
          width: dbSettings.width || 160,
          maxHeight: dbSettings.maxHeight || 80,
        }
      }
    } catch {
      // Logo settings table may not exist yet — use defaults
    }

    // Render the PDF once and cache it (keyed by content fingerprint) so the
    // iframe's follow-up GET serves the cached bytes instantly.
    await getOrRenderInvoicePdf(invoice, logoSettings)

    // Generate a filename for download
    const filename = `invoice-${invoice.invoiceNumber || invoice.id}.pdf`

    // Generate the hosted PDF URL (for email and viewing). Use the request
    // origin so local 127.0.0.1 previews and production previews stay same-origin.
    const requestOrigin = new URL(request.url).origin
    const hostedPdfUrl = `${requestOrigin}/api/invoices/${invoice.id}/generate-pdf`
    const previewPdfUrl = `/api/invoices/${invoice.id}/generate-pdf`

    // Save the PDF URL to the database so email can use it
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl: hostedPdfUrl },
    })

    console.info('[invoice:generate-pdf] success', {
      requestId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      lineItemCount: invoice.lineItems.length,
      totalAmount: invoice.totalAmount,
      hostedPdfUrl,
    })

    return NextResponse.json({
      success: true,
      pdfUrl: previewPdfUrl,
      hostedPdfUrl,
      filename,
      invoiceNumber: invoice.invoiceNumber,
    })
  } catch (error) {
    logger.error('Error generating PDF:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    const errorStack = error instanceof Error ? error.stack : undefined
    
    // Log full error details for debugging
    logger.error('PDF generation error details:', {
      message: errorMessage,
      stack: errorStack,
      invoiceId: resolvedParams?.id || 'unknown',
    })
    console.error('[invoice:generate-pdf] failed', {
      requestId,
      invoiceId: resolvedParams?.id || 'unknown',
      message: errorMessage,
      stack: errorStack,
    })
    
    return NextResponse.json(
      { 
        error: `Failed to generate PDF: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}

// Also support GET for direct PDF download
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  let resolvedParams: { id: string } | undefined = undefined
  try {
    resolvedParams = await Promise.resolve(params)

    // Get invoice with all necessary data
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams!.id },
      include: {
        client: {
          include: {
            locations: true,
          },
        },
        lineItems: {
          include: {
            job: {
              include: {
                location: true,
              },
            },
          },
        },
      },
    })

    if (!invoice) {
      return new NextResponse('Invoice not found', { status: 404 })
    }

    // Fetch logo settings from DB
    let logoSettings: LogoSettings | undefined
    try {
      const dbSettings = await prisma.invoiceLogoSettings.findFirst({
        orderBy: { createdAt: 'desc' },
      })
      if (dbSettings) {
        logoSettings = {
          positionX: (dbSettings.positionX as 'left' | 'center' | 'right') || 'left',
          width: dbSettings.width || 160,
          maxHeight: dbSettings.maxHeight || 80,
        }
      }
    } catch {
      // Logo settings table may not exist yet — use defaults
    }

    // Serve the cached PDF when content is unchanged; render + cache otherwise.
    const pdfBuffer = await getOrRenderInvoicePdf(invoice, logoSettings)

    // Return PDF directly as a downloadable file
    const filename = `invoice-${invoice.invoiceNumber || invoice.id}.pdf`
    
    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(pdfBuffer)
    
    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    })
  } catch (error) {
    logger.error('Error generating PDF:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return new NextResponse(`Failed to generate PDF: ${errorMessage}`, { status: 500 })
  }
}
