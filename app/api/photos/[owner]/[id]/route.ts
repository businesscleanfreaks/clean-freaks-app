import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'
import { revalidateClientPages } from '@/lib/revalidate'
import { isPhotoOwner, photoUploadProblem, photoUrl, type PhotoOwner } from '@/lib/photos'

export const dynamic = 'force-dynamic'

type Params = { params: { owner: string; id: string } }

/** The owner's column on Photo, as the one-photo-per-owner lookup and as the link to write. */
function ownerField(owner: PhotoOwner, id: string): { clientId: string } | { locationId: string } | { contactId: string } {
  switch (owner) {
    case 'client': return { clientId: id }
    case 'location': return { locationId: id }
    case 'contact': return { contactId: id }
  }
}

const whereFor = (owner: PhotoOwner, id: string): Prisma.PhotoWhereUniqueInput => ownerField(owner, id)

/** The client the owner belongs to, or null when the owner does not exist. */
async function clientOf(owner: PhotoOwner, id: string): Promise<string | null> {
  if (owner === 'client') {
    return (await prisma.client.findUnique({ where: { id }, select: { id: true } }))?.id ?? null
  }
  if (owner === 'location') {
    return (await prisma.location.findUnique({ where: { id }, select: { clientId: true } }))?.clientId ?? null
  }
  return (await prisma.clientContact.findUnique({ where: { id }, select: { clientId: true } }))?.clientId ?? null
}

/**
 * Serve a photo. Behind the session like every other read: a client's
 * building and their contacts' faces are not for a guessable public URL.
 */
export async function GET(request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    if (!isPhotoOwner(params.owner)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const photo = await prisma.photo.findUnique({
      where: whereFor(params.owner, params.id),
      select: { data: true, mimeType: true },
    })
    if (!photo) return NextResponse.json({ error: 'No photo' }, { status: 404 })

    // The page asks with ?v=<updatedAt>, so a replaced photo is a new URL and
    // this one never changes. Private: it is behind auth.
    const versioned = new URL(request.url).searchParams.has('v')
    return new NextResponse(new Uint8Array(photo.data), {
      headers: {
        'Content-Type': photo.mimeType,
        'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      },
    })
  } catch (error) {
    logger.error('Error serving photo:', error)
    return handleApiError(error, 'Failed to load the photo')
  }
}

/**
 * Set a photo.
 *
 * Multipart with one `file`: upload it. A location may add `alsoClient=1` to
 * make it the client photo too ("Also use as the client photo").
 * JSON `{ fromLocation }`, for a client only: copy that location's photo
 * ("Or use a location photo"). The location must be the client's own.
 */
export async function POST(request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { owner: rawOwner, id } = params
    if (!isPhotoOwner(rawOwner)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const owner = rawOwner

    const clientId = await clientOf(owner, id)
    if (!clientId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let data: Buffer
    let mimeType: string
    let alsoClient = false

    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      const body = await request.json().catch(() => null)
      const fromLocation = typeof body?.fromLocation === 'string' ? body.fromLocation : null
      if (owner !== 'client' || !fromLocation) {
        return NextResponse.json({ error: 'Nothing to copy' }, { status: 400 })
      }
      const source = await prisma.photo.findFirst({
        where: { locationId: fromLocation, location: { clientId: id } },
        select: { data: true, mimeType: true },
      })
      if (!source) return NextResponse.json({ error: 'That location has no photo' }, { status: 404 })
      data = Buffer.from(source.data)
      mimeType = source.mimeType
    } else {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) return NextResponse.json({ error: 'No file was uploaded' }, { status: 400 })
      const problem = photoUploadProblem(file)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      data = Buffer.from(await file.arrayBuffer())
      mimeType = file.type
      alsoClient = owner === 'location' && form.get('alsoClient') === '1'
    }

    const saved = await prisma.$transaction(async tx => {
      const photo = await tx.photo.upsert({
        where: whereFor(owner, id),
        create: { ...ownerField(owner, id), data, mimeType },
        update: { data, mimeType },
        select: { updatedAt: true },
      })
      if (alsoClient) {
        await tx.photo.upsert({
          where: { clientId },
          create: { clientId, data, mimeType },
          update: { data, mimeType },
        })
      }
      return photo
    })

    revalidateClientPages(clientId)
    return NextResponse.json({ url: photoUrl(owner, id, saved.updatedAt) })
  } catch (error) {
    logger.error('Error saving photo:', error)
    return handleApiError(error, 'Failed to save the photo')
  }
}

/** Remove a photo. Removing one that is not there is not an error. */
export async function DELETE(_request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    if (!isPhotoOwner(params.owner)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const clientId = await clientOf(params.owner, params.id)
    if (!clientId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await prisma.photo.deleteMany({ where: ownerField(params.owner, params.id) })
    revalidateClientPages(clientId)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing photo:', error)
    return handleApiError(error, 'Failed to remove the photo')
  }
}
