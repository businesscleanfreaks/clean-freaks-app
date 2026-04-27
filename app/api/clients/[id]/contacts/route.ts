import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const contacts = await prisma.clientContact.findMany({
      where: { clientId: params.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ contacts })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { name, email, phone, role, isPrimary, notes } = await request.json()
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    // If setting isPrimary, unset it on other contacts with same role
    if (isPrimary && role) {
      await prisma.clientContact.updateMany({
        where: { clientId: params.id, role, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    const contact = await prisma.clientContact.create({
      data: {
        clientId: params.id,
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        role: role || 'GENERAL',
        isPrimary: isPrimary ?? false,
        notes: notes?.trim() || null,
      },
    })

    return NextResponse.json({ contact })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
