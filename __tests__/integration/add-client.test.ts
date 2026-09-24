import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
// No map service in tests.
vi.mock('@/lib/geocode', () => ({ geocodeAddress: async () => ({ lat: 34.1, lng: -118.3 }) }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createClient } from '@/app/api/clients/create/route'
import { POST as createSchedule } from '@/app/api/schedules/route'

beforeEach(async () => {
  await resetDb()
  await prisma.prospect.deleteMany()
})

afterAll(async () => {
  await prisma.prospect.deleteMany()
  await prisma.$disconnect()
})

const post = (body: unknown) =>
  new Request('http://test/api/clients/create', { method: 'POST', body: JSON.stringify(body) })

const modal = {
  name: 'Bad Ladder',
  address: '1917 Hillhurst Ave, Los Angeles, CA 90027',
  contactName: 'Ian Movius',
  role: 'Property Manager',
  email: 'ian@badladder.com',
  phone: '310-555-0100',
  pays: 'invoice',
  separateBillingEmail: false,
  billingEmail: '',
}

describe('adding a client from the modal', () => {
  it('writes the client, its location and its contact together', async () => {
    const res = await createClient(post(modal))
    expect(res.status).toBe(201)
    const { id, locationId } = await res.json()

    const client = await prisma.client.findUniqueOrThrow({
      where: { id },
      include: { locations: true, contacts: true },
    })
    expect(client.invoicingEmail).toBe('ian@badladder.com')
    expect(client.billingDelivery).toBe('EMAIL')
    expect(client.locations).toHaveLength(1)
    expect(client.locations[0]).toMatchObject({ id: locationId, name: 'Bad Ladder', latitude: 34.1, longitude: -118.3 })
    expect(client.contacts).toHaveLength(1)
    expect(client.contacts[0]).toMatchObject({
      name: 'Ian Movius', billingRole: 'Property Manager', isPrimary: true, isBillingRecipient: true, billingOrder: 0,
    })
  })

  it('writes nothing when the input is refused', async () => {
    const res = await createClient(post({ ...modal, name: ' ', email: 'nope' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.problems.map((p: { field: string }) => p.field)).toEqual(['name', 'email'])
    expect(await prisma.client.count()).toBe(0)
  })

  it('writes nothing at all when part of the save fails', async () => {
    // Postgres rejects a null byte in text, so the location insert fails after
    // the client row has been written. The client must not survive it.
    const res = await createClient(post({ ...modal, address: 'Bad\u0000Address, Los Angeles, CA 90027' }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.client.count()).toBe(0)
    expect(await prisma.clientContact.count()).toBe(0)
  })

  it('marks the prospect won and links it', async () => {
    const prospect = await prisma.prospect.create({ data: { businessName: 'Bad Ladder' } })
    const res = await createClient(post({ ...modal, sourceProspectId: prospect.id }))
    const { id } = await res.json()
    const after = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } })
    expect(after).toMatchObject({ convertedClientId: id, status: 'WON', stage: 'WON' })
  })
})

describe("the first schedule sets a new client's pay types", () => {
  const scheduleBody = (locationId: string, payType: 'FLAT_RATE' | 'PER_CLEAN') => ({
    locationId,
    frequency: 'WEEKLY',
    daysOfWeek: JSON.stringify([4]),
    startDate: '2026-10-01',
    defaultClientRate: payType === 'FLAT_RATE' ? 2050 : 165,
    defaultSubcontractorRate: payType === 'FLAT_RATE' ? 1400 : 100,
    clientPayType: payType,
    subcontractorPayType: payType,
    timeType: 'SPECIFIC',
    startTime: '09:00',
  })
  const postSchedule = (body: unknown) =>
    new Request('http://test/api/schedules', { method: 'POST', body: JSON.stringify(body) })

  it('makes the client flat rate when its first schedule is, and a later one does not undo it', async () => {
    const { id, locationId } = await (await createClient(post(modal))).json()
    expect((await prisma.client.findUniqueOrThrow({ where: { id } })).billingType).toBe('PER_CLEAN')

    const first = await createSchedule(postSchedule(scheduleBody(locationId, 'FLAT_RATE')))
    expect(first.status).toBe(201)
    let client = await prisma.client.findUniqueOrThrow({ where: { id } })
    expect(client.billingType).toBe('FLAT_RATE')
    expect(client.cleanerPayType).toBe('FLAT_RATE')

    const second = await createSchedule(postSchedule(scheduleBody(locationId, 'PER_CLEAN')))
    expect(second.status).toBe(201)
    client = await prisma.client.findUniqueOrThrow({ where: { id } })
    expect(client.billingType).toBe('FLAT_RATE')
  })
})
