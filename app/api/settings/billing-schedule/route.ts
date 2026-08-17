import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { revalidateClientPages } from '@/lib/revalidate'
import { validateUpdate, type BillingScheduleRow } from '@/lib/billing-schedule'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAuth()
    const clients = await prisma.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        propertyType: true,
        invoiceFrequency: true,
        paymentTerms: true,
        payMethod: true,
        billingDelivery: true,
        separateLocationInvoices: true,
        _count: { select: { locations: true } },
      },
      orderBy: { name: 'asc' },
    })

    const rows: BillingScheduleRow[] = clients.map(c => ({
      id: c.id,
      name: c.name,
      clientType: c.propertyType,
      cadence: c.invoiceFrequency,
      terms: c.paymentTerms,
      payMethod: c.payMethod,
      delivery: c.billingDelivery ?? 'EMAIL',
      locationCount: c._count.locations,
      separateLocationInvoices: c.separateLocationInvoices,
    }))

    return NextResponse.json({ rows })
  } catch (error) {
    return handleApiError(error, 'Failed to load billing schedule')
  }
}

/** PATCH one client's billing rules. Only the supplied fields change. */
export async function PATCH(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()
    const { clientId, ...patch } = body ?? {}
    if (!clientId || typeof clientId !== 'string') {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    const result = validateUpdate(patch)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const { clientType, cadence, terms, payMethod, delivery, separateLocationInvoices } = result.data
    await prisma.client.update({
      where: { id: clientId },
      data: {
        ...(clientType !== undefined && { propertyType: clientType }),
        ...(cadence !== undefined && { invoiceFrequency: cadence }),
        ...(terms !== undefined && { paymentTerms: terms }),
        ...(payMethod !== undefined && { payMethod }),
        ...(delivery !== undefined && { billingDelivery: delivery }),
        ...(separateLocationInvoices !== undefined && { separateLocationInvoices }),
      },
    })

    revalidateClientPages(clientId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'Failed to update billing schedule')
  }
}
