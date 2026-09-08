import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * A weekly client that started months ago, with real history behind it.
 *
 * Dates are relative to today so the "past" is genuinely in the past whenever
 * this runs · the whole point is what happens to cleans before today.
 */
async function seedClientWithHistory() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 6, 12, 0, 0))

  const client = await prisma.client.create({
    data: { name: 'Long Standing Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'HQ', address: '1 Main St' },
  })
  const sub = await prisma.subcontractor.create({ data: { name: 'Maggie' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 200,
      defaultSubcontractorRate: 120,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: start,
      cadenceAnchor: start,
    },
  })

  // Insert the history directly. The regenerator deliberately does not
  // backfill the past, which is the behaviour under test.
  const pastDates: Date[] = []
  for (let d = new Date(start); d < new Date(); d.setUTCDate(d.getUTCDate() + 7)) {
    pastDates.push(new Date(d))
  }
  await prisma.job.createMany({
    data: pastDates.map(date => ({
      locationId: location.id,
      scheduleId: schedule.id,
      subcontractorId: sub.id,
      date,
      status: 'COMPLETED',
      clientRate: 200,
      subcontractorRate: 120,
      startTime: '09:00',
    })),
  })

  // And the future, as the schedule implies it.
  await regenerateJobsForSchedule(schedule.id, {})
  return { client, location, sub, schedule, start, pastDates }
}

describe('editing a schedule leaves history alone', () => {
  it('keeps a past unbilled clean, its note and its add-on', async () => {
    const { schedule, location } = await seedClientWithHistory()

    const pastJob = await prisma.job.findFirst({
      where: { scheduleId: schedule.id, date: { lt: new Date() } },
      orderBy: { date: 'asc' },
    })
    expect(pastJob).toBeTruthy()

    // The things an operator actually puts on a clean by hand.
    await prisma.job.update({
      where: { id: pastJob!.id },
      data: { notes: 'Client asked us to skip the third floor', clientRate: 275 },
    })
    const addOn = await prisma.addOnService.create({
      data: {
        jobId: pastJob!.id,
        description: 'Carpet shampoo',
        clientRate: 150,
        subcontractorRate: 90,
      },
    })

    // An ordinary edit: the operator changes the start time and saves.
    await prisma.schedule.update({ where: { id: schedule.id }, data: { startTime: '11:00' } })
    await regenerateJobsForSchedule(schedule.id, { rebuildDraftInvoicedJobs: true })

    // Before the fix the rebuild ran from the schedule's own start date, so
    // this clean was deleted and recreated from the pattern: the note, the
    // overridden rate and the add-on all went with it.
    const survivor = await prisma.job.findUnique({ where: { id: pastJob!.id } })
    expect(survivor).toBeTruthy()
    expect(survivor!.notes).toBe('Client asked us to skip the third floor')
    expect(survivor!.clientRate).toBe(275)

    const survivingAddOn = await prisma.addOnService.findUnique({ where: { id: addOn.id } })
    expect(survivingAddOn).toBeTruthy()
  })

  it('keeps a clean that was moved off the schedule pattern', async () => {
    const { schedule } = await seedClientWithHistory()

    const pastJob = await prisma.job.findFirst({
      where: { scheduleId: schedule.id, date: { lt: new Date() } },
      orderBy: { date: 'asc' },
    })
    // Moved by a day, as happens when a client reschedules.
    const movedTo = new Date(pastJob!.date.getTime() + 86400000)
    await prisma.job.update({ where: { id: pastJob!.id }, data: { date: movedTo } })

    await regenerateJobsForSchedule(schedule.id, { rebuildDraftInvoicedJobs: true })

    const survivor = await prisma.job.findUnique({ where: { id: pastJob!.id } })
    expect(survivor).toBeTruthy()
    expect(survivor!.date.toISOString()).toBe(movedTo.toISOString())
  })

  it('still applies the change to cleans from today onward', async () => {
    // The edit must not become a no-op: future cleans take the new cleaner.
    const { schedule, location } = await seedClientWithHistory()
    const newCleaner = await prisma.subcontractor.create({ data: { name: 'Ana' } })

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { subcontractorId: newCleaner.id },
    })
    await regenerateJobsForSchedule(schedule.id, { rebuildDraftInvoicedJobs: true })

    const future = await prisma.job.findMany({
      where: { scheduleId: schedule.id, date: { gte: new Date() } },
      take: 3,
      orderBy: { date: 'asc' },
    })
    expect(future.length).toBeGreaterThan(0)
    for (const job of future) expect(job.subcontractorId).toBe(newCleaner.id)

    // And the past keeps the cleaner who actually did the work.
    const past = await prisma.job.findFirst({
      where: { scheduleId: schedule.id, date: { lt: new Date() } },
      orderBy: { date: 'asc' },
    })
    expect(past!.subcontractorId).not.toBe(newCleaner.id)
    expect(location).toBeTruthy()
  })

  it('does not delete a draft invoice covering past work', async () => {
    const { schedule, client } = await seedClientWithHistory()

    const pastJob = await prisma.job.findFirst({
      where: { scheduleId: schedule.id, date: { lt: new Date() } },
      orderBy: { date: 'asc' },
    })
    const invoice = await prisma.invoice.create({
      data: {
        clientId: client.id,
        invoiceNumber: `INV-TEST-${Date.now()}`,
        status: 'DRAFT',
        totalAmount: 200,
        dateCreated: pastJob!.date,
        dateDue: pastJob!.date,
        lineItems: {
          create: [{ description: 'Cleaning', amount: 200, jobId: pastJob!.id }],
        },
      },
    })
    await prisma.job.update({ where: { id: pastJob!.id }, data: { invoiced: true } })

    await regenerateJobsForSchedule(schedule.id, { rebuildDraftInvoicedJobs: true })

    // The draft rebuild used to be scoped to the whole schedule, so an edit
    // deleted drafts for months it is no longer allowed to touch.
    const stillThere = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(stillThere).toBeTruthy()
  })
})
