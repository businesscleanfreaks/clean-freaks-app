import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'
import { cleanerFileKind, cleanerFileUploadProblem, cleanerFileUrl } from '@/lib/cleaner-files'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> | { id: string } }

const cleanerExists = async (id: string) =>
  !!(await prisma.subcontractor.findUnique({ where: { id }, select: { id: true } }))

/**
 * Serve a cleaner's photo or W-9.
 *
 * `?kind=photo` or `?kind=w9`. Behind the same auth as everything else — a W-9
 * carries a legal name and is not something to hand out on a guessable URL.
 */
export async function GET(request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const url = new URL(request.url)
    const kind = cleanerFileKind(url.searchParams.get('kind'))

    const file = await prisma.subcontractorFile.findUnique({
      where: { subcontractorId_kind: { subcontractorId: id, kind } },
      select: { data: true, mimeType: true, fileName: true },
    })
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 404 })

    // The profile asks with ?v=<updatedAt>, so a replaced file is a new URL and
    // this one never changes. Private: it is behind auth, so it must not sit
    // in a shared cache.
    const versioned = url.searchParams.has('v')
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        'Content-Type': file.mimeType,
        'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        ...(kind === 'w9' && file.fileName
          ? { 'Content-Disposition': `inline; filename="${file.fileName.replace(/"/g, '')}"` }
          : {}),
      },
    })
  } catch (error) {
    logger.error('Error serving cleaner file:', error)
    return handleApiError(error, 'Failed to load the file')
  }
}

/** Upload a photo or a W-9. Multipart, one file, `kind` alongside it. */
export async function POST(request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const form = await request.formData()
    const kind = cleanerFileKind(form.get('kind'))
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was uploaded' }, { status: 400 })
    }
    const problem = cleanerFileUploadProblem(kind, file)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    if (!(await cleanerExists(id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = Buffer.from(await file.arrayBuffer())
    const fileName = file.name.slice(0, 160) || null
    const saved = await prisma.$transaction(async tx => {
      const row = await tx.subcontractorFile.upsert({
        where: { subcontractorId_kind: { subcontractorId: id, kind } },
        create: { subcontractorId: id, kind, data, mimeType: file.type, fileName },
        update: { data, mimeType: file.type, fileName },
        select: { updatedAt: true },
      })
      // Uploading the document IS the confirmation that it is on file.
      if (kind === 'w9') await tx.subcontractor.update({ where: { id }, data: { w9OnFile: true } })
      return row
    })

    return NextResponse.json({ success: true, kind, url: cleanerFileUrl(id, kind, saved.updatedAt) })
  } catch (error) {
    logger.error('Error uploading cleaner file:', error)
    return handleApiError(error, 'Failed to upload')
  }
}

/** Remove one. A removed W-9 also clears the "on file" flag. */
export async function DELETE(request: Request, { params }: Params) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const kind = cleanerFileKind(new URL(request.url).searchParams.get('kind'))
    if (!(await cleanerExists(id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.$transaction([
      prisma.subcontractorFile.deleteMany({ where: { subcontractorId: id, kind } }),
      ...(kind === 'w9' ? [prisma.subcontractor.update({ where: { id }, data: { w9OnFile: false } })] : []),
    ])
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing cleaner file:', error)
    return handleApiError(error, 'Failed to remove the file')
  }
}
