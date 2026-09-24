import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as getRecipients, PUT as putRecipients } from '@/app/api/clients/[id]/billing-recipients/route'
import { POST as addContact } from '@/app/api/clients/[id]/contacts/route'
import { PATCH as editContact, DELETE as removeContact } from '@/app/api/clients/[id]/contacts/[contactId]/route'
import { GET as getHistory } from '@/app/api/clients/[id]/history/route'
import { GET as getProfile } from '@/app/api/clients/[id]/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const json = (body: unknown, method = 'POST') => new Request('http://test/x', { method, body: JSON.stringify(body) })

async function seedClient(name = 'Flat Co') {
  return prisma.client.create({
    data: {
      name,
      billingType: 'FLAT_RATE',
      invoicingEmail: 'naz@flat.test',
      invoicingContactName: 'Naz',
      invoicingCcEmail: 'books@flat.test',
      contacts: {
        create: [
          { name: 'Naz Habib', email: 'naz@flat.test', role: 'COMMUNICATION', isPrimary: true },
          { name: 'Amber Pineda', email: 'amber@flat.test', role: 'GENERAL' },
        ],
      },
    },
    include: { contacts: true },
  })
}

describe('who invoices go to', () => {
  it('shows the addresses sending uses, named from contacts', async () => {
    const client = await seedClient()
    const res = await getRecipients(new Request('http://test/x'), { params: { id: client.id } })
    const body = await res.json()
    expect(body.recipients.map((r: { email: string; tag: string; name: string | null }) => [r.email, r.tag, r.name])).toEqual([
      ['naz@flat.test', 'TO', 'Naz Habib'],
      ['books@flat.test', 'CC', null],
    ])
    expect(body.available.map((c: { name: string }) => c.name)).toEqual(['Amber Pineda'])
  })

  it('saving the card rewrites the fields sending reads, and mirrors the contacts', async () => {
    const client = await seedClient()
    const amber = client.contacts.find(c => c.name === 'Amber Pineda')!
    const res = await putRecipients(
      json({ recipients: [{ email: 'amber@flat.test', contactId: amber.id }, { email: 'naz@flat.test' }] }, 'PUT'),
      { params: { id: client.id } },
    )
    expect(res.status).toBe(200)
    const after = await prisma.client.findUniqueOrThrow({ where: { id: client.id }, include: { contacts: true } })
    expect(after).toMatchObject({ invoicingEmail: 'amber@flat.test', invoicingContactName: 'Amber Pineda', invoicingCcEmail: 'naz@flat.test' })
    const flags = Object.fromEntries(after.contacts.map(c => [c.name, [c.isBillingRecipient, c.billingOrder]]))
    expect(flags).toEqual({ 'Amber Pineda': [true, 0], 'Naz Habib': [true, 1] })
  })

  it('refuses an empty list, and another client\'s contact', async () => {
    const client = await seedClient()
    const other = await seedClient('Other Co')
    const empty = await putRecipients(json({ recipients: [] }, 'PUT'), { params: { id: client.id } })
    expect(empty.status).toBe(400)
    const foreign = await putRecipients(
      json({ recipients: [{ email: 'x@y.test', contactId: other.contacts[0].id }] }, 'PUT'),
      { params: { id: client.id } },
    )
    expect(foreign.status).toBe(400)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).invoicingEmail).toBe('naz@flat.test')
  })
})

describe('contacts', () => {
  it('keeps the job title and one primary contact per client', async () => {
    const client = await seedClient()
    const res = await addContact(json({ name: 'Ian', billingRole: 'Property Manager', isPrimary: true, role: 'GENERAL' }), { params: { id: client.id } })
    expect(res.status).toBe(200)
    const contacts = await prisma.clientContact.findMany({ where: { clientId: client.id } })
    expect(contacts.filter(c => c.isPrimary).map(c => c.name)).toEqual(['Ian'])
    expect(contacts.find(c => c.name === 'Ian')?.billingRole).toBe('Property Manager')
  })

  it('will not edit or delete another client\'s contact through this client', async () => {
    const client = await seedClient()
    const other = await seedClient('Other Co')
    const target = other.contacts[0]
    const edit = await editContact(json({ name: 'Hijacked' }, 'PATCH'), { params: { id: client.id, contactId: target.id } })
    expect(edit.status).toBe(404)
    const del = await removeContact(new Request('http://test/x', { method: 'DELETE' }), { params: { id: client.id, contactId: target.id } })
    expect(del.status).toBe(404)
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: target.id } })).name).toBe('Naz Habib')
  })
})

describe('the profile reads', () => {
  it('carries the same status facts the clients list uses', async () => {
    const client = await seedClient()
    const res = await getProfile(new Request('http://test/x'), { params: { id: client.id } })
    const body = await res.json()
    expect(body.listing.facts).toMatchObject({ isActive: true, hasRecurringSchedule: false, hasAnyVisits: false })
  })

  it('builds history months from the cleans on file', async () => {
    const client = await seedClient()
    const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '1 Main St' } })
    await prisma.job.create({
      data: { locationId: location.id, date: new Date(Date.UTC(2026, 4, 12, 12)), clientRate: 250, subcontractorRate: 120, status: 'COMPLETED' },
    })
    const res = await getHistory(new Request('http://test/x'), { params: { id: client.id } })
    const { months } = await res.json()
    const may = months.find((m: { key: string }) => m.key === '2026-05')
    expect(may.events[0]).toMatchObject({ tag: 'EXTRA', title: 'One-time clean completed' })
  })
})
