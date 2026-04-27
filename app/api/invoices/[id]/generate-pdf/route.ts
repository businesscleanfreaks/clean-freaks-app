import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { InvoicePDF } from '@/components/invoices/invoice-pdf'
import type { LogoSettings } from '@/components/invoices/invoice-pdf'
import { logger } from '@/lib/logger'
import { getBaseUrl } from '@/lib/url'
import type { InvoiceWithRelations } from '@/types'

export async function POST(
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

    // Generate PDF using react-pdf
    const pdfProps = { invoice: invoice as unknown as InvoiceWithRelations, logoSettings }
    const invoiceElement = React.createElement(InvoicePDF, pdfProps)
    const pdfBuffer = await renderToBuffer(invoiceElement as React.ReactElement)

    // Convert buffer to base64 data URL
    const base64 = Buffer.from(pdfBuffer).toString('base64')
    const dataUrl = `data:application/pdf;base64,${base64}`

    // Generate a filename for download
    const filename = `invoice-${invoice.invoiceNumber || invoice.id}.pdf`

    // Generate the hosted PDF URL (for email and viewing)
    const baseUrl = getBaseUrl()
    const hostedPdfUrl = `${baseUrl}/api/invoices/${invoice.id}/generate-pdf`

    // Save the PDF URL to the database so email can use it
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfUrl: hostedPdfUrl },
    })

    return NextResponse.json({
      success: true,
      pdfDataUrl: dataUrl,
      pdfUrl: hostedPdfUrl,
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

    // Generate PDF using react-pdf
    const pdfProps = { invoice: invoice as unknown as InvoiceWithRelations, logoSettings }
    const invoiceElement = React.createElement(InvoicePDF, pdfProps)
    const pdfBuffer = await renderToBuffer(invoiceElement as React.ReactElement)

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
