import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createInvoice } from '@/app/api/invoices/route'
import { invoiceWorkspaceMonth } from '@/lib/invoice-month'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// August's work, invoiced in early September · the month-end billing flow, and
// the one where filing by creation date puts the invoice in the wrong month.
const AUG = { year: 2026, month: 7 }
const augDay = (d: number) => new Date(Date.UTC(AUG.year, AUG.month, d, 12, 0, 0))
const AUG_PERIOD = '2026-08'

async function seed() {
  const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Bigco HQ', address: '1 Main St' },
  })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: cleaner.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([augDay(3).getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 100,
      defaultSubcontractorRate: 65,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: augDay(1),
    },
  })
  const jobs = []
  for (const d of [3, 10, 17]) {
    jobs.push(
      await prisma.job.create({
        data: {
          locationId: location.id,
          subcontractorId: cleaner.id,
          scheduleId: schedule.id,
          date: augDay(d),
          clientRate: 100,
          subcontractorRate: 65,
          status: 'COMPLETED',
        },
      })
    )
  }
  return { client, location, jobs }
}

const create = (body: Record<string, unknown>) =>
  createInvoice(new Request('http://test/invoices', { method: 'POST', body: JSON.stringify(body) }))

describe('an invoice records the month it bills for', () => {
  it('files August work under August, whatever day it was written', async () => {
    // The reported defect: this was never written, so every consumer fell back
    // to dateCreated. August work invoiced on September 2 counted as a
    // September invoice · it vanished from the August review, where its client
    // then looked unbilled and could be invoiced a second time.
    const { client, jobs } = await seed()
    const res = await create({
      clientId: client.id,
      jobIds: jobs.map(j => j.id),
      period: AUG_PERIOD,
    })
    expect(res.status).toBe(200)

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoice.billingPeriodStart).not.toBeNull()
    expect(invoice.billingPeriodStart!.toISOString()).toBe('2026-08-01T12:00:00.000Z')
    expect(invoice.billingPeriodEnd!.toISOString()).toBe('2026-08-31T12:00:00.000Z')
  })

  it('opens the workspace on the month of the work, not the month of the click', async () => {
    const { client, jobs } = await seed()
    await create({ clientId: client.id, jobIds: jobs.map(j => j.id), period: AUG_PERIOD })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoiceWorkspaceMonth(invoice)).toBe('2026-08')
  })

  it('records the period on a preview too, so finalizing keeps it', async () => {
    // The workspace creates a VOID preview first and finalizes it. If the
    // period were only written on non-previews the workspace path · the one
    // that has the bug · would still miss it.
    const { client, jobs } = await seed()
    await create({
      clientId: client.id,
      jobIds: jobs.map(j => j.id),
      period: AUG_PERIOD,
      previewOnly: true,
    })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoice.status).toBe('VOID')
    expect(invoice.billingPeriodStart!.toISOString()).toBe('2026-08-01T12:00:00.000Z')
  })

  it('leaves the period unset when no month was given', async () => {
    // The quick-invoice flow sends no period. Guessing one from today's date is
    // exactly the inference being removed.
    const { client, jobs } = await seed()
    await create({ clientId: client.id, jobIds: jobs.map(j => j.id) })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoice.billingPeriodStart).toBeNull()
  })

  it('falls back to the creation month only when there is no period recorded', async () => {
    const { client, jobs } = await seed()
    await create({ clientId: client.id, jobIds: jobs.map(j => j.id) })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    const created = invoice.dateCreated
    const expected = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}`
    expect(invoiceWorkspaceMonth(invoice)).toBe(expected)
  })
})

describe('the period is stored as a day value', () => {
  it('reads back as the first of the month in UTC', async () => {
    // billingPeriodStart is read with UTC accessors. Local midnight on the 1st
    // is the last day of the month BEFORE in UTC, which files the invoice a
    // month early for everyone ahead of UTC.
    const { client, jobs } = await seed()
    await create({ clientId: client.id, jobIds: jobs.map(j => j.id), period: AUG_PERIOD })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoice.billingPeriodStart!.getUTCDate()).toBe(1)
    expect(invoice.billingPeriodStart!.getUTCMonth()).toBe(7)
  })

  it('covers the last day of the month', async () => {
    const { client, jobs } = await seed()
    await create({ clientId: client.id, jobIds: jobs.map(j => j.id), period: AUG_PERIOD })

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { clientId: client.id } })
    expect(invoice.billingPeriodEnd!.getUTCDate()).toBe(31)
  })
})
