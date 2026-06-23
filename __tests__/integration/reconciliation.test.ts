import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { ensureJobsForDateRange } from '@/lib/regenerate-schedule-jobs'
import { resetDb, seedWeeklyFlatRateClient } from './db-helpers'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const MONTH = { startDate: utc(2026, 5, 1), endDate: utc(2026, 5, 31) }

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('repair-before-show (real DB)', () => {
  it('generates a month of pattern cleans when none exist yet', async () => {
    const { schedule } = await seedWeeklyFlatRateClient()
    expect(await prisma.job.count({ where: { scheduleId: schedule.id } })).toBe(0)

    const summary = await ensureJobsForDateRange(MONTH)

    expect(summary.createdCount).toBeGreaterThan(0)
    expect(await prisma.job.count({ where: { scheduleId: schedule.id } })).toBe(summary.createdCount)
  })

  it('is idempotent — a second reconcile creates nothing new', async () => {
    await seedWeeklyFlatRateClient()
    await ensureJobsForDateRange(MONTH)
    const second = await ensureJobsForDateRange(MONTH)
    expect(second.createdCount).toBe(0)
  })
})

describe('reconciliation is additive — extra cleans are never deleted (the fix)', () => {
  it('an off-pattern, uninvoiced extra clean survives a reconcile', async () => {
    const { location, schedule, sub } = await seedWeeklyFlatRateClient()
    await ensureJobsForDateRange(MONTH) // generate the pattern cleans

    // A legitimately added EXTRA clean: off-pattern weekday, linked to the
    // schedule (how a flat-rate extra is stored), still SCHEDULED + uninvoiced.
    const extra = await prisma.job.create({
      data: {
        locationId: location.id,
        scheduleId: schedule.id,
        subcontractorId: sub.id,
        date: utc(2026, 5, 6),
        clientRate: 150,
        subcontractorRate: 90,
        status: 'SCHEDULED',
      },
    })

    // A dashboard / invoice / payables read would reconcile again here.
    await ensureJobsForDateRange(MONTH)

    const stillThere = await prisma.job.findUnique({ where: { id: extra.id } })
    expect(stillThere).not.toBeNull()
  })
})

describe('reconciliation protects finalized history', () => {
  it('never duplicates or removes an invoiced clean', async () => {
    const { client, location, schedule, sub } = await seedWeeklyFlatRateClient()
    await ensureJobsForDateRange(MONTH)

    // Pick one generated clean, attach it to a SENT invoice, mark it invoiced.
    const job = await prisma.job.findFirst({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    expect(job).not.toBeNull()
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber: 'INV-TEST-1', clientId: client.id, totalAmount: 400, status: 'SENT' },
    })
    await prisma.invoiceLineItem.create({
      data: { invoiceId: invoice.id, jobId: job!.id, description: 'Monthly Cleaning', amount: 400 },
    })
    await prisma.job.update({ where: { id: job!.id }, data: { invoiced: true } })

    const before = await prisma.job.count({ where: { scheduleId: schedule.id } })
    await ensureJobsForDateRange(MONTH)
    const after = await prisma.job.count({ where: { scheduleId: schedule.id } })

    expect(after).toBe(before) // no duplicate created for the invoiced date
    expect(await prisma.job.findUnique({ where: { id: job!.id } })).not.toBeNull() // not removed
  })
})
