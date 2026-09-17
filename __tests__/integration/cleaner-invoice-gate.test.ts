import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createPayment } from '@/app/api/subcontractors/[id]/payments/route'

beforeEach(async () => {
  await prisma.cleanerInvoiceReceipt.deleteMany()
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const PERIOD = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

/** One cleaner working two accounts in the same month. */
async function seed() {
  const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })

  const make = async (name: string, address: string, dayOfMonth: number) => {
    const client = await prisma.client.create({
      data: { name, billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
    })
    const location = await prisma.location.create({
      data: { clientId: client.id, name: `${name} site`, address },
    })
    const schedule = await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: cleaner.id,
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
            subcontractorId: cleaner.id,
            scheduleId: schedule.id,
            date: day(dayOfMonth + i * 7),
            clientRate: 130,
            subcontractorRate: 65,
            status: 'COMPLETED',
          },
        })
      )
    }
    return { client, location, jobs }
  }

  const bigco = await make('Bigco Offices', '1 Main St', 3)
  const cafe = await make('Corner Cafe', '2 Side St', 4)
  return { cleaner, bigco, cafe }
}

/** The cleaner sent us an invoice. Shape depends on what is passed. */
const recordReceipt = (
  cleanerId: string,
  locationId: string,
  scope: { jobId?: string; addOnServiceId?: string } = {},
) =>
  prisma.cleanerInvoiceReceipt.create({
    data: {
      subcontractorId: cleanerId,
      locationId,
      period: PERIOD,
      jobId: scope.jobId ?? null,
      addOnServiceId: scope.addOnServiceId ?? null,
    },
  })

const pay = (cleanerId: string, jobIds: string[], extra: Record<string, unknown> = {}) =>
  createPayment(
    new Request('http://test/pay', {
      method: 'POST',
      body: JSON.stringify({ jobIds, datePaid: ymd(new Date()), ...extra }),
    }),
    { params: { id: cleanerId } }
  )

describe('paying for work the cleaner has not invoiced', () => {
  it('is refused when no invoice is on file at all', async () => {
    const { cleaner, bigco } = await seed()
    const res = await pay(cleaner.id, [bigco.jobs[0].id])
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('NO_MATCHING_CLEANER_INVOICE')
  })

  it('is refused for a second account when only the first was invoiced', async () => {
    // The reported defect: the gate asked whether ANY receipt existed for this
    // cleaner in this MONTH. One account's invoice released payment for every
    // account they worked that month.
    const { cleaner, bigco, cafe } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id)

    const res = await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id])
    expect(res.status).toBe(409)

    const body = await res.json()
    expect(body.error).toContain('Corner Cafe')
    expect(body.error).not.toContain('Bigco')
  })

  it('names the account, not just the month', async () => {
    const { cleaner, bigco, cafe } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id)

    const body = await (await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id])).json()
    expect(body.gaps).toHaveLength(1)
    expect(body.gaps[0].locationName).toBe('Corner Cafe')
    expect(body.gaps[0].count).toBe(1)
  })

  it('records no payment when it refuses', async () => {
    const { cleaner, bigco, cafe } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id)
    await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id])

    expect(await prisma.subcontractorPayment.count()).toBe(0)
    const jobs = await prisma.job.findMany({ select: { subcontractorPaid: true } })
    expect(jobs.every(j => !j.subcontractorPaid)).toBe(true)
  })

  it('is refused for a second clean when only the first was invoiced', async () => {
    // Recording receipts per clean is the careful thing to do, and it opened
    // the widest hole: one tick released the whole month.
    const { cleaner, bigco } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id, { jobId: bigco.jobs[0].id })

    const res = await pay(cleaner.id, [bigco.jobs[0].id, bigco.jobs[1].id])
    expect(res.status).toBe(409)
  })
})

describe('paying for work the cleaner has invoiced', () => {
  it('goes through on an account-wide receipt', async () => {
    const { cleaner, bigco } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id)

    const res = await pay(cleaner.id, bigco.jobs.map(j => j.id))
    expect(res.status).toBe(201)
  })

  it('goes through on a receipt for exactly that clean', async () => {
    const { cleaner, bigco } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id, { jobId: bigco.jobs[0].id })

    expect((await pay(cleaner.id, [bigco.jobs[0].id])).status).toBe(201)
  })

  it('goes through for both accounts when both were invoiced', async () => {
    const { cleaner, bigco, cafe } = await seed()
    await recordReceipt(cleaner.id, bigco.location.id)
    await recordReceipt(cleaner.id, cafe.location.id)

    const res = await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id])
    expect(res.status).toBe(201)
  })

  it('goes through on a matched invoice for the month, across accounts', async () => {
    // The older intake is one invoice per cleaner per month, and genuinely does
    // cover the month. That shape was never the defect.
    const { cleaner, bigco, cafe } = await seed()
    await prisma.cleanerInvoice.create({
      data: {
        subcontractorId: cleaner.id,
        period: PERIOD,
        claimedAmount: 260,
        computedOwed: 260,
        status: 'MATCHED',
      },
    })

    const res = await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id])
    expect(res.status).toBe(201)
  })

  it('goes through regardless when the reviewer confirms', async () => {
    const { cleaner, bigco, cafe } = await seed()
    const res = await pay(cleaner.id, [bigco.jobs[0].id, cafe.jobs[0].id], {
      confirmNoInvoice: true,
    })
    expect(res.status).toBe(201)
  })

  it('does not count another cleaner receipt for the same account', async () => {
    const { cleaner, bigco } = await seed()
    const other = await prisma.subcontractor.create({ data: { name: 'Ana' } })
    await recordReceipt(other.id, bigco.location.id)

    expect((await pay(cleaner.id, [bigco.jobs[0].id])).status).toBe(409)
  })
})
