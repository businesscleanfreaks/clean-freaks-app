import { NextResponse } from 'next/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getPayoutSettings, savePayoutSettings, PAYOUT_CADENCE_OPTIONS } from '@/lib/payout-settings'

export const dynamic = 'force-dynamic'

const cadence = z.enum(PAYOUT_CADENCE_OPTIONS)
const bodySchema = z.object({
  residentialPayoutCadence: cadence,
  commercialPayoutCadence: cadence,
})

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json(await getPayoutSettings())
  } catch (error) {
    return handleApiError(error, 'Failed to load payout settings')
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const saved = await savePayoutSettings(parsed.data)
    revalidatePath('/settings')
    return NextResponse.json(saved)
  } catch (error) {
    return handleApiError(error, 'Failed to save payout settings')
  }
}
