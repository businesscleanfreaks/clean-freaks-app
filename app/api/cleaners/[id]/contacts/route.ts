import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'

/** Add a point of contact for this cleaner. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id: subcontractorId } = await Promise.resolve(params)
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })

    const count = await prisma.cleanerContact.count({ where: { subcontractorId } })
    const contact = await prisma.cleanerContact.create({
      data: {
        subcontractorId,
        name: name.slice(0, 120),
        role: str(body?.role, 60),
        phone: str(body?.phone, 40),
        email: str(body?.email, 160),
        sortOrder: count,
      },
    })
    return NextResponse.json({ contact }, { status: 201 })
  } catch (error) {
    logger.error('Error adding cleaner contact:', error)
    return handleApiError(error, 'Failed to add the contact')
  }
}

/** Edit or remove one, by `contactId` in the body / query. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id: subcontractorId } = await Promise.resolve(params)
    const body = await request.json().catch(() => ({}))
    const contactId = typeof body?.contactId === 'string' ? body.contactId : ''
    if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

    // Scoped to this cleaner so an id from elsewhere cannot be edited through here.
    const existing = await prisma.cleanerContact.findFirst({
      where: { id: contactId, subcontractorId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'A name is required' }, { status: 400 })
    }

    const contact = await prisma.cleanerContact.update({
      where: { id: contactId },
      data: {
        ...(name !== undefined ? { name: name.slice(0, 120) } : {}),
        ...('role' in body ? { role: str(body.role, 60) } : {}),
        ...('phone' in body ? { phone: str(body.phone, 40) } : {}),
        ...('email' in body ? { email: str(body.email, 160) } : {}),
      },
    })
    return NextResponse.json({ contact })
  } catch (error) {
    logger.error('Error updating cleaner contact:', error)
    return handleApiError(error, 'Failed to update the contact')
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id: subcontractorId } = await Promise.resolve(params)
    const contactId = new URL(request.url).searchParams.get('contactId') || ''
    if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

    await prisma.cleanerContact.deleteMany({ where: { id: contactId, subcontractorId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing cleaner contact:', error)
    return handleApiError(error, 'Failed to remove the contact')
  }
}

/** Trim, cap, and turn an empty string into null so blanks clear the field. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
