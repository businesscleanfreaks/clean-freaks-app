import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { ensureOperationalDataForDateRange } from '@/lib/operational-reconciliation'
import { invalidateReconciliationCache } from '@/lib/operational-reconciliation'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))

/**
 * One scheduled account, and a clean on it that is missing its start time ·
 * which is the only thing that made a job eligible for "repair".
 */
async function seed(jobOverrides: Record<string, unknown> = {}) {
  const scheduleCleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const standIn = await prisma.subcontractor.create({ data: { name: 'Ana' } })
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Bigco HQ', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: scheduleCleaner.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([day(7).getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 100,
      defaultSubcontractorRate: 65,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: day(1),
    },
  })
  // A one-off arrangement for this visit: a different cleaner, agreed rates,
  // and no start time recorded.
  const job = await prisma.job.create({
    data: {
      locationId: location.id,
      subcontractorId: standIn.id,
      scheduleId: schedule.id,
      date: day(7),
      startTime: null,
      clientRate: 250,
      subcontractorRate: 150,
      status: 'SCHEDULED',
      ...jobOverrides,
    },
  })
  return { scheduleCleaner, standIn, schedule, job }
}

/** What a calendar, invoice, dashboard or payables page load does. */
const readAPage = async () => {
  invalidateReconciliationCache()
  await ensureOperationalDataForDateRange({
    startDate: day(1),
    endDate: day(28),
    surface: 'calendar',
  })
}

const reload = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } })

describe('opening a page does not rewrite what people agreed', () => {
  it('keeps the rates agreed for one clean', async () => {
    // The reported defect: a job with no start time had its cleaner and BOTH
    // rates reset to the schedule defaults, on every calendar, invoice,
    // dashboard or payables read. Looking at the calendar undid the agreement.
    const { job } = await seed()
    await readAPage()

    const after = await reload(job.id)
    expect(after.clientRate).toBe(250)
    expect(after.subcontractorRate).toBe(150)
  })

  it('keeps the cleaner who is actually doing it', async () => {
    const { job, standIn } = await seed()
    await readAPage()

    expect((await reload(job.id)).subcontractorId).toBe(standIn.id)
  })

  it('still fills in the missing time, which is the point of the repair', async () => {
    const { job } = await seed()
    await readAPage()

    expect((await reload(job.id)).startTime).toBe('09:00')
  })
})

describe('work that money depends on is never touched', () => {
  it('leaves a clean the cleaner has been paid for alone', async () => {
    // Every route that changes a paid job refuses to. A read path must not do
    // what the write path forbids.
    const { job } = await seed({ subcontractorPaid: true })
    await readAPage()

    const after = await reload(job.id)
    expect(after.clientRate).toBe(250)
    expect(after.startTime).toBeNull()
  })

  it('leaves a cancelled clean alone · it is a record, not a plan', async () => {
    const { job } = await seed({ status: 'CANCELLED' })
    await readAPage()

    const after = await reload(job.id)
    expect(after.startTime).toBeNull()
    expect(after.status).toBe('CANCELLED')
  })

  it('leaves a vendor-paid clean alone', async () => {
    const { job } = await seed({ vendorPaid: true })
    await readAPage()

    expect((await reload(job.id)).startTime).toBeNull()
  })
})

describe('reading the same page repeatedly', () => {
  it('changes nothing after the first repair', async () => {
    const { job } = await seed()
    await readAPage()
    const afterFirst = await reload(job.id)

    await readAPage()
    await readAPage()
    const afterThird = await reload(job.id)

    expect(afterThird.clientRate).toBe(afterFirst.clientRate)
    expect(afterThird.subcontractorId).toBe(afterFirst.subcontractorId)
    expect(afterThird.startTime).toBe(afterFirst.startTime)
  })
})
