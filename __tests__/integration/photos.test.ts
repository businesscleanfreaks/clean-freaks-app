/**
 * Client, location and contact photos through the real route and database:
 * upload, serve, replace, remove, "Or use a location photo", "Also use as the
 * client photo", and the URLs the Clients list and the profile are given.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { DELETE as removePhoto, GET as getPhoto, POST as postPhoto } from '@/app/api/photos/[owner]/[id]/route'
import { GET as getClients } from '@/app/api/clients/data/route'
import { GET as getContacts } from '@/app/api/clients/[id]/contacts/route'

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

const ctx = (owner: string, id: string) => ({ params: { owner, id } })

function upload(owner: string, id: string, bytes: Buffer, type: string, extra: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], 'photo', { type }))
  for (const [key, value] of Object.entries(extra)) form.append(key, value)
  return postPhoto(new Request(`http://test/api/photos/${owner}/${id}`, { method: 'POST', body: form }), ctx(owner, id))
}

const copyFrom = (clientId: string, locationId: string) =>
  postPhoto(
    new Request(`http://test/api/photos/client/${clientId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromLocation: locationId }),
    }),
    ctx('client', clientId),
  )

const read = (owner: string, id: string) => getPhoto(new Request(`http://test/api/photos/${owner}/${id}?v=1`), ctx(owner, id))

async function seed(name = 'Photo Co') {
  const client = await prisma.client.create({ data: { name, billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' } })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'HQ', address: '1 Main St' } })
  const contact = await prisma.clientContact.create({ data: { clientId: client.id, name: 'Dana Reyes', isPrimary: true, billingRole: 'Owner' } })
  return { client, location, contact }
}

describe('uploading and serving a photo', () => {
  it('stores it and serves it back, behind a URL that changes when it is replaced', async () => {
    const { client } = await seed()
    const res = await upload('client', client.id, PNG, 'image/png')
    expect(res.status).toBe(200)
    const first = (await res.json()).url as string
    expect(first).toMatch(new RegExp(`^/api/photos/client/${client.id}\\?v=\\d+$`))

    const served = await read('client', client.id)
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('image/png')
    expect(served.headers.get('Cache-Control')).toContain('private')
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true)

    await new Promise(r => setTimeout(r, 5))
    const second = (await (await upload('client', client.id, JPEG, 'image/jpeg')).json()).url as string
    expect(second).not.toBe(first)
    expect((await read('client', client.id)).headers.get('Content-Type')).toBe('image/jpeg')
    expect(await prisma.photo.count()).toBe(1)
  })

  it('refuses a file that is not a picture, and owners that do not exist', async () => {
    const { client } = await seed()
    expect((await upload('client', client.id, Buffer.from('%PDF-1.4'), 'application/pdf')).status).toBe(400)
    expect((await upload('client', 'no-such-client', PNG, 'image/png')).status).toBe(404)
    expect((await upload('cleaner', client.id, PNG, 'image/png')).status).toBe(404)
    expect(await prisma.photo.count()).toBe(0)
  })

  it('removes a photo, and removing one that is not there is fine', async () => {
    const { contact } = await seed()
    await upload('contact', contact.id, PNG, 'image/png')
    const del = () => removePhoto(new Request(`http://test/api/photos/contact/${contact.id}`, { method: 'DELETE' }), ctx('contact', contact.id))
    expect((await del()).status).toBe(200)
    expect((await read('contact', contact.id)).status).toBe(404)
    expect((await del()).status).toBe(200)
  })

  it('goes with the client, location or contact when that is deleted', async () => {
    const { client, location, contact } = await seed()
    await upload('client', client.id, PNG, 'image/png')
    await upload('location', location.id, PNG, 'image/png')
    await upload('contact', contact.id, PNG, 'image/png')
    await prisma.clientContact.delete({ where: { id: contact.id } })
    expect(await prisma.photo.count()).toBe(2)
    await prisma.client.delete({ where: { id: client.id } })
    expect(await prisma.photo.count()).toBe(0)
  })
})

describe('sharing a photo between a location and its client', () => {
  it('"Also use as the client photo" sets both from one upload', async () => {
    const { client, location } = await seed()
    expect((await upload('location', location.id, PNG, 'image/png', { alsoClient: '1' })).status).toBe(200)
    const clientPhoto = await read('client', client.id)
    expect(clientPhoto.status).toBe(200)
    expect(Buffer.from(await clientPhoto.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('"Or use a location photo" copies it, and only from the client\'s own locations', async () => {
    const { client, location } = await seed()
    await upload('location', location.id, JPEG, 'image/jpeg')
    expect((await copyFrom(client.id, location.id)).status).toBe(200)
    expect((await read('client', client.id)).headers.get('Content-Type')).toBe('image/jpeg')

    const other = await seed('Someone Else')
    await upload('location', other.location.id, PNG, 'image/png')
    expect((await copyFrom(client.id, other.location.id)).status).toBe(404)
    expect((await read('client', client.id)).headers.get('Content-Type')).toBe('image/jpeg')
  })
})

describe('what the pages are given', () => {
  it('the Clients list has the client photo and the primary contact headshot as URLs, never the bytes', async () => {
    const { client, contact } = await seed()
    await upload('client', client.id, PNG, 'image/png')
    await upload('contact', contact.id, PNG, 'image/png')

    const res = await getClients()
    const text = await res.text()
    const row = (JSON.parse(text) as Array<{ id: string; listing: { photoUrl: string | null; contactPhotoUrl: string | null } }>)
      .find(c => c.id === client.id)!
    expect(row.listing.photoUrl).toMatch(`/api/photos/client/${client.id}?v=`)
    expect(row.listing.contactPhotoUrl).toMatch(`/api/photos/contact/${contact.id}?v=`)
    expect(text).not.toContain(PNG.toString('base64'))
  })

  it('a client without photos gets nulls, so the cards show initials', async () => {
    const { client } = await seed()
    const rows = await (await getClients()).json()
    expect(rows.find((c: { id: string }) => c.id === client.id).listing).toMatchObject({ photoUrl: null, contactPhotoUrl: null })
  })

  it('the contacts list has each headshot as a URL', async () => {
    const { client, contact } = await seed()
    await upload('contact', contact.id, PNG, 'image/png')
    const body = await (await getContacts(new Request(`http://test/api/clients/${client.id}/contacts`), { params: { id: client.id } })).json()
    expect(body.contacts[0].photoUrl).toMatch(`/api/photos/contact/${contact.id}?v=`)
    expect(body.contacts[0]).not.toHaveProperty('photo')
  })
})
