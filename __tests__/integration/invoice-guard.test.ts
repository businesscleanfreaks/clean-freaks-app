import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// The send route calls revalidatePath, which only works inside a Next request.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { ensureJobsForDateRange } from '@/lib/regenerate-schedule-jobs'
import { POST as markSent } from '@/app/api/invoices/[id]/mark-sent/route'
import { PUT as putInvoice } from '@/app/api/invoices/[id]/route'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const MONTH = { startDate: utc(2026, 5, 1), endDate: utc(2026, 5, 31) }

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

async function seedPerClean() {
  const start = utc(2026, 5, 4)
  const client = await prisma.client.create({
    data: { name: 'PerClean Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: 'A Rd' } })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '10:00',
      defaultClientRate: 120,
      defaultSubcontractorRate: 80,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: start,
    },
  })
  return { client, location, schedule }
}

/** A DRAFT invoice billing every clean currently in the period. */
async function invoiceAllCleans(clientId: string) {
  const jobs = await prisma.job.findMany({ where: { location: { clientId } }, orderBy: { date: 'asc' } })
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-G-${Date.now()}`,
      clientId,
      totalAmount: jobs.length * 120,
      status: 'DRAFT',
      // No billingPeriodStart/End — mirrors composer-created invoices, so this
      // exercises the guard's period-derivation path.
      lineItems: { create: jobs.map((j) => ({ jobId: j.id, description: 'Cleaning', amount: 120, serviceDate: j.date })) },
    },
  })
  await prisma.job.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { invoiced: true } })
  return { invoice, jobs }
}

const req = (body?: unknown) =>
  new Request('http://test/api/invoices/x/mark-sent', { method: 'POST', body: JSON.stringify(body ?? {}) })

const statusOf = async (id: string) => (await prisma.invoice.findUnique({ where: { id } }))!.status

describe('pre-invoice guard at send time (real DB)', () => {
  it('blocks when a billed clean was cancelled, and allows it with confirmMismatch', async () => {
    const { client } = await seedPerClean()
    await ensureJobsForDateRange(MONTH)
    const { invoice, jobs } = await invoiceAllCleans(client.id)
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED' } })

    const blocked = await markSent(req(), { params: { id: invoice.id } })
    expect(blocked.status).toBe(409)
    const body = await blocked.json()
    expect(body.code).toBe('INVOICE_MISMATCH')
    expect(body.findings.map((f: { code: string }) => f.code)).toContain('BILLED_BUT_CANCELLED')
    expect(await statusOf(invoice.id)).toBe('DRAFT') // not sent

    const ok = await markSent(req({ confirmMismatch: true }), { params: { id: invoice.id } })
    expect(ok.status).toBe(200)
    expect(await statusOf(invoice.id)).toBe('SENT')
  })

  it('blocks when the period gained an unbilled clean (under-billing)', async () => {
    const { client, location, schedule } = await seedPerClean()
    await ensureJobsForDateRange(MONTH)
    const { invoice } = await invoiceAllCleans(client.id)
    await prisma.job.create({
      data: { locationId: location.id, scheduleId: schedule.id, date: utc(2026, 5, 6), clientRate: 120, subcontractorRate: 80, status: 'SCHEDULED' },
    })

    const blocked = await markSent(req(), { params: { id: invoice.id } })
    expect(blocked.status).toBe(409)
    const body = await blocked.json()
    expect(body.findings.map((f: { code: string }) => f.code)).toContain('MISSING_CLEAN')
  })

  it('passes a clean invoice that bills exactly the period cleans', async () => {
    const { client } = await seedPerClean()
    await ensureJobsForDateRange(MONTH)
    const { invoice } = await invoiceAllCleans(client.id)

    const res = await markSent(req(), { params: { id: invoice.id } })
    expect(res.status).toBe(200)
    expect(await statusOf(invoice.id)).toBe('SENT')
  })

  it('also guards the invoice-detail PUT status=SENT path', async () => {
    const { client } = await seedPerClean()
    await ensureJobsForDateRange(MONTH)
    const { invoice, jobs } = await invoiceAllCleans(client.id)
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED' } })

    const putReq = (b: unknown) => new Request('http://test', { method: 'PUT', body: JSON.stringify(b) })

    const blocked = await putInvoice(putReq({ status: 'SENT' }), { params: { id: invoice.id } })
    expect(blocked.status).toBe(409)
    expect(await statusOf(invoice.id)).toBe('DRAFT')

    const ok = await putInvoice(putReq({ status: 'SENT', confirmMismatch: true }), { params: { id: invoice.id } })
    expect(ok.status).toBe(200)
    expect(await statusOf(invoice.id)).toBe('SENT')
  })
})
