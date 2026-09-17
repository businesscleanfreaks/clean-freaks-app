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

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Two cleaners. Maria owns the schedule; Ana performs one add-on on Maria's
 * clean, which is owed to Ana whoever owns the account ("Payout-B").
 */
async function seed() {
  const maria = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const ana = await prisma.subcontractor.create({ data: { name: 'Ana' } })
  const client = await prisma.client.create({
    data: { name: 'Corner Cafe', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Cafe', address: '2 Side St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: maria.id,
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
  for (let i = 0; i < 2; i++) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: ana.id,
          scheduleId: schedule.id,
          date: day(4 + i * 7),
          clientRate: 130,
          subcontractorRate: 65,
          status: 'COMPLETED',
        },
      })
    )
  }
  // Ana's own add-on, performed on a clean of Maria's account.
  const mariaJob = await prisma.job.create({
    data: {
      locationId: location.id,
      subcontractorId: maria.id,
      scheduleId: schedule.id,
      date: day(18),
      clientRate: 130,
      subcontractorRate: 65,
      status: 'COMPLETED',
    },
  })
  const addOn = await prisma.addOnService.create({
    data: {
      jobId: mariaJob.id,
      description: 'Carpet shampoo',
      clientRate: 200,
      subcontractorRate: 120,
      subcontractorId: ana.id,
    },
  })
  return { maria, ana, client, jobs, addOn }
}

const pay = (subId: string, body: Record<string, unknown>) =>
  createPayment(
    new Request('http://test/pay', {
      method: 'POST',
      body: JSON.stringify({ datePaid: ymd(new Date()), confirmNoInvoice: true, ...body }),
    }),
    { params: { id: subId } }
  )

const unpay = (subId: string, body: Record<string, unknown>) =>
  unmarkPaid(
    new Request('http://test/pay', { method: 'DELETE', body: JSON.stringify(body) }),
    { params: { id: subId } }
  )

const paidTotal = async (subId: string) =>
  (await prisma.subcontractorPayment.findMany({ where: { subcontractorId: subId } })).reduce(
    (sum, p) => sum + p.totalAmount,
    0
  )

describe('the field name the Cleaners page sends', () => {
  it('pays the add-on when it is called addOnServiceIds', async () => {
    // The Cleaners page names it addOnServiceIds, because the vendor route
    // does, and one bar pays both. This route only read addOnIds, so a
    // cleaner's performed add-ons were dropped without a word and the payment
    // came out lower than the amount the page had just shown.
    const { ana, jobs, addOn } = await seed()
    const res = await pay(ana.id, {
      jobIds: [jobs[0].id],
      addOnServiceIds: [addOn.id],
    })
    expect(res.status).toBe(201)
    expect(await paidTotal(ana.id)).toBe(185)
  })

  it('pays the add-on when it is called addOnIds', async () => {
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, { jobIds: [jobs[0].id], addOnIds: [addOn.id] })
    expect(await paidTotal(ana.id)).toBe(185)
  })

  it('does not pay it twice when both names carry it', async () => {
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, {
      jobIds: [jobs[0].id],
      addOnIds: [addOn.id],
      addOnServiceIds: [addOn.id],
    })
    expect(await paidTotal(ana.id)).toBe(185)
  })

  it('pays an add-on on its own, with no clean selected', async () => {
    const { ana, addOn } = await seed()
    const res = await pay(ana.id, { addOnServiceIds: [addOn.id] })
    expect(res.status).toBe(201)
    expect(await paidTotal(ana.id)).toBe(120)
  })
})

describe('what an add-on payment records', () => {
  it('writes a line of its own', async () => {
    // It used to be added straight to the payment total with no line at all.
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, { jobIds: [jobs[0].id], addOnServiceIds: [addOn.id] })

    const payment = await prisma.subcontractorPayment.findFirstOrThrow({
      include: { lineItems: true },
    })
    expect(payment.lineItems).toHaveLength(2)
    expect(payment.lineItems.reduce((s, i) => s + i.amount, 0)).toBe(payment.totalAmount)
  })

  it('says what the add-on was, in its own words', async () => {
    const { ana, addOn } = await seed()
    await pay(ana.id, { addOnServiceIds: [addOn.id] })

    const [line] = await prisma.subcontractorPaymentLineItem.findMany()
    expect(line.addOnServiceId).toBe(addOn.id)
    expect(line.jobId).toBeNull()
    expect(line.description).toContain('Carpet shampoo')
  })

  it('counts in the payment history', async () => {
    // Payment history counts line items to say how much work a payment covered.
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, { jobIds: jobs.map(j => j.id), addOnServiceIds: [addOn.id] })

    const payment = await prisma.subcontractorPayment.findFirstOrThrow({
      include: { _count: { select: { lineItems: true } } },
    })
    expect(payment._count.lineItems).toBe(3)
  })

  it('claims an obligation, so it cannot be paid twice', async () => {
    const { ana, addOn } = await seed()
    await pay(ana.id, { addOnServiceIds: [addOn.id] })

    const coverage = await prisma.subcontractorPaymentCoverage.findMany()
    expect(coverage).toHaveLength(1)
    expect(coverage[0].kind).toBe('ADDON')
  })

  it('lets exactly one of two simultaneous payments through', async () => {
    const { ana, addOn } = await seed()
    const results = await Promise.all([
      pay(ana.id, { addOnServiceIds: [addOn.id] }),
      pay(ana.id, { addOnServiceIds: [addOn.id] }),
    ])
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(await paidTotal(ana.id)).toBe(120)
  })
})

describe('undoing when an add-on is on the payment', () => {
  it('keeps the add-on money when a clean is unticked', async () => {
    // The reported gap: the payment total was recomputed from line items, which
    // did not include the add-on. Undoing the clean deleted the whole payment
    // and the add-on money with it, while the add-on stayed marked paid.
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, { jobIds: [jobs[0].id], addOnServiceIds: [addOn.id] })

    await unpay(ana.id, { jobIds: [jobs[0].id] })

    expect(await paidTotal(ana.id)).toBe(120)
    const after = await prisma.addOnService.findUniqueOrThrow({ where: { id: addOn.id } })
    expect(after.subcontractorPaid).toBe(true)
  })

  it('unmarks the add-on when the add-on itself is unticked', async () => {
    // Undo only ever looked at cleans, so a performed add-on stayed marked paid
    // for good once it had been paid once.
    const { ana, addOn } = await seed()
    await pay(ana.id, { addOnServiceIds: [addOn.id] })

    const res = await unpay(ana.id, { addOnServiceIds: [addOn.id] })
    expect(res.status).toBe(200)

    const after = await prisma.addOnService.findUniqueOrThrow({ where: { id: addOn.id } })
    expect(after.subcontractorPaid).toBe(false)
    expect(await paidTotal(ana.id)).toBe(0)
  })

  it('releases the add-on so it can be paid again', async () => {
    const { ana, addOn } = await seed()
    await pay(ana.id, { addOnServiceIds: [addOn.id] })
    await unpay(ana.id, { addOnServiceIds: [addOn.id] })

    expect(await prisma.subcontractorPaymentCoverage.count()).toBe(0)
    expect((await pay(ana.id, { addOnServiceIds: [addOn.id] })).status).toBe(201)
  })

  it('leaves the cleans alone when only the add-on is unticked', async () => {
    const { ana, jobs, addOn } = await seed()
    await pay(ana.id, { jobIds: jobs.map(j => j.id), addOnServiceIds: [addOn.id] })

    await unpay(ana.id, { addOnServiceIds: [addOn.id] })

    const cleans = await prisma.job.findMany({
      where: { id: { in: jobs.map(j => j.id) } },
      select: { subcontractorPaid: true },
    })
    expect(cleans.every(c => c.subcontractorPaid)).toBe(true)
    expect(await paidTotal(ana.id)).toBe(130)
  })

  it('refuses an undo that names nothing', async () => {
    const { ana } = await seed()
    expect((await unpay(ana.id, {})).status).toBe(400)
  })
})
