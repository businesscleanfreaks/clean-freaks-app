/**
 * Map positions for locations, through the real route and database: an edited
 * address is looked up again, and existing locations get filled in once. The
 * lookup service itself is replaced here; lib/geocode.ts has its own tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
const lookup = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/geocode', () => ({ geocodeAddress: (address: string) => lookup.fn(address) }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { PUT as putLocation } from '@/app/api/locations/[id]/route'
import { fillMissingPositions } from '@/lib/location-positions'

beforeEach(async () => {
  await resetDb()
  lookup.fn.mockReset()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// Pretend lookup: knows full addresses (with a ZIP), not bare names.
const KNOWN: Record<string, { lat: number; lng: number }> = {
  '800 N Vermont Ave, Los Angeles, CA 90029': { lat: 34.084, lng: -118.291 },
  '2901 Sunset Blvd, Los Angeles, CA 90026': { lat: 34.089, lng: -118.273 },
}
const pretend = (address: string) => Promise.resolve(KNOWN[address] ?? null)

async function seed(address: string, at: { lat: number; lng: number } | null = null) {
  const client = await prisma.client.create({ data: { name: 'Map Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' } })
  return prisma.location.create({
    data: { clientId: client.id, name: 'HQ', address, latitude: at?.lat ?? null, longitude: at?.lng ?? null },
  })
}

const edit = (id: string, body: Record<string, unknown>) =>
  putLocation(new Request(`http://test/api/locations/${id}`, { method: 'PUT', body: JSON.stringify(body) }), { params: { id } })

describe('editing a location', () => {
  it('looks the new address up and moves the pin', async () => {
    lookup.fn.mockImplementation(pretend)
    const loc = await seed('2901 Sunset Blvd, Los Angeles, CA 90026', KNOWN['2901 Sunset Blvd, Los Angeles, CA 90026'])
    expect((await edit(loc.id, { address: '800 N Vermont Ave, Los Angeles, CA 90029' })).status).toBe(200)
    expect(await prisma.location.findUnique({ where: { id: loc.id } })).toMatchObject({ latitude: 34.084, longitude: -118.291 })
  })

  it('clears the old pin when the new address cannot be found', async () => {
    lookup.fn.mockImplementation(pretend)
    const loc = await seed('2901 Sunset Blvd, Los Angeles, CA 90026', KNOWN['2901 Sunset Blvd, Los Angeles, CA 90026'])
    await edit(loc.id, { address: 'Back office' })
    expect(await prisma.location.findUnique({ where: { id: loc.id } })).toMatchObject({ address: 'Back office', latitude: null, longitude: null })
  })

  it('places a location saved without a position when its address is saved again', async () => {
    lookup.fn.mockImplementation(pretend)
    const loc = await seed('800 N Vermont Ave, Los Angeles, CA 90029')
    await edit(loc.id, { address: '800 N Vermont Ave, Los Angeles, CA 90029' })
    expect(await prisma.location.findUnique({ where: { id: loc.id } })).toMatchObject({ latitude: 34.084 })
  })

  it('leaves a placed location alone when the address does not change, or is not part of the edit', async () => {
    lookup.fn.mockImplementation(pretend)
    const loc = await seed('2901 Sunset Blvd, Los Angeles, CA 90026', { lat: 1, lng: 2 })
    await edit(loc.id, { address: '2901 Sunset Blvd, Los Angeles, CA 90026' })
    await edit(loc.id, { name: 'Front desk' })
    expect(lookup.fn).not.toHaveBeenCalled()
    expect(await prisma.location.findUnique({ where: { id: loc.id } })).toMatchObject({ name: 'Front desk', latitude: 1, longitude: 2 })
  })
})

describe('filling in existing locations', () => {
  it('places the ones it can find, lists the rest, and never changes a position already there', async () => {
    const a = await seed('800 N Vermont Ave, Los Angeles, CA 90029')
    const b = await seed('Main office')
    const c = await seed('2901 Sunset Blvd, Los Angeles, CA 90026', { lat: 1, lng: 2 })

    const result = await fillMissingPositions(prisma, { apply: true, geocode: pretend })
    expect(result.placed.map(r => r.id)).toEqual([a.id])
    expect(result.notFound.map(r => [r.id, r.address])).toEqual([[b.id, 'Main office']])
    expect(await prisma.location.findUnique({ where: { id: a.id } })).toMatchObject({ latitude: 34.084, longitude: -118.291 })
    expect(await prisma.location.findUnique({ where: { id: c.id } })).toMatchObject({ latitude: 1, longitude: 2 })
  })

  it('saves nothing on a dry run', async () => {
    const a = await seed('800 N Vermont Ave, Los Angeles, CA 90029')
    const result = await fillMissingPositions(prisma, { apply: false, geocode: pretend })
    expect(result.placed).toHaveLength(1)
    expect(await prisma.location.findUnique({ where: { id: a.id } })).toMatchObject({ latitude: null, longitude: null })
  })
})
