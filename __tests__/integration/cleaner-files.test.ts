/**
 * A cleaner's photo and W-9 through the real routes and database: kept in a
 * table of their own, served, replaced and removed; the profile's photo URL
 * moves when the photo does; the everyday reads that load cleaners whole never
 * carry the bytes; and the migration that moves the files already on live,
 * run exactly the way it is run there (`prisma db execute`).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb, seedWeeklyFlatRateClient } from './db-helpers'
import { DELETE as removeFile, GET as getFile, POST as postFile } from '@/app/api/cleaners/[id]/files/route'
import { GET as getCleanerProfile } from '@/app/api/cleaners/[id]/profile/route'
import { GET as getClient } from '@/app/api/clients/[id]/route'
import { GET as getSubcontractors } from '@/app/api/subcontractors/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// A real (1x1) PNG, so nothing here depends on the bytes being meaningless.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')

const ctx = (id: string) => ({ params: { id } })

function upload(id: string, kind: string, bytes: Buffer, type: string, name = 'file') {
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return postFile(new Request(`http://test/api/cleaners/${id}/files`, { method: 'POST', body: form }), ctx(id))
}

const read = (id: string, kind: string, v = true) =>
  getFile(new Request(`http://test/api/cleaners/${id}/files?kind=${kind}${v ? '&v=1' : ''}`), ctx(id))

const remove = (id: string, kind: string) =>
  removeFile(new Request(`http://test/api/cleaners/${id}/files?kind=${kind}`, { method: 'DELETE' }), ctx(id))

async function profile(id: string) {
  const res = await getCleanerProfile(new Request(`http://test/api/cleaners/${id}/profile`), ctx(id))
  expect(res.status).toBe(200)
  return res.json() as Promise<{
    cleaner: { hasPhoto: boolean; photoUrl: string | null; since: string }
    tax: { w9OnFile: boolean; w9FileName: string | null; w9UploadedAt: string | null }
  }>
}

/** Every path in `value` that holds raw bytes. */
function bytesIn(value: unknown, at = '$'): string[] {
  if (value instanceof Uint8Array) return [at]
  if (Array.isArray(value)) return value.flatMap((v, i) => bytesIn(v, `${at}[${i}]`))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => bytesIn(v, `${at}.${k}`))
  }
  return []
}

describe('uploading and serving a cleaner photo', () => {
  it('keeps it in its own table and serves it back, behind a URL that changes when it is replaced', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const res = await upload(sub.id, 'photo', PNG, 'image/png')
    expect(res.status).toBe(200)
    const first = (await res.json()).url as string
    expect(first).toMatch(new RegExp(`^/api/cleaners/${sub.id}/files\\?kind=photo&v=\\d+$`))

    const served = await read(sub.id, 'photo')
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('image/png')
    expect(served.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true)
    // Asked for without a version, it is never answered from a cache.
    expect((await read(sub.id, 'photo', false)).headers.get('Cache-Control')).toBe('private, no-cache')

    await new Promise(r => setTimeout(r, 5))
    const second = (await (await upload(sub.id, 'photo', JPEG, 'image/jpeg')).json()).url as string
    expect(second).not.toBe(first)
    expect((await read(sub.id, 'photo')).headers.get('Content-Type')).toBe('image/jpeg')
    expect(await prisma.subcontractorFile.count()).toBe(1)
  })

  it('refuses the wrong kind of file, and cleaners that do not exist', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    expect((await upload(sub.id, 'photo', PDF, 'application/pdf')).status).toBe(400)
    expect((await upload(sub.id, 'w9', Buffer.from('hello'), 'text/plain')).status).toBe(400)
    expect((await upload(sub.id, 'photo', Buffer.alloc(0), 'image/png')).status).toBe(400)
    expect((await upload('no-such-cleaner', 'photo', PNG, 'image/png')).status).toBe(404)
    expect((await remove('no-such-cleaner', 'photo')).status).toBe(404)
    expect(await prisma.subcontractorFile.count()).toBe(0)
  })

  it('goes with the cleaner when the cleaner is deleted', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await upload(sub.id, 'photo', PNG, 'image/png')
    await upload(sub.id, 'w9', PDF, 'application/pdf', 'w9.pdf')
    expect(await prisma.subcontractorFile.count()).toBe(2)
    await prisma.subcontractor.delete({ where: { id: sub.id } })
    expect(await prisma.subcontractorFile.count()).toBe(0)
  })
})

describe('the W-9', () => {
  it('keeps its name and upload date and ticks "on file"; removing it clears all three and leaves the photo', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await upload(sub.id, 'photo', PNG, 'image/png')
    expect((await upload(sub.id, 'w9', PDF, 'application/pdf', 'W-9 "Maria".pdf')).status).toBe(200)

    const served = await read(sub.id, 'w9', false)
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('application/pdf')
    expect(served.headers.get('Content-Disposition')).toBe('inline; filename="W-9 Maria.pdf"')
    expect(Buffer.from(await served.arrayBuffer()).equals(PDF)).toBe(true)

    const onFile = (await profile(sub.id)).tax
    expect(onFile).toMatchObject({ w9OnFile: true, w9FileName: 'W-9 "Maria".pdf' })
    expect(Date.now() - Date.parse(onFile.w9UploadedAt!)).toBeLessThan(60_000)

    expect((await remove(sub.id, 'w9')).status).toBe(200)
    expect((await read(sub.id, 'w9')).status).toBe(404)
    expect((await profile(sub.id)).tax).toMatchObject({ w9OnFile: false, w9FileName: null, w9UploadedAt: null })
    expect((await read(sub.id, 'photo')).status).toBe(200)
  })

  it('removing the photo leaves the W-9', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await upload(sub.id, 'photo', PNG, 'image/png')
    await upload(sub.id, 'w9', PDF, 'application/pdf', 'w9.pdf')
    expect((await remove(sub.id, 'photo')).status).toBe(200)
    expect((await read(sub.id, 'photo')).status).toBe(404)
    expect((await read(sub.id, 'w9')).status).toBe(200)
    expect((await profile(sub.id)).tax.w9OnFile).toBe(true)
  })
})

describe('the photo on the cleaner profile', () => {
  it('is a URL that moves when the photo is replaced, not one fixed to when the cleaner was added', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    expect((await profile(sub.id)).cleaner).toMatchObject({ hasPhoto: false, photoUrl: null })

    await upload(sub.id, 'photo', PNG, 'image/png')
    const before = (await profile(sub.id)).cleaner
    expect(before.hasPhoto).toBe(true)
    expect(before.photoUrl).toMatch(new RegExp(`^/api/cleaners/${sub.id}/files\\?kind=photo&v=\\d+$`))

    await new Promise(r => setTimeout(r, 5))
    await upload(sub.id, 'photo', JPEG, 'image/jpeg')
    const after = (await profile(sub.id)).cleaner
    expect(after.since).toBe(before.since)
    expect(after.photoUrl).not.toBe(before.photoUrl)

    expect((await remove(sub.id, 'photo')).status).toBe(200)
    expect((await profile(sub.id)).cleaner).toMatchObject({ hasPhoto: false, photoUrl: null })
  })
})

describe('the everyday reads that load cleaners whole', () => {
  it('carry the cleaner without the photo or W-9 bytes', async () => {
    const { client, sub } = await seedWeeklyFlatRateClient()
    await upload(sub.id, 'photo', PNG, 'image/png')
    await upload(sub.id, 'w9', PDF, 'application/pdf', 'w9.pdf')

    // The shapes the app uses: findMany with no select, and include: { subcontractor: true }.
    const bare = await prisma.subcontractor.findMany()
    expect(bare.map(s => s.name)).toEqual(['Maria'])
    expect(bytesIn(bare)).toEqual([])
    const schedules = await prisma.schedule.findMany({ include: { subcontractor: true } })
    expect(schedules[0].subcontractor?.name).toBe('Maria')
    expect(bytesIn(schedules)).toEqual([])

    // And two routes that hand them to the browser: the cleaner list, and the
    // client profile (locations -> schedules -> subcontractor: true).
    const responses = [
      await getSubcontractors(),
      await getClient(new Request(`http://test/api/clients/${client.id}`), { params: { id: client.id } }),
    ]
    for (const res of responses) {
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain('"name":"Maria"')
      expect(text).not.toMatch(/"type":"Buffer"|photoData|w9Data/)
    }
  })
})

// ---------------------------------------------------------------------------
// The migration, run the way it is run on live.

const MIGRATION = 'prisma/migrations/20260929200000_subcontractor_files/migration.sql'
const FOLLOW_UP = 'prisma/follow-ups/drop_subcontractor_file_columns.sql'

/** The project's own Prisma CLI, on the test database (DATABASE_URL). */
function prismaCli(args: string[]) {
  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: process.cwd(), env: process.env, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

function execute(file: string) {
  const run = prismaCli(['db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'])
  if (run.status !== 0) throw new Error(`prisma db execute ${file} failed:\n${run.output}`)
}

/** The test database against the schema: empty when they match. */
function schemaDrift() {
  const run = prismaCli([
    'migrate', 'diff', '--from-url', process.env.DATABASE_URL!,
    '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code', '--script',
  ])
  if (run.status === 0) return ''
  if (run.status === 2) return run.output
  throw new Error(`prisma migrate diff failed:\n${run.output}`)
}

/** The columns live has today, and the code before this change wrote. */
const addOldColumns = () =>
  prisma.$executeRawUnsafe(`
    ALTER TABLE "subcontractors"
      ADD COLUMN IF NOT EXISTS "photoData" BYTEA,
      ADD COLUMN IF NOT EXISTS "photoMimeType" TEXT,
      ADD COLUMN IF NOT EXISTS "w9FileName" TEXT,
      ADD COLUMN IF NOT EXISTS "w9MimeType" TEXT,
      ADD COLUMN IF NOT EXISTS "w9Data" BYTEA,
      ADD COLUMN IF NOT EXISTS "w9UploadedAt" TIMESTAMP(3)`)

const dropOldColumns = () =>
  prisma.$executeRawUnsafe(`
    ALTER TABLE "subcontractors"
      DROP COLUMN IF EXISTS "photoData",
      DROP COLUMN IF EXISTS "photoMimeType",
      DROP COLUMN IF EXISTS "w9FileName",
      DROP COLUMN IF EXISTS "w9MimeType",
      DROP COLUMN IF EXISTS "w9Data",
      DROP COLUMN IF EXISTS "w9UploadedAt"`)

const oldColumnCount = async () =>
  (await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subcontractors'
      AND column_name IN ('photoData', 'photoMimeType', 'w9FileName', 'w9MimeType', 'w9Data', 'w9UploadedAt')`)[0].n

describe('moving the files already on live', () => {
  // Whatever happens, leave the database the shape the schema says.
  afterAll(async () => {
    await dropOldColumns()
    await prisma.$executeRawUnsafe(`DELETE FROM "subcontractor_files"`).catch(() => {})
    if (schemaDrift()) execute(MIGRATION)
  }, 120_000)

  it('builds exactly the table the schema describes, and runs again without complaint', async () => {
    await prisma.$executeRawUnsafe(`DROP TABLE "subcontractor_files"`)
    execute(MIGRATION)
    expect(schemaDrift()).toBe('')
    // With the old columns already gone, there is nothing to copy.
    execute(MIGRATION)
    expect(schemaDrift()).toBe('')
  }, 120_000)

  it('copies each photo and W-9 off the cleaner row, keeping the W-9 name and upload date', async () => {
    await addOldColumns()
    const both = await prisma.subcontractor.create({ data: { name: 'Both', w9OnFile: true } })
    const photoOnly = await prisma.subcontractor.create({ data: { name: 'Photo only' } })
    const nothing = await prisma.subcontractor.create({ data: { name: 'Nothing' } })
    const uploadedAt = new Date('2026-08-15T14:30:00.000Z')
    await prisma.$executeRaw`
      UPDATE "subcontractors" SET "photoData" = ${PNG}, "photoMimeType" = 'image/png',
        "w9Data" = ${PDF}, "w9MimeType" = 'application/pdf', "w9FileName" = 'W-9 Both.pdf', "w9UploadedAt" = ${uploadedAt}
      WHERE "id" = ${both.id}`
    // A type left behind without its bytes is not a file.
    await prisma.$executeRaw`
      UPDATE "subcontractors" SET "photoData" = ${JPEG}, "photoMimeType" = 'image/jpeg', "w9MimeType" = 'application/pdf'
      WHERE "id" = ${photoOnly.id}`

    execute(MIGRATION)

    const files = await prisma.subcontractorFile.findMany({ orderBy: [{ subcontractorId: 'asc' }, { kind: 'asc' }] })
    const of = (id: string, kind: string) => files.find(f => f.subcontractorId === id && f.kind === kind)
    expect(files).toHaveLength(3)
    expect(Buffer.from(of(both.id, 'photo')!.data).equals(PNG)).toBe(true)
    expect(of(both.id, 'photo')!.mimeType).toBe('image/png')
    expect(Buffer.from(of(both.id, 'w9')!.data).equals(PDF)).toBe(true)
    expect(of(both.id, 'w9')).toMatchObject({ mimeType: 'application/pdf', fileName: 'W-9 Both.pdf', updatedAt: uploadedAt })
    expect(Buffer.from(of(photoOnly.id, 'photo')!.data).equals(JPEG)).toBe(true)
    expect(of(photoOnly.id, 'w9')).toBeUndefined()
    expect(files.some(f => f.subcontractorId === nothing.id)).toBe(false)

    // And the profile and the file route see the moved files as before.
    const moved = await profile(both.id)
    expect(moved.cleaner.hasPhoto).toBe(true)
    expect(moved.tax).toMatchObject({ w9OnFile: true, w9FileName: 'W-9 Both.pdf', w9UploadedAt: uploadedAt.toISOString() })
    expect(Buffer.from(await (await read(both.id, 'w9')).arrayBuffer()).equals(PDF)).toBe(true)
  }, 120_000)

  it('run again, it never overwrites a file uploaded since', async () => {
    await addOldColumns()
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await prisma.$executeRaw`UPDATE "subcontractors" SET "photoData" = ${PNG}, "photoMimeType" = 'image/png' WHERE "id" = ${sub.id}`
    execute(MIGRATION)
    await upload(sub.id, 'photo', JPEG, 'image/jpeg')

    execute(MIGRATION)

    const photos = await prisma.subcontractorFile.findMany({ where: { subcontractorId: sub.id } })
    expect(photos).toHaveLength(1)
    expect(photos[0].mimeType).toBe('image/jpeg')
    expect(Buffer.from(photos[0].data).equals(JPEG)).toBe(true)
  }, 120_000)

  it('the follow-up drops the old columns and keeps the files, and refuses to run before the copy', async () => {
    await addOldColumns()
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await prisma.$executeRaw`UPDATE "subcontractors" SET "photoData" = ${PNG}, "photoMimeType" = 'image/png' WHERE "id" = ${sub.id}`

    // Without the new table the old columns are the only copy: refuse.
    await prisma.$executeRawUnsafe(`DROP TABLE "subcontractor_files"`)
    expect(() => execute(FOLLOW_UP)).toThrow(/subcontractor_files does not exist/)
    expect(await oldColumnCount()).toBe(6)
    expect(schemaDrift()).toContain('DROP COLUMN "photoData"')

    execute(MIGRATION)
    execute(FOLLOW_UP)
    expect(await oldColumnCount()).toBe(0)
    expect(schemaDrift()).toBe('')
    expect(Buffer.from(await (await read(sub.id, 'photo')).arrayBuffer()).equals(PNG)).toBe(true)
  }, 120_000)
})
