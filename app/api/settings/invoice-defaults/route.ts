import { NextResponse } from 'next/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import {
  getInvoiceDefaults,
  saveInvoiceDefaults,
  RESIDENTIAL_TERM_OPTIONS,
  COMMERCIAL_TERM_OPTIONS,
} from '@/lib/invoice-defaults'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  residentialPaymentTerms: z.enum(RESIDENTIAL_TERM_OPTIONS),
  commercialPaymentTerms: z.enum(COMMERCIAL_TERM_OPTIONS),
  invoiceFooterNote: z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json(await getInvoiceDefaults())
  } catch (error) {
    return handleApiError(error, 'Failed to load invoice defaults')
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const saved = await saveInvoiceDefaults({
      residentialPaymentTerms: parsed.data.residentialPaymentTerms,
      commercialPaymentTerms: parsed.data.commercialPaymentTerms,
      invoiceFooterNote: parsed.data.invoiceFooterNote || null,
    })
    // New invoices and the PDF footer read these, so refresh those views.
    revalidatePath('/settings')
    revalidatePath('/invoices')
    return NextResponse.json(saved)
  } catch (error) {
    return handleApiError(error, 'Failed to save invoice defaults')
  }
}
