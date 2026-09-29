import { NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/logger'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { revalidateClientPages } from '@/lib/revalidate'
import { photoUrl } from '@/lib/photos'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  // Names, emails and phone numbers: behind the session like every other read.
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const rows = await prisma.clientContact.findMany({
      where: { clientId: params.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      include: { photo: { select: { updatedAt: true } } },
    })
    // The headshot as a URL; the bytes are served by /api/photos.
    const contacts = rows.map(({ photo, ...contact }) => ({
      ...contact,
      photoUrl: photoUrl('contact', contact.id, photo?.updatedAt),
    }))
    return NextResponse.json(
      { contacts },
      {
        headers: {
          // Not cached: this is data people edit, and a reload right after an
          // edit was being answered from the browser cache with the old copy.
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { name, email, phone, role, billingRole, isPrimary, notes } = await request.json()
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const contact = await prisma.$transaction(async (tx) => {
      // One primary contact per client: the person the list and the profile
      // lead with.
      if (isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId: params.id, isPrimary: true },
          data: { isPrimary: false },
        })
      }
      return tx.clientContact.create({
        data: {
          clientId: params.id,
          name: name.trim(),
          email: email?.trim() || null,
          phone: phone?.trim() || null,
          role: role || 'GENERAL',
          // The job title ("Owner", "Property Manager") · see lib/new-client.ts.
          billingRole: billingRole?.trim() || null,
          isPrimary: isPrimary ?? false,
          notes: notes?.trim() || null,
        },
      })
    })

    revalidateClientPages(params.id)
    return NextResponse.json({ contact })
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
