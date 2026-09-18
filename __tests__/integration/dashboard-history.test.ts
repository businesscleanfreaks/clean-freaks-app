import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
// The dashboard repairs schedule data on read; that is a separate concern and
// it would generate jobs into the month under test.
vi.mock('@/lib/operational-reconciliation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    ensureOperationalDataForDateRange: vi.fn(async () => undefined),
  }
})

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as clientOverview } from '@/app/api/dashboard/client-overview/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// A month safely in the past, so the route reads recorded work rather than
// projecting. Two months back avoids any month-boundary ambiguity.
const now = new Date()
const PAST = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1, 12, 0, 0))
const PAST_YEAR = PAST.getUTCFullYear()
const PAST_MONTH = PAST.getUTCMonth()
const pastDay = (d: number) => new Date(Date.UTC(PAST_YEAR, PAST_MONTH, d, 12, 0, 0))

const overview = async () => {
  const res = await clientOverview(
    new Request(`http://test/dash?year=${PAST_YEAR}&month=${PAST_MONTH}`) as never,
  )
  return { status: res.status, body: await res.json() }
}

interface OverviewRow {
  id: string
  name: string
  periodRevenue: number
  periodCleanerCost: number
  periodJobCount: number
}

const clientRow = (body: { clients: Array<OverviewRow | null> }, name: string) =>
  body.clients.find((c): c is OverviewRow => !!c && c.name === name)

async function makeClient(name: string, opts?: { active?: boolean }) {
  const client = await prisma.client.create({
    data: {
      name,
      billingType: 'PER_CLEAN',
      cleanerPayType: 'PER_CLEAN',
      isActive: opts?.active ?? true,
    },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: `${name} site`, address: '1 Main St' },
  })
  return { client, location }
}

async function makeSchedule(
  locationId: string,
  subId: string,
  opts?: { endDate?: Date; isActive?: boolean; startDate?: Date },
) {
  return prisma.schedule.create({
    data: {
      locationId,
      subcontractorId: subId,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([1]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 100,
      defaultSubcontractorRate: 65,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: opts?.startDate ?? pastDay(1),
      endDate: opts?.endDate ?? null,
      isActive: opts?.isActive ?? true,
    },
  })
}

const completedJob = (locationId: string, subId: string, scheduleId: string | null, day: number) =>
  prisma.job.create({
    data: {
      locationId,
      subcontractorId: subId,
      scheduleId,
      date: pastDay(day),
      clientRate: 100,
      subcontractorRate: 65,
      status: 'COMPLETED',
    },
  })

describe('a past month keeps the work that happened in it', () => {
  it('counts work done on a schedule that has since ended', async () => {
    // The reported defect: period figures were computed inside a loop over the
    // schedules current TODAY, so starting a new agreement zeroed out the
    // revenue of the month the old one worked.
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const { location } = await makeClient('Ended Agreement Co')

    const ended = await makeSchedule(location.id, sub.id, {
      endDate: pastDay(28),
      isActive: false,
    })
    await completedJob(location.id, sub.id, ended.id, 7)
    await completedJob(location.id, sub.id, ended.id, 14)

    // ...and a current agreement that started afterwards.
    await makeSchedule(location.id, sub.id, { startDate: new Date() })

    const { status, body } = await overview()
    expect(status).toBe(200)

    const row = clientRow(body, 'Ended Agreement Co')
    expect(row).toBeDefined()
    expect(row!.periodRevenue).toBe(200)
    expect(row!.periodJobCount).toBe(2)
  })

  it('counts a client whose only work was one-off', async () => {
    // This client returned null before its one-off jobs were ever considered.
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const { location } = await makeClient('One Off Only Co')
    await completedJob(location.id, sub.id, null, 9)

    const { body } = await overview()
    const row = clientRow(body, 'One Off Only Co')
    expect(row).toBeDefined()
    expect(row!.periodRevenue).toBe(100)
    expect(row!.periodJobCount).toBe(1)
  })

  it('counts a client that has since been deactivated', async () => {
    // Both queries filtered isActive, so deactivating an account erased its
    // history from every past month.
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const { location } = await makeClient('Gone Away Co', { active: false })
    const schedule = await makeSchedule(location.id, sub.id, { isActive: false })
    await completedJob(location.id, sub.id, schedule.id, 5)

    const { body } = await overview()
    const row = clientRow(body, 'Gone Away Co')
    expect(row).toBeDefined()
    expect(row!.periodRevenue).toBe(100)
  })

  it('adds one-off work to the same client as their recurring work', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const { location } = await makeClient('Mixed Co')
    const schedule = await makeSchedule(location.id, sub.id)
    await completedJob(location.id, sub.id, schedule.id, 6)
    await completedJob(location.id, sub.id, null, 20)

    const { body } = await overview()
    const row = clientRow(body, 'Mixed Co')
    expect(row!.periodRevenue).toBe(200)
    expect(row!.periodJobCount).toBe(2)
  })

  it('puts the same work in the month totals', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    const { location } = await makeClient('Ended Agreement Co')
    const ended = await makeSchedule(location.id, sub.id, { endDate: pastDay(28), isActive: false })
    await completedJob(location.id, sub.id, ended.id, 7)

    const { body } = await overview()
    expect(body.totals.periodRevenue).toBe(100)
    expect(body.totals.periodJobCount).toBe(1)
  })
})

describe('what the month says it is', () => {
  it('calls a past month actual', async () => {
    const { body } = await overview()
    expect(body.period.basis).toBe('actual')
  })

  it('calls the current month projected', async () => {
    // The screen labelled every month "actuals" and showed Net Profit under it,
    // including months where no completed job is read at all.
    const res = await clientOverview(
      new Request(`http://test/dash?year=${now.getUTCFullYear()}&month=${now.getUTCMonth()}`) as never,
    )
    const body = await res.json()
    expect(body.period.basis).toBe('projected')
  })
})
