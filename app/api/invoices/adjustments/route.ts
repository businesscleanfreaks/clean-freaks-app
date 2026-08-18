import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { isValidMode, signedAmount, defaultLabel } from '@/lib/invoice-adjustments'
import { isValidPeriod } from '@/lib/invoice-overview'

export const dynamic = 'force-dynamic'

/** GET ?candidateId=…&period=yyyy-MM — adjustments for one invoice candidate. */
export async function GET(request: Request) {
  try {
    await requireAuth()
    const { searchParams } = new URL(request.url)
    const candidateId = searchParams.get('candidateId')
    const period = searchParams.get('period')
    if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    if (!isValidPeriod(period)) return NextResponse.json({ error: 'A valid period is required' }, { status: 400 })

    const adjustments = await prisma.invoiceAdjustment.findMany({
      where: { candidateId, period },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ adjustments })
  } catch (error) {
    return handleApiError(error, 'Failed to load adjustments')
  }
}

/** POST — add a credit, discount or charge to a candidate. */
export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const { candidateId, period, clientId, mode, label, amount, serviceDay } = body ?? {}

    if (!candidateId || typeof candidateId !== 'string') {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }
    if (!isValidPeriod(period)) return NextResponse.json({ error: 'A valid period is required' }, { status: 400 })
    if (!clientId || typeof clientId !== 'string') {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }
    if (!isValidMode(mode)) return NextResponse.json({ error: 'Unknown adjustment type.' }, { status: 400 })

    // signedAmount rejects blank and zero, so a no-op row can never be stored.
    const signed = signedAmount(mode, amount)
    if (signed === null) {
      return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
    }

    const day = Number.isInteger(serviceDay) && serviceDay >= 1 && serviceDay <= 31 ? serviceDay : null
    const created = await prisma.invoiceAdjustment.create({
      data: {
        candidateId,
        period,
        clientId,
        mode,
        label: (typeof label === 'string' && label.trim()) || defaultLabel(mode, day),
        amount: signed,
        serviceDay: day,
        // Deliberately starts unapproved: the design requires an explicit
        // per-row approval before the invoice can be sent.
        approved: false,
      },
    })
    return NextResponse.json({ adjustment: created }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Failed to add adjustment')
  }
}
