import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// The calendar/payables/dashboard endpoints require a logged-in user (they read
// the auth cookie). In tests there's no request context, so stub requireAuth.
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as calendarGET } from '@/app/api/calendar/data/route'
import { GET as candidatesGET } from '@/app/api/invoices/candidates/route'

const pad = (n: number) => String(n).padStart(2, '0')

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// Seed a PER_CLEAN weekly client whose cleans fall in the CURRENT month (the
// calendar endpoint always loads "today's" month). No jobs are created yet —
// repair-before-show must materialize them on first read.
async function seedPerCleanCurrentMonth() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  const start = new Date(Date.UTC(y, m, 2, 12, 0, 0)) // 2nd of the month, interior

  const client = await prisma.client.create({
    data: { name: 'PerClean Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Site', address: '2 Rd' },
  })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam' } })
  await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '10:00',
      defaultClientRate: 120,
      defaultSubcontractorRate: 80,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: start,
    },
  })

  return { client, y, m }
}

describe('cross-screen agreement for an unopened month', () => {
  it('calendar and the invoice candidate materialize and reflect the SAME cleans', async () => {
    const { client, y, m } = await seedPerCleanCurrentMonth()
    expect(await prisma.job.count()).toBe(0) // nothing generated yet

    const monthPrefix = `${y}-${pad(m + 1)}`
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

    // Invoice review queue for the current month (reconciles, then bills).
    const candRes = await candidatesGET(
      new Request(`http://test/api/invoices/candidates?start=${monthPrefix}-01&end=${monthPrefix}-${pad(lastDay)}`),
    )
    const candJson = await candRes.json()
    const candidate = candJson.candidates.find((c: { clientId: string }) => c.clientId === client.id)
    expect(candidate).toBeTruthy()

    // Calendar for the current month (also reconciles on read).
    const calRes = await calendarGET()
    const calJson = await calRes.json()
    const calInMonth = calJson.jobs.filter(
      (j: { date: string; location: { client: { id: string } } }) =>
        j.location.client.id === client.id && j.date.slice(0, 7) === monthPrefix,
    )

    // The DB now holds the materialized cleans for the client this month.
    const dbCount = await prisma.job.count({
      where: { location: { clientId: client.id }, date: { gte: new Date(Date.UTC(y, m, 1)), lte: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59)) } },
    })

    // All three views agree on the same non-empty set of cleans.
    expect(dbCount).toBeGreaterThan(0)
    expect(calInMonth.length).toBe(dbCount)
    expect(candidate.jobIds.length).toBe(dbCount)
    expect(candidate.total).toBe(dbCount * 120)
  })
})
