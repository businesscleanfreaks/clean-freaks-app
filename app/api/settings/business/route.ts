import { NextResponse } from 'next/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getBusinessProfile, saveBusinessProfile } from '@/lib/business-settings'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(120),
  legalName: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  paymentEmail: z.string().trim().max(200).optional().nullable(),
})

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json(await getBusinessProfile())
  } catch (error) {
    return handleApiError(error, 'Failed to load business profile')
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const saved = await saveBusinessProfile({
      businessName: parsed.data.businessName,
      legalName: parsed.data.legalName || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      paymentEmail: parsed.data.paymentEmail || null,
    })
    // Invoices and emails read this identity, so refresh those views.
    revalidatePath('/settings')
    revalidatePath('/invoices')
    return NextResponse.json(saved)
  } catch (error) {
    return handleApiError(error, 'Failed to save business profile')
  }
}
