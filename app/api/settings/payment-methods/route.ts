import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { getPaymentMethods, savePaymentMethods } from '@/lib/payment-methods'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    return NextResponse.json({ methods: await getPaymentMethods() })
  } catch (error) {
    return handleApiError(error, 'Failed to load payment methods')
  }
}

export async function PUT(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    // sanitizePaymentMethods handles trimming, dedupe, length and count caps.
    const methods = await savePaymentMethods(body?.methods)
    revalidatePath('/settings')
    return NextResponse.json({ methods })
  } catch (error) {
    return handleApiError(error, 'Failed to save payment methods')
  }
}
