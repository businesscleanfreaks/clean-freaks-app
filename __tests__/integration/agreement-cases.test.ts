import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Calendar/payables endpoints require a logged-in user; stub it for tests.
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { GET as calendarGET } from '@/app/api/calendar/data/route'
import { GET as candidatesGET } from '@/app/api/invoices/candidates/route'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => d.toISOString().slice(0, 10)

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// Seed a PER_CLEAN weekly client whose cleans fall in the CURRENT month (the
// calendar endpoint always loads "today's" month).
async function seedPerCleanCurrentMonth() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 2, 12, 0, 0))
  const client = await prisma.client.create({ data: { name: 'PerClean Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' } })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '2 Rd' } })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id, subcontractorId: sub.id, frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]), timeType: 'SPECIFIC', startTime: '10:00',
      defaultClientRate: 120, defaultSubcontractorRate: 80, clientPayType: 'PER_CLEAN', subcontractorPayType: 'PER_CLEAN',
      startDate: start,
    },
  })
  return { client, location, schedule, y, m }
}

async function getCandidate(clientId: string, y: number, m: number) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const res = await candidatesGET(new Request(`http://test/api/invoices/candidates?start=${y}-${pad(m + 1)}-01&end=${y}-${pad(m + 1)}-${pad(last)}`))
  const json = await res.json()
  return json.candidates.find((c: { clientId: string }) => c.clientId === clientId)
}

async function getCalendarInMonth(clientId: string, y: number, m: number) {
  const res = await calendarGET()
  const json = await res.json()
  const prefix = `${y}-${pad(m + 1)}`
  return (json.jobs as Array<{ id: string; date: string; status: string; location: { client: { id: string } } }>).filter(
    (j) => j.location.client.id === clientId && j.date.slice(0, 7) === prefix,
  )
}

describe('calendar ↔ invoice agreement — messier cases', () => {
  it('a one-off clean appears on BOTH the calendar and the invoice', async () => {
    const { client, location, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m) // reconcile + generate recurring cleans

    const oneOffDate = new Date(Date.UTC(y, m, 14, 12, 0, 0))
    const oneOff = await prisma.job.create({
      data: { locationId: location.id, scheduleId: null, date: oneOffDate, clientRate: 200, subcontractorRate: 0, status: 'SCHEDULED' },
    })

    const candidate = await getCandidate(client.id, y, m)
    const calInMonth = await getCalendarInMonth(client.id, y, m)

    expect(candidate.jobIds).toContain(oneOff.id) // billed
    expect(calInMonth.some((j) => j.id === oneOff.id)).toBe(true) // on the calendar
    expect(candidate.jobIds.length).toBe(calInMonth.filter((j) => j.status !== 'CANCELLED').length)
  })

  it('a cancelled clean drops off the invoice but stays visible on the calendar', async () => {
    const { client, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m)
    const jobs = await prisma.job.findMany({ where: { location: { clientId: client.id } }, orderBy: { date: 'asc' } })
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED' } })

    const candidate = await getCandidate(client.id, y, m)
    const calInMonth = await getCalendarInMonth(client.id, y, m)

    expect(candidate.jobIds).not.toContain(jobs[0].id) // not billed
    expect(calInMonth.some((j) => j.id === jobs[0].id)).toBe(true) // still on the calendar
    expect(candidate.jobIds.length).toBe(calInMonth.filter((j) => j.status !== 'CANCELLED').length)
  })

  it('after a weekly→bi-weekly change, calendar and invoice still agree on the same cleans', async () => {
    const { client, schedule, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m)

    const monthStart = new Date(Date.UTC(y, m, 1))
    const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59))
    const inMonthCount = () =>
      prisma.job.count({ where: { scheduleId: schedule.id, status: { not: 'CANCELLED' }, date: { gte: monthStart, lte: monthEnd } } })
    const before = await inMonthCount()

    await prisma.schedule.update({ where: { id: schedule.id }, data: { frequency: 'BI_WEEKLY' } })
    await regenerateJobsForSchedule(schedule.id, { effectiveDate: schedule.startDate, rebuildDraftInvoicedJobs: true })

    const candidate = await getCandidate(client.id, y, m)
    const calInMonth = await getCalendarInMonth(client.id, y, m)
    const after = await inMonthCount()

    expect(after).toBeLessThanOrEqual(before) // bi-weekly never has MORE cleans than weekly in the same month
    expect(candidate.jobIds.length).toBeGreaterThan(0)
    expect(candidate.jobIds.length).toBe(calInMonth.filter((j) => j.status !== 'CANCELLED').length) // no disagreement
  })
})
