import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/billing-settings', () => ({
  getBillingStartDate: async () => new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as getCandidates } from '@/app/api/invoices/candidates/route'
import { POST as changeGoingForward } from '@/app/api/schedules/[id]/change-going-forward/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// "Change going forward" only accepts dates from today on, so the months are
// placed relative to today: the service starts next month, and the price
// changes on the 15th of the month after.
const now = new Date()
const month = (offset: number) => {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 12))
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0, 12))
  return { first, last, start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) }
}
const BEFORE = month(1)
const CHANGE = month(2)
const AFTER = month(3)
const changeDay = new Date(Date.UTC(CHANGE.first.getUTCFullYear(), CHANGE.first.getUTCMonth(), 15, 12))

interface CandidateLine { sourceType: string; price: number; description: string }
interface Candidate { clientName: string; status: string; lineItems: CandidateLine[]; exceptions: Array<{ type: string; message: string }> }

async function candidatesFor(period: { start: string; end: string }): Promise<Candidate[]> {
  const res = await getCandidates(
    new Request(`http://test/api/invoices/candidates?start=${period.start}&end=${period.end}`) as never,
  )
  expect(res.status).toBe(200)
  return (await res.json()).candidates
}

async function seedAndChangePrice() {
  const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: { name: 'Flat Co', billingType: 'FLAT_RATE', cleanerPayType: 'PER_CLEAN', invoicingEmail: 'ap@flat.test' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Flat Site', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: cleaner.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([4]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 1000,
      defaultSubcontractorRate: 150,
      clientPayType: 'FLAT_RATE',
      subcontractorPayType: 'PER_CLEAN',
      startDate: BEFORE.first,
      cadenceAnchor: BEFORE.first,
    },
  })

  const res = await changeGoingForward(
    new Request(`http://test/api/schedules/${schedule.id}/change-going-forward`, {
      method: 'POST',
      body: JSON.stringify({
        locationId: location.id,
        subcontractorId: cleaner.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([4]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        startDate: changeDay.toISOString().slice(0, 10),
        defaultClientRate: 1200,
        defaultSubcontractorRate: 150,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
      }),
    }) as never,
    { params: { id: schedule.id } } as never,
  )
  expect(res.status).toBe(200)

  // The old interval ends the day before, stored as a date (noon UTC) in any
  // server zone. It was stored as local midnight, a day early east of UTC.
  const old = await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } })
  const dayBefore = new Date(changeDay.getTime() - 24 * 60 * 60 * 1000)
  expect(old.endDate?.toISOString()).toBe(dayBefore.toISOString())
  return { client }
}

const monthlyLines = (c: Candidate) => c.lineItems.filter(l => l.sourceType === 'FLAT_RATE')
/** Every monthly line the month would bill, across however many candidates. */
const monthlyPrices = (all: Candidate[]) => all.flatMap(c => monthlyLines(c).map(l => l.price))

describe('a flat monthly price changed partway through a month (A4)', () => {
  it('bills the month of the change once, at the new price, and flags it', async () => {
    await seedAndChangePrice()
    const all = await candidatesFor(CHANGE)

    // Was two candidates, each a full month: $1,000 and $1,200.
    expect(monthlyPrices(all)).toEqual([1200])
    expect(all).toHaveLength(1)
    const [candidate] = all
    expect(candidate.status).toBe('NEEDS_ATTENTION')
    const flag = candidate.exceptions.find(e => e.type === 'PRICE_CHANGE')
    expect(flag?.message).toMatch(/\$1,000 to \$1,200\. The whole month is billed at the new price/)
  })

  it('keeps the month before at the old price', async () => {
    await seedAndChangePrice()
    const all = await candidatesFor(BEFORE)
    expect(monthlyPrices(all)).toEqual([1000])
    const [candidate] = all
    expect(candidate.exceptions.some(e => e.type === 'PRICE_CHANGE')).toBe(false)
  })

  it('bills the month after at the new price, with nothing to review', async () => {
    await seedAndChangePrice()
    const all = await candidatesFor(AFTER)
    expect(monthlyPrices(all)).toEqual([1200])
    const [candidate] = all
    expect(candidate.exceptions.some(e => e.type === 'PRICE_CHANGE')).toBe(false)
  })
})
