import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { ensureJobsForDateRange } from '@/lib/regenerate-schedule-jobs'
import { resetDb, seedWeeklyFlatRateClient } from './db-helpers'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const DAY = 24 * 60 * 60 * 1000

// The nightly cron reconciles the current month through ~3 months ahead.
const WINDOW = { startDate: utc(2026, 5, 1), endDate: utc(2026, 8, 31) }

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('nightly self-check (forward-window additive reconcile)', () => {
  it('materializes upcoming cleans across the whole window', async () => {
    const { schedule } = await seedWeeklyFlatRateClient()
    const summary = await ensureJobsForDateRange(WINDOW)
    expect(summary.createdCount).toBeGreaterThan(4) // multiple weeks across ~3 months
    expect(await prisma.job.count({ where: { scheduleId: schedule.id } })).toBe(summary.createdCount)
  })

  it('never deletes a future off-pattern extra clean (the old regenerate cron would have)', async () => {
    const { location, schedule, sub } = await seedWeeklyFlatRateClient()
    await ensureJobsForDateRange(WINDOW)

    const firstPattern = await prisma.job.findFirst({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    const offPatternDate = new Date(firstPattern!.date.getTime() + DAY) // +1 day → different weekday, off-pattern
    const extra = await prisma.job.create({
      data: {
        locationId: location.id,
        scheduleId: schedule.id,
        subcontractorId: sub.id,
        date: offPatternDate,
        clientRate: 150,
        subcontractorRate: 90,
        status: 'SCHEDULED',
      },
    })

    await ensureJobsForDateRange(WINDOW) // a nightly run

    expect(await prisma.job.findUnique({ where: { id: extra.id } })).not.toBeNull()
  })
})
