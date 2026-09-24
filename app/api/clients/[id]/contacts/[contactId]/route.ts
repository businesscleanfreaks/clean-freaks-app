import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { revalidateClientPages } from '@/lib/revalidate'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; contactId: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { name, email, phone, role, billingRole, isPrimary, notes } = await request.json()

    const data: Record<string, string | boolean | null> = {}
    if (name !== undefined) {
      if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      data.name = name.trim()
    }
    if (email !== undefined) data.email = email?.trim() || null
    if (phone !== undefined) data.phone = phone?.trim() || null
    if (role !== undefined) data.role = role
    if (billingRole !== undefined) data.billingRole = billingRole?.trim() || null
    if (isPrimary !== undefined) data.isPrimary = isPrimary
    if (notes !== undefined) data.notes = notes?.trim() || null

    const contact = await prisma.$transaction(async (tx) => {
      // Only this client's contact: the id in the URL is not trusted alone.
      const updated = await tx.clientContact.updateMany({
        where: { id: params.contactId, clientId: params.id },
        data,
      })
      if (updated.count === 0) return null
      // One primary contact per client.
      if (isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId: params.id, isPrimary: true, NOT: { id: params.contactId } },
          data: { isPrimary: false },
        })
      }
      return tx.clientContact.findUnique({ where: { id: params.contactId } })
    })
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    revalidateClientPages(params.id)
    return NextResponse.json({ contact })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: { id: string; contactId: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const deleted = await prisma.clientContact.deleteMany({ where: { id: params.contactId, clientId: params.id } })
    if (deleted.count === 0) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    revalidateClientPages(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
