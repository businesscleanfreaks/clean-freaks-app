import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createPayment } from '@/app/api/subcontractors/[id]/payments/route'
import { DELETE as deleteJob } from '@/app/api/jobs/[id]/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// Jobs are only payable from the start of the current month.
const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** One cleaner, one per-clean account, three cleans. */
async function seed() {
  const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: { name: 'Corner Cafe', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Cafe', address: '2 Side St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([3]),
      timeType: 'SPECIFIC',
      startTime: '08:00',
      defaultClientRate: 130,
      defaultSubcontractorRate: 65,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: day(1),
    },
  })
  const jobs = []
  for (let i = 0; i < 3; i++) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: sub.id,
          scheduleId: schedule.id,
          date: day(4 + i * 7),
          clientRate: 130,
          subcontractorRate: 65,
          status: 'COMPLETED',
        },
      })
    )
  }
  return { sub, client, location, schedule, jobs }
}

const pay = (subId: string, jobIds: string[]) =>
  createPayment(
    new Request('http://test/pay', {
      method: 'POST',
      body: JSON.stringify({ jobIds, datePaid: ymd(new Date()), confirmNoInvoice: true }),
    }),
    { params: { id: subId } }
  )

const removeJob = (jobId: string) =>
  deleteJob(new Request('http://test/job', { method: 'DELETE' }), { params: { id: jobId } })

describe('deleting a clean that has been paid', () => {
  it('is refused, the way a vendor-paid clean already was', async () => {
    // Vendor-paid cleans were guarded and cleaner-paid ones were not, so this
    // went through silently and took the payment record with it.
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])

    const res = await removeJob(jobs[0].id)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('paid to a cleaner')
  })

  it('leaves the clean and the payment where they were', async () => {
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])
    await removeJob(jobs[0].id)

    expect(await prisma.job.count({ where: { id: jobs[0].id } })).toBe(1)
    expect(await prisma.subcontractorPaymentLineItem.count()).toBe(1)
  })

  it('still deletes a clean nobody has been paid for', async () => {
    // The guard must not block ordinary housekeeping.
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])

    expect((await removeJob(jobs[2].id)).status).toBe(200)
    expect(await prisma.job.count({ where: { id: jobs[2].id } })).toBe(0)
  })
})

describe('when a paid clean is deleted anyway', () => {
  // Jobs are also deleted by code paths that never reach the route guard, so
  // the database has to hold the line as well.
  it('keeps the payment and its money', async () => {
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])

    await prisma.job.delete({ where: { id: jobs[0].id } })

    const payments = await prisma.subcontractorPayment.findMany({ include: { lineItems: true } })
    expect(payments).toHaveLength(1)
    expect(payments[0].totalAmount).toBe(65)
    expect(payments[0].lineItems).toHaveLength(1)
  })

  it('keeps the line readable without the clean', async () => {
    // The reported defect: the line cascaded away, leaving a payment holding
    // money with no record of what it bought.
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])
    await prisma.job.delete({ where: { id: jobs[0].id } })

    const [line] = await prisma.subcontractorPaymentLineItem.findMany()
    expect(line.jobId).toBeNull()
    expect(line.description).toContain('Corner Cafe')
    expect(line.serviceDate).not.toBeNull()
    expect(line.amount).toBe(65)
  })

  it('keeps the count the payment history shows', async () => {
    // Payment history counts line items to say "N cleans". A cascade silently
    // turned a three-clean payment into a one-clean payment.
    const { sub, jobs } = await seed()
    await pay(sub.id, jobs.map(j => j.id))
    await prisma.job.delete({ where: { id: jobs[1].id } })

    const payment = await prisma.subcontractorPayment.findFirstOrThrow({
      include: { _count: { select: { lineItems: true } } },
    })
    expect(payment._count.lineItems).toBe(3)
  })

  it('does not release the obligation, so the work cannot be paid twice', async () => {
    const { sub, jobs } = await seed()
    await pay(sub.id, [jobs[0].id])
    await prisma.job.delete({ where: { id: jobs[0].id } })

    expect(await prisma.subcontractorPaymentCoverage.count()).toBe(1)
  })
})

describe('a flat month whose cleans are deleted', () => {
  async function seedFlatMonth() {
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
        defaultSubcontractorRate: 4500,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'FLAT_RATE',
        startDate: day(1),
      },
    })
    const jobs = []
    for (const d of [2, 9, 16]) {
      jobs.push(
        await prisma.job.create({
          data: {
            locationId: location.id,
            subcontractorId: sub.id,
            scheduleId: schedule.id,
            date: day(d),
            clientRate: 9000,
            subcontractorRate: 4500,
            status: 'COMPLETED',
          },
        })
      )
    }
    return { sub, jobs }
  }

  it('can still be undone through a clean that survived', async () => {
    // Undo matches a line to its obligation. It used to read the job's date and
    // schedule, which a deleted clean no longer has; the line's own snapshot
    // does, so the month is still reversible.
    const { sub, jobs } = await seedFlatMonth()
    await pay(sub.id, jobs.map(j => j.id))
    await prisma.job.delete({ where: { id: jobs[0].id } })

    const { DELETE: unmarkPaid } = await import('@/app/api/subcontractors/[id]/payments/route')
    const res = await unmarkPaid(
      new Request('http://test/pay', {
        method: 'DELETE',
        body: JSON.stringify({ jobIds: [jobs[2].id] }),
      }),
      { params: { id: sub.id } }
    )
    expect(res.status).toBe(200)

    const remaining = await prisma.job.findMany({
      where: { id: { in: [jobs[1].id, jobs[2].id] } },
      select: { subcontractorPaid: true },
    })
    expect(remaining.map(r => r.subcontractorPaid)).toEqual([false, false])
    expect(await prisma.subcontractorPayment.count()).toBe(0)
    expect(await prisma.subcontractorPaymentCoverage.count()).toBe(0)
  })
})
