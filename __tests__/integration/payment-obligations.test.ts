import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import {
  POST as createPayment,
  DELETE as unmarkPaid,
} from '@/app/api/subcontractors/[id]/payments/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// Jobs are only payable from the start of the current month, so the fixtures
// are relative to today rather than pinned to a date that would stop being
// payable next month.
const now = new Date()
const YEAR = now.getUTCFullYear()
const MONTH = now.getUTCMonth()
const day = (d: number, monthOffset = 0) =>
  new Date(Date.UTC(YEAR, MONTH + monthOffset, d, 12, 0, 0))
const ymd = (d: Date) => d.toISOString().slice(0, 10)

const MONTHLY = 4500

/**
 * A flat-rate account: one schedule the cleaner is paid $4,500 a month for,
 * whatever number of cleans fall in the month. The monthly rate is carried on
 * every job, which is how the app stores it.
 */
async function seedFlatRateMonth(opts?: { days?: number[]; monthOffset?: number }) {
  const days = opts?.days ?? [2, 9, 16]
  const offset = opts?.monthOffset ?? 0
  const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: 'FLAT_RATE', cleanerPayType: 'FLAT_RATE' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Bigco HQ', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([1]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 9000,
      defaultSubcontractorRate: MONTHLY,
      clientPayType: 'FLAT_RATE',
      subcontractorPayType: 'FLAT_RATE',
      startDate: day(1, offset),
    },
  })
  const jobs = []
  for (const d of days) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: sub.id,
          scheduleId: schedule.id,
          date: day(d, offset),
          clientRate: 9000,
          subcontractorRate: MONTHLY,
          status: 'COMPLETED',
        },
      })
    )
  }
  return { sub, client, location, schedule, jobs }
}

/** A per-clean account: the cleaner is paid per visit. */
async function seedPerCleanJobs(subId: string, rates: number[]) {
  const client = await prisma.client.create({
    data: { name: 'Corner Cafe', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Cafe', address: '2 Side St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: subId,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([3]),
      timeType: 'SPECIFIC',
      startTime: '08:00',
      defaultClientRate: 130,
      defaultSubcontractorRate: rates[0],
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: day(1),
    },
  })
  const jobs = []
  for (let i = 0; i < rates.length; i++) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: subId,
          scheduleId: schedule.id,
          date: day(4 + i * 7),
          clientRate: 130,
          subcontractorRate: rates[i],
          status: 'COMPLETED',
        },
      })
    )
  }
  return { client, location, schedule, jobs }
}

const pay = (subId: string, jobIds: string[]) =>
  createPayment(
    new Request('http://test/pay', {
      method: 'POST',
      body: JSON.stringify({ jobIds, datePaid: ymd(new Date()), confirmNoInvoice: true }),
    }),
    { params: { id: subId } }
  )

const unpay = (subId: string, jobIds: string[]) =>
  unmarkPaid(
    new Request('http://test/pay', { method: 'DELETE', body: JSON.stringify({ jobIds }) }),
    { params: { id: subId } }
  )

const paidTotal = async (subId: string) =>
  (await prisma.subcontractorPayment.findMany({ where: { subcontractorId: subId } })).reduce(
    (sum, p) => sum + p.totalAmount,
    0
  )

const paidFlags = async (jobIds: string[]) => {
  const rows = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, subcontractorPaid: true },
  })
  return jobIds.map(id => rows.find(r => r.id === id)?.subcontractorPaid)
}

describe('paying a flat-rate month twice', () => {
  it('pays the monthly rate once when the whole month is selected', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    const res = await pay(sub.id, jobs.map(j => j.id))
    expect(res.status).toBe(201)
    expect(await paidTotal(sub.id)).toBe(MONTHLY)
  })

  it('refuses a second payment for a month already settled', async () => {
    // The reported defect: the monthly rate was added once per REQUEST. Paying
    // one clean, then another clean of the same month, recorded $4,500 twice
    // and paid the cleaner $9,000 for a $4,500 month.
    const { sub, jobs } = await seedFlatRateMonth()
    expect((await pay(sub.id, [jobs[0].id])).status).toBe(201)

    const second = await pay(sub.id, [jobs[1].id])
    expect(second.status).toBe(409)
    expect((await second.json()).code).toBe('OBLIGATION_ALREADY_PAID')
    expect(await paidTotal(sub.id)).toBe(MONTHLY)
  })

  it('names the account and month it already paid', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, [jobs[0].id])
    const body = await (await pay(sub.id, [jobs[1].id])).json()
    expect(body.error).toContain('Bigco Offices')
    expect(body.obligationKeys).toHaveLength(1)
  })

  it('writes no second payment record at all', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, [jobs[0].id])
    await pay(sub.id, [jobs[1].id])
    expect(await prisma.subcontractorPayment.count({ where: { subcontractorId: sub.id } })).toBe(1)
  })

  it('still pays a different month of the same account', async () => {
    // The guard is the schedule-MONTH, not the schedule. Next month is owed.
    const { sub, jobs, schedule, location } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))

    const nextMonth = await prisma.job.create({
      data: {
        locationId: location.id,
        subcontractorId: sub.id,
        scheduleId: schedule.id,
        date: day(7, 1),
        clientRate: 9000,
        subcontractorRate: MONTHLY,
        status: 'COMPLETED',
      },
    })
    expect((await pay(sub.id, [nextMonth.id])).status).toBe(201)
    expect(await paidTotal(sub.id)).toBe(MONTHLY * 2)
  })
})

describe('two payments racing for the same month', () => {
  it('lets exactly one through', async () => {
    // Both requests read the jobs as unpaid before either writes, so the
    // "only unpaid jobs" filter cannot see the conflict. The unique index can.
    const { sub, jobs } = await seedFlatRateMonth()

    const [a, b] = await Promise.all([pay(sub.id, [jobs[0].id]), pay(sub.id, [jobs[1].id])])

    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await paidTotal(sub.id)).toBe(MONTHLY)
    expect(await prisma.subcontractorPaymentCoverage.count()).toBe(1)
  })

  it('lets exactly one through when the same clean is submitted twice at once', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Solo' } })
    const { jobs } = await seedPerCleanJobs(sub.id, [65])

    const results = await Promise.all([pay(sub.id, [jobs[0].id]), pay(sub.id, [jobs[0].id])])
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(await paidTotal(sub.id)).toBe(65)
  })
})

describe('what a payment records', () => {
  it('lists every covered clean, not only the first', async () => {
    // Payment history counts line items to say "N cleans". A three-visit month
    // reported one, because only the first job got a line item.
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))

    const payment = await prisma.subcontractorPayment.findFirstOrThrow({
      where: { subcontractorId: sub.id },
      include: { lineItems: true },
    })
    expect(payment.lineItems).toHaveLength(3)
    expect(payment.lineItems.reduce((s, i) => s + i.amount, 0)).toBe(payment.totalAmount)
  })

  it('records the obligation it settled', async () => {
    const { sub, jobs, schedule } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))

    const coverage = await prisma.subcontractorPaymentCoverage.findMany()
    expect(coverage).toHaveLength(1)
    expect(coverage[0].kind).toBe('SCHEDULE_MONTH')
    expect(coverage[0].scheduleId).toBe(schedule.id)
    expect(coverage[0].amount).toBe(MONTHLY)
  })

  it('records one obligation per clean for per-clean work', async () => {
    const sub = await prisma.subcontractor.create({ data: { name: 'Solo' } })
    const { jobs } = await seedPerCleanJobs(sub.id, [65, 65, 70])
    await pay(sub.id, jobs.map(j => j.id))

    const coverage = await prisma.subcontractorPaymentCoverage.findMany()
    expect(coverage).toHaveLength(3)
    expect(coverage.every(c => c.kind === 'JOB')).toBe(true)
    expect(await paidTotal(sub.id)).toBe(200)
  })

  it('pays add-ons on top of a flat month, once each', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    await prisma.addOnService.create({
      data: {
        jobId: jobs[1].id,
        description: 'Carpet shampoo',
        clientRate: 200,
        subcontractorRate: 120,
      },
    })
    await pay(sub.id, jobs.map(j => j.id))
    expect(await paidTotal(sub.id)).toBe(MONTHLY + 120)
  })
})

describe('undoing a payment', () => {
  it('reverses the whole month when the LAST clean is unticked', async () => {
    // The reported defect: undo looked up line items by the clicked job. A flat
    // month had one line item, on the first job, so unticking any other clean
    // found nothing to undo, and the clean went unpaid while the payment stood.
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))

    const res = await unpay(sub.id, [jobs[2].id])
    expect(res.status).toBe(200)

    expect(await paidFlags(jobs.map(j => j.id))).toEqual([false, false, false])
    expect(await prisma.subcontractorPayment.count({ where: { subcontractorId: sub.id } })).toBe(0)
  })

  it('reverses the whole month when the FIRST clean is unticked', async () => {
    // The other half of the same defect: unticking the first clean took the
    // money back but left the other cleans marked paid.
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))
    await unpay(sub.id, [jobs[0].id])

    expect(await paidFlags(jobs.map(j => j.id))).toEqual([false, false, false])
    expect(await paidTotal(sub.id)).toBe(0)
  })

  it('leaves no clean both paid and unpaid', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))
    await unpay(sub.id, [jobs[1].id])

    const stillPaid = await prisma.job.count({
      where: { id: { in: jobs.map(j => j.id) }, subcontractorPaid: true },
    })
    expect(stillPaid).toBe(0)
    expect(await prisma.subcontractorPaymentLineItem.count()).toBe(0)
  })

  it('releases the month so it can be paid again', async () => {
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))
    await unpay(sub.id, [jobs[2].id])

    expect(await prisma.subcontractorPaymentCoverage.count()).toBe(0)
    const again = await pay(sub.id, jobs.map(j => j.id))
    expect(again.status).toBe(201)
    expect(await paidTotal(sub.id)).toBe(MONTHLY)
  })

  it('unticking one per-clean visit leaves the others paid', async () => {
    // Per-clean work is one obligation per visit, so undo is per visit.
    const sub = await prisma.subcontractor.create({ data: { name: 'Solo' } })
    const { jobs } = await seedPerCleanJobs(sub.id, [65, 65, 70])
    await pay(sub.id, jobs.map(j => j.id))

    await unpay(sub.id, [jobs[1].id])
    expect(await paidFlags(jobs.map(j => j.id))).toEqual([true, false, true])
    expect(await paidTotal(sub.id)).toBe(135)
  })

  it('does not touch another account paid in the same payment', async () => {
    const { sub, jobs: flatJobs } = await seedFlatRateMonth()
    const { jobs: cafeJobs } = await seedPerCleanJobs(sub.id, [65])
    await pay(sub.id, [...flatJobs.map(j => j.id), cafeJobs[0].id])
    expect(await paidTotal(sub.id)).toBe(MONTHLY + 65)

    await unpay(sub.id, [flatJobs[1].id])
    expect(await paidFlags([cafeJobs[0].id])).toEqual([true])
    expect(await paidTotal(sub.id)).toBe(65)
  })

  it('still reverses a payment written before obligations were recorded', async () => {
    // The payments already in production have no coverage rows. Their undo has
    // to keep working, by line item, the way it did before.
    const { sub, jobs } = await seedFlatRateMonth()
    await pay(sub.id, jobs.map(j => j.id))
    await prisma.subcontractorPaymentCoverage.deleteMany()

    const res = await unpay(sub.id, [jobs[0].id])
    expect(res.status).toBe(200)
    expect(await paidFlags([jobs[0].id])).toEqual([false])
  })
})
