import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/billing-settings', () => ({
  getBillingStartDate: async () => new Date(Date.UTC(2026, 4, 1, 12, 0, 0)),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as getCandidates } from '@/app/api/invoices/candidates/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const utc = (d: number) => new Date(Date.UTC(2026, 4, d, 12, 0, 0))

const candidates = async () => {
  const res = await getCandidates(
    new Request('http://test/api/invoices/candidates?start=2026-05-01&end=2026-05-31') as never,
  )
  expect(res.status).toBe(200)
  return (await res.json()).candidates as Array<{
    clientName: string
    status: string
    lineItems?: unknown[]
  }>
}

/** A flat-rate account with four weekly cleans in May. */
async function seedFlatRateMonth() {
  const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: {
      name: 'Flat Rate Co',
      billingType: 'FLAT_RATE',
      cleanerPayType: 'PER_CLEAN',
      invoicingEmail: 'billing@flatrate.test',
    },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Flat Rate Site', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: cleaner.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([utc(4).getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 4000,
      defaultSubcontractorRate: 800,
      clientPayType: 'FLAT_RATE',
      subcontractorPayType: 'PER_CLEAN',
      startDate: utc(1),
    },
  })
  const jobs = []
  for (const d of [4, 11, 18, 25]) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: cleaner.id,
          scheduleId: schedule.id,
          date: utc(d),
          clientRate: 4000,
          subcontractorRate: 800,
          status: 'COMPLETED',
        },
      })
    )
  }
  return { client, location, schedule, jobs }
}

/** The invoice the workspace would have produced for that month. */
async function invoiceTheMonth(
  clientId: string,
  firstJobId: string,
  status: 'DRAFT' | 'SENT' | 'PAID',
) {
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      invoiceNumber: `INV-FR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status,
      totalAmount: 4000,
      billingPeriodStart: new Date(Date.UTC(2026, 4, 1, 12, 0, 0)),
      billingPeriodEnd: new Date(Date.UTC(2026, 4, 31, 12, 0, 0)),
      ...(status !== 'DRAFT' ? { dateSent: new Date(Date.UTC(2026, 5, 2, 12, 0, 0)) } : {}),
    },
  })
  // A flat month carries ONE line for the whole month, on the first clean.
  await prisma.invoiceLineItem.create({
    data: {
      invoiceId: invoice.id,
      jobId: firstJobId,
      description: 'Monthly Cleaning - Flat Rate Site - May 2026',
      amount: 4000,
      serviceDate: utc(4),
    },
  })
  return invoice
}

describe('B1 · a flat-rate month that has been invoiced', () => {
  it('does not offer to invoice it again once sent', async () => {
    // The reported concern: the monthly line is seeded from the schedules
    // rather than from uninvoiced work, so it comes back however the month was
    // billed · and "has remaining work" wins over "already sent", leaving the
    // row READY. Clicking send again re-emails the same invoice.
    const { client, jobs } = await seedFlatRateMonth()
    await prisma.job.updateMany({
      where: { id: { in: jobs.map(j => j.id) } },
      data: { invoiced: true },
    })
    await invoiceTheMonth(client.id, jobs[0].id, 'SENT')

    const rows = await candidates()
    const row = rows.find(c => c.clientName === 'Flat Rate Co')

    expect(row).toBeDefined()
    expect(row!.status).toBe('SENT')
  })

  it('shows a paid month as paid', async () => {
    const { client, jobs } = await seedFlatRateMonth()
    await prisma.job.updateMany({
      where: { id: { in: jobs.map(j => j.id) } },
      data: { invoiced: true },
    })
    await invoiceTheMonth(client.id, jobs[0].id, 'PAID')

    const row = (await candidates()).find(c => c.clientName === 'Flat Rate Co')
    expect(row!.status).toBe('PAID')
  })

  it('still offers a month that has not been invoiced', async () => {
    // The guard must not spread: an unbilled month is exactly what this screen
    // exists to show.
    await seedFlatRateMonth()

    const row = (await candidates()).find(c => c.clientName === 'Flat Rate Co')
    expect(row).toBeDefined()
    expect(row!.status).toBe('READY')
  })
})
