import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as finalizeInvoice } from '@/app/api/invoices/[id]/finalize/route'
import { POST as applyRateForward } from '@/app/api/jobs/[id]/apply-rate-forward/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))

/** One account with four cleans in the month. */
async function seed(payType: 'PER_CLEAN' | 'FLAT_RATE') {
  const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: payType, cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Bigco HQ', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: cleaner.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([day(7).getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: payType === 'FLAT_RATE' ? 4000 : 100,
      defaultSubcontractorRate: 65,
      clientPayType: payType,
      subcontractorPayType: 'PER_CLEAN',
      startDate: day(1),
    },
  })
  const jobs = []
  for (const d of [7, 14, 21, 28]) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: cleaner.id,
          scheduleId: schedule.id,
          date: day(d),
          clientRate: payType === 'FLAT_RATE' ? 4000 : 100,
          subcontractorRate: 65,
          status: 'COMPLETED',
        },
      })
    )
  }
  return { cleaner, client, location, schedule, jobs }
}

async function draftInvoiceFor(clientId: string, lines: Array<{ jobId: string; amount: number; description: string }>) {
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      invoiceNumber: `INV-FIN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'DRAFT',
      totalAmount: lines.reduce((s, l) => s + l.amount, 0),
    },
  })
  for (const l of lines) {
    await prisma.invoiceLineItem.create({ data: { invoiceId: invoice.id, ...l } })
  }
  return invoice
}

const finalize = (id: string) =>
  finalizeInvoice(new Request('http://test/finalize', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

const invoicedFlags = async (jobIds: string[]) => {
  const rows = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, invoiced: true },
  })
  return jobIds.map(id => rows.find(r => r.id === id)!.invoiced)
}

describe('A11 · finalizing a per-clean invoice', () => {
  it('leaves a clean that was taken off the invoice still billable', async () => {
    // The reported defect: finalize swept in every non-cancelled clean on the
    // schedule-month. On a per-clean account those are exactly the cleans the
    // reviewer removed · stamped billed with nothing billing them, and never
    // seen again. Unbilled revenue, and silent.
    const { client, jobs } = await seed('PER_CLEAN')
    const invoice = await draftInvoiceFor(
      client.id,
      jobs.slice(0, 3).map(j => ({ jobId: j.id, amount: 100, description: 'Cleaning' })),
    )

    expect((await finalize(invoice.id)).status).toBe(200)

    expect(await invoicedFlags(jobs.map(j => j.id))).toEqual([true, true, true, false])
  })

  it('bills every clean when every clean is on the invoice', async () => {
    const { client, jobs } = await seed('PER_CLEAN')
    const invoice = await draftInvoiceFor(
      client.id,
      jobs.map(j => ({ jobId: j.id, amount: 100, description: 'Cleaning' })),
    )
    await finalize(invoice.id)

    expect(await invoicedFlags(jobs.map(j => j.id))).toEqual([true, true, true, true])
  })

  it('leaves an extra clean added after the invoice was built still billable', async () => {
    const { client, location, schedule, cleaner, jobs } = await seed('PER_CLEAN')
    const invoice = await draftInvoiceFor(
      client.id,
      jobs.map(j => ({ jobId: j.id, amount: 100, description: 'Cleaning' })),
    )
    const extra = await prisma.job.create({
      data: {
        locationId: location.id,
        subcontractorId: cleaner.id,
        scheduleId: schedule.id,
        date: day(24),
        clientRate: 100,
        subcontractorRate: 65,
        status: 'COMPLETED',
      },
    })

    await finalize(invoice.id)
    expect(await invoicedFlags([extra.id])).toEqual([false])
  })
})

describe('A11 · finalizing a flat-rate month', () => {
  it('bills every clean in the month from its single line', async () => {
    // A flat month carries ONE line for the whole month, so the other cleans
    // have no line of their own and must still be marked · this is why the
    // sweep exists, and it has to keep working.
    const { client, jobs } = await seed('FLAT_RATE')
    const invoice = await draftInvoiceFor(client.id, [
      { jobId: jobs[0].id, amount: 4000, description: 'Monthly Cleaning - Bigco HQ' },
    ])

    await finalize(invoice.id)
    expect(await invoicedFlags(jobs.map(j => j.id))).toEqual([true, true, true, true])
  })

  it('does not reach into the next month', async () => {
    const { client, location, schedule, cleaner, jobs } = await seed('FLAT_RATE')
    const nextMonth = await prisma.job.create({
      data: {
        locationId: location.id,
        subcontractorId: cleaner.id,
        scheduleId: schedule.id,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 7, 12, 0, 0)),
        clientRate: 4000,
        subcontractorRate: 65,
        status: 'COMPLETED',
      },
    })
    const invoice = await draftInvoiceFor(client.id, [
      { jobId: jobs[0].id, amount: 4000, description: 'Monthly Cleaning' },
    ])

    await finalize(invoice.id)
    expect(await invoicedFlags([nextMonth.id])).toEqual([false])
  })
})

describe('A10 · applying a rate to future cleans', () => {
  const applyForward = (jobId: string, body: Record<string, unknown>) =>
    applyRateForward(
      new Request('http://test/forward', { method: 'POST', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: jobId }) },
    )

  it('refuses a client rate change on a flat monthly account', async () => {
    // The reported defect: this wrote the new rate onto the shared schedule,
    // and a flat month is priced from the schedule for EVERY month · so a
    // clean in September re-priced July, which had not been sent yet.
    const { jobs } = await seed('FLAT_RATE')
    const res = await applyForward(jobs[2].id, { clientRate: 5000 })

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('FLAT_RATE_NEEDS_SCHEDULE_CHANGE')
  })

  it('leaves the monthly rate exactly where it was', async () => {
    const { schedule, jobs } = await seed('FLAT_RATE')
    await applyForward(jobs[2].id, { clientRate: 5000 })

    const after = await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } })
    expect(after.defaultClientRate).toBe(4000)
  })

  it('still applies a client rate change on a per-clean account', async () => {
    const { jobs, schedule } = await seed('PER_CLEAN')
    const res = await applyForward(jobs[2].id, { clientRate: 150 })
    expect(res.status).toBe(200)

    // Forward only: the earlier cleans keep the rate they were done at.
    const rates = await prisma.job.findMany({
      where: { scheduleId: schedule.id },
      select: { date: true, clientRate: true },
      orderBy: { date: 'asc' },
    })
    expect(rates.map(r => r.clientRate)).toEqual([100, 100, 150, 150])
  })

  it('still changes the cleaner forward on a flat monthly account', async () => {
    // Who does the work says nothing about what the client is charged.
    const { jobs } = await seed('FLAT_RATE')
    const standIn = await prisma.subcontractor.create({ data: { name: 'Ana' } })

    const res = await applyForward(jobs[2].id, { subcontractorId: standIn.id })
    expect(res.status).toBe(200)
  })
})
