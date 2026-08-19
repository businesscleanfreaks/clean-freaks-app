import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getBillingSectionSettings, saveBillingSection } from '@/lib/billing-section-settings'

export const dynamic = 'force-dynamic'

const SECTIONS = ['oneTimeJobDefaults', 'invoiceFooterTemplates', 'reminderTemplates'] as const
type Section = (typeof SECTIONS)[number]

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json(await getBillingSectionSettings())
  } catch (error) {
    return handleApiError(error, 'Failed to load billing settings')
  }
}

/**
 * Save one section. The sheet saves per section rather than all at once, so a
 * half-finished edit in one section can never be written by saving another.
 */
export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json().catch(() => null)
    const section = body?.section as Section | undefined
    if (!section || !SECTIONS.includes(section)) {
      return NextResponse.json(
        { error: `section must be one of ${SECTIONS.join(', ')}` },
        { status: 400 },
      )
    }

    const saved = await saveBillingSection({ section, value: body?.value } as Parameters<typeof saveBillingSection>[0])

    // The PDF footer and new invoices read these.
    revalidatePath('/invoices')
    revalidatePath('/settings')
    return NextResponse.json(saved)
  } catch (error) {
    return handleApiError(error, 'Failed to save billing settings')
  }
}
