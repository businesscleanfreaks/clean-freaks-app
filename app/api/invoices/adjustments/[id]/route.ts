import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'

export const dynamic = 'force-dynamic'

/** PATCH { approved } — approve or un-approve one adjustment. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const { approved } = (await request.json()) ?? {}
    if (typeof approved !== 'boolean') {
      return NextResponse.json({ error: 'approved must be true or false' }, { status: 400 })
    }

    const existing = await prisma.invoiceAdjustment.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 })

    const updated = await prisma.invoiceAdjustment.update({ where: { id }, data: { approved } })
    return NextResponse.json({ adjustment: updated })
  } catch (error) {
    return handleApiError(error, 'Failed to update adjustment')
  }
}

/** DELETE — remove an adjustment, restoring the invoice total. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)
    const existing = await prisma.invoiceAdjustment.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 })

    await prisma.invoiceAdjustment.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'Failed to remove adjustment')
  }
}
