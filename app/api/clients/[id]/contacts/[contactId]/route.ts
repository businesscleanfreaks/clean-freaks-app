import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; contactId: string } }
) {
  try {
    const { name, email, phone, role, isPrimary, notes } = await request.json()

    // If setting isPrimary, unset it on other contacts with same role
    if (isPrimary && role) {
      await prisma.clientContact.updateMany({
        where: {
          clientId: params.id,
          role,
          isPrimary: true,
          NOT: { id: params.contactId },
        },
        data: { isPrimary: false },
      })
    }

    const data: Record<string, string | boolean | null> = {}
    if (name !== undefined) data.name = name.trim()
    if (email !== undefined) data.email = email?.trim() || null
    if (phone !== undefined) data.phone = phone?.trim() || null
    if (role !== undefined) data.role = role
    if (isPrimary !== undefined) data.isPrimary = isPrimary
    if (notes !== undefined) data.notes = notes?.trim() || null

    const contact = await prisma.clientContact.update({
      where: { id: params.contactId },
      data,
    })

    return NextResponse.json({ contact })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: { id: string; contactId: string } }
) {
  try {
    await prisma.clientContact.delete({ where: { id: params.contactId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
