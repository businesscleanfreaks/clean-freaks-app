import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'

export const dynamic = 'force-dynamic'

/** Kept small on purpose: these live inline in Postgres, not on a file host. */
const MAX_BYTES = 5 * 1024 * 1024

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const W9_TYPES = [...PHOTO_TYPES, 'application/pdf']

/**
 * Serve a cleaner's photo or W-9.
 *
 * `?kind=photo` or `?kind=w9`. Behind the same auth as everything else — a W-9
 * carries a legal name and is not something to hand out on a guessable URL.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const kind = new URL(request.url).searchParams.get('kind') === 'w9' ? 'w9' : 'photo'

    // Selected together rather than conditionally: a branching `select` leaves
    // Prisma unable to infer either shape.
    const row = await prisma.subcontractor.findUnique({
      where: { id },
      select: {
        w9Data: true, w9MimeType: true, w9FileName: true,
        photoData: true, photoMimeType: true,
      },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = kind === 'w9' ? row.w9Data : row.photoData
    const mime = kind === 'w9' ? row.w9MimeType : row.photoMimeType
    if (!data || !mime) return NextResponse.json({ error: 'No file' }, { status: 404 })

    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': mime,
        // Private: it is behind auth, so it must not sit in a shared cache.
        'Cache-Control': 'private, max-age=300',
        ...(kind === 'w9' && row.w9FileName
          ? { 'Content-Disposition': `inline; filename="${row.w9FileName.replace(/"/g, '')}"` }
          : {}),
      },
    })
  } catch (error) {
    logger.error('Error serving cleaner file:', error)
    return handleApiError(error, 'Failed to load the file')
  }
}

/** Upload a photo or a W-9. Multipart, one file, `kind` alongside it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const form = await request.formData()
    const kind = form.get('kind') === 'w9' ? 'w9' : 'photo'
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was uploaded' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That file is over 5MB' }, { status: 400 })
    }
    const allowed = kind === 'w9' ? W9_TYPES : PHOTO_TYPES
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: kind === 'w9' ? 'Upload a PDF or an image' : 'Upload an image' },
        { status: 400 },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    await prisma.subcontractor.update({
      where: { id },
      data: kind === 'w9'
        ? {
            w9Data: bytes,
            w9MimeType: file.type,
            w9FileName: file.name.slice(0, 160),
            w9UploadedAt: new Date(),
            // Uploading the document IS the confirmation that it is on file.
            w9OnFile: true,
          }
        : { photoData: bytes, photoMimeType: file.type },
    })

    return NextResponse.json({ success: true, kind })
  } catch (error) {
    logger.error('Error uploading cleaner file:', error)
    return handleApiError(error, 'Failed to upload')
  }
}

/** Remove one. A removed W-9 also clears the "on file" flag. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const kind = new URL(request.url).searchParams.get('kind') === 'w9' ? 'w9' : 'photo'

    await prisma.subcontractor.update({
      where: { id },
      data: kind === 'w9'
        ? { w9Data: null, w9MimeType: null, w9FileName: null, w9UploadedAt: null, w9OnFile: false }
        : { photoData: null, photoMimeType: null },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing cleaner file:', error)
    return handleApiError(error, 'Failed to remove the file')
  }
}
