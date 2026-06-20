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
const PDF_TEMPLATE_VERSION = 'v4-ref-layout'
const LOGO_SETTINGS_CACHE_MS = 60_000

class InvoicePdfNotFoundError extends Error {}

async function fetchInvoiceForPdf(invoiceId: string) {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
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
}

type InvoiceForPdf = NonNullable<Awaited<ReturnType<typeof fetchInvoiceForPdf>>>

const pdfRenderInFlight = new Map<string, Promise<Buffer>>()
const invoicePdfInFlight = new Map<string, Promise<{ invoice: InvoiceForPdf; pdfBuffer: Buffer }>>()
let logoSettingsCache: { expiresAt: number; value: LogoSettings | undefined } | null = null

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

function isConnectionLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /max clients|EMAXCONNSESSION|MaxClientsInSessionMode/i.test(message)
}

function publicPdfErrorMessage(error: unknown) {
  if (error instanceof InvoicePdfNotFoundError) return 'Invoice not found'
  if (isConnectionLimitError(error)) {
    return 'PDF generation is temporarily busy. Please wait a few seconds and try again.'
  }
  return 'Failed to generate PDF. Please try again.'
}

async function getLogoSettings(): Promise<LogoSettings | undefined> {
  const now = Date.now()
  if (logoSettingsCache && logoSettingsCache.expiresAt > now) {
    return logoSettingsCache.value
  }

  let value: LogoSettings | undefined
  try {
    const dbSettings = await prisma.invoiceLogoSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    })
    if (dbSettings) {
      value = {
        positionX: (dbSettings.positionX as 'left' | 'center' | 'right') || 'left',
        width: dbSettings.width || 160,
        maxHeight: dbSettings.maxHeight || 80,
      }
    }
  } catch {
    // Logo settings table may not exist yet - use defaults.
  }

  logoSettingsCache = { expiresAt: now + LOGO_SETTINGS_CACHE_MS, value }
  return value
}

/**
 * Serve the cached PDF when the content fingerprint matches; otherwise render a
 * fresh PDF and store it. Keeps repeat previews instant without ever serving a
 * stale PDF — any line-item, clean, amount, or contact change bumps the fp.
 */
async function getOrRenderInvoicePdf(invoice: { id: string }, logoSettings: LogoSettings | undefined): Promise<Buffer> {
  const fingerprint = computePdfFingerprint(invoice as unknown as PdfFingerprintSource, logoSettings)

  const cached = await prisma.invoicePdfCache.findUnique({ where: { invoiceId: invoice.id } })
  if (cached && cached.fingerprint === fingerprint) {
    return Buffer.from(cached.data)
  }

  const inFlightKey = `${invoice.id}:${fingerprint}`
  const existingRender = pdfRenderInFlight.get(inFlightKey)
  if (existingRender) {
    return existingRender
  }

  const renderPromise = (async () => {
    const element = React.createElement(InvoicePDF, {
      invoice: invoice as unknown as InvoiceWithRelations,
      logoSettings,
    })
    const buffer = await renderToBuffer(element as React.ReactElement)

    try {
      await prisma.invoicePdfCache.upsert({
        where: { invoiceId: invoice.id },
        create: { invoiceId: invoice.id, data: buffer, fingerprint },
        update: { data: buffer, fingerprint },
      })
    } catch (err) {
      logger.warn('[invoice:generate-pdf] cache store failed (non-fatal):', err)
    }

    return buffer
  })()

  pdfRenderInFlight.set(inFlightKey, renderPromise)
  try {
    return await renderPromise
  } finally {
    if (pdfRenderInFlight.get(inFlightKey) === renderPromise) {
      pdfRenderInFlight.delete(inFlightKey)
    }
  }
}

async function getInvoicePdfPayload(invoiceId: string) {
  const existing = invoicePdfInFlight.get(invoiceId)
  if (existing) return existing

  const promise = (async () => {
    const invoice = await fetchInvoiceForPdf(invoiceId)
    if (!invoice) throw new InvoicePdfNotFoundError('Invoice not found')

    const logoSettings = await getLogoSettings()
    const pdfBuffer = await getOrRenderInvoicePdf(invoice, logoSettings)
    return { invoice, pdfBuffer }
  })()

  invoicePdfInFlight.set(invoiceId, promise)
  try {
    return await promise
  } finally {
    if (invoicePdfInFlight.get(invoiceId) === promise) {
      invoicePdfInFlight.delete(invoiceId)
    }
  }
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

    const payload = await getInvoicePdfPayload(resolvedParams!.id)
    const invoiceForResponse = payload.invoice
    const filenameForResponse = `invoice-${invoiceForResponse.invoiceNumber || invoiceForResponse.id}.pdf`
    const requestOrigin = new URL(request.url).origin
    const hostedPdfUrl = `${requestOrigin}/api/invoices/${invoiceForResponse.id}/generate-pdf`
    const previewPdfUrl = `/api/invoices/${invoiceForResponse.id}/generate-pdf`

    if (invoiceForResponse.pdfUrl !== hostedPdfUrl) {
      await prisma.invoice.update({
        where: { id: invoiceForResponse.id },
        data: { pdfUrl: hostedPdfUrl },
      })
    }

    console.info('[invoice:generate-pdf] success', {
      requestId,
      invoiceId: invoiceForResponse.id,
      invoiceNumber: invoiceForResponse.invoiceNumber,
      lineItemCount: invoiceForResponse.lineItems.length,
      totalAmount: invoiceForResponse.totalAmount,
      hostedPdfUrl,
    })

    return NextResponse.json({
      success: true,
      pdfUrl: previewPdfUrl,
      hostedPdfUrl,
      filename: filenameForResponse,
      invoiceNumber: invoiceForResponse.invoiceNumber,
    })

    /*
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
    */
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
    
    const status = error instanceof InvoicePdfNotFoundError ? 404 : 500
    return NextResponse.json(
      {
        error: publicPdfErrorMessage(error),
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status }
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

    const payload = await getInvoicePdfPayload(resolvedParams!.id)
    const invoiceForDownload = payload.invoice
    const filenameForDownload = `invoice-${invoiceForDownload.invoiceNumber || invoiceForDownload.id}.pdf`
    const uint8ArrayForDownload = new Uint8Array(payload.pdfBuffer)

    return new NextResponse(uint8ArrayForDownload, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filenameForDownload}"`,
        'Cache-Control': 'private, max-age=60',
      },
    })

    /*
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
    */
  } catch (error) {
    logger.error('Error generating PDF:', error)
    const status = error instanceof InvoicePdfNotFoundError ? 404 : 500
    return new NextResponse(publicPdfErrorMessage(error), { status })
  }
}
