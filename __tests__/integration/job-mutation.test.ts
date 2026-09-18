import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { PUT as updateJob } from '@/app/api/jobs/[id]/route'
import { PUT as bulkUpdate } from '@/app/api/jobs/bulk-update/route'
import { POST as convertToOneTime } from '@/app/api/jobs/[id]/convert-to-one-time/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))

/**
 * One weekly account with a clean on a DRAFT invoice: a $100 cleaning line and
 * a $25 add-on line, so the invoice is $125.
 */
async function seed(opts?: { withAddOn?: boolean }) {
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
      daysOfWeek: JSON.stringify([1]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 100,
      defaultSubcontractorRate: 65,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: day(1),
    },
  })
  const job = await prisma.job.create({
    data: {
      locationId: location.id,
      subcontractorId: cleaner.id,
      scheduleId: schedule.id,
      date: day(7),
      startTime: '09:00',
      clientRate: 100,
      subcontractorRate: 65,
      status: 'SCHEDULED',
      invoiced: true,
    },
  })

  const addOn = opts?.withAddOn
    ? await prisma.addOnService.create({
        data: { jobId: job.id, description: 'Carpet shampoo', clientRate: 25, subcontractorRate: 15 },
      })
    : null

  const invoice = await prisma.invoice.create({
    data: {
      clientId: client.id,
      invoiceNumber: `INV-JM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'DRAFT',
      totalAmount: addOn ? 125 : 100,
    },
  })
  await prisma.invoiceLineItem.create({
    data: {
      invoiceId: invoice.id,
      jobId: job.id,
      description: 'Cleaning - Bigco Offices - Sep 7, 2026',
      amount: 100,
      serviceDate: job.date,
    },
  })
  if (addOn) {
    await prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        jobId: job.id,
        addOnServiceId: addOn.id,
        description: 'Carpet shampoo',
        amount: 25,
      },
    })
  }

  return { cleaner, client, location, schedule, job, addOn, invoice }
}

const editJob = (jobId: string, body: Record<string, unknown>) =>
  updateJob(
    new Request('http://test/job', { method: 'PUT', body: JSON.stringify(body) }),
    { params: { id: jobId } }
  )

const bulk = (body: Record<string, unknown>) =>
  bulkUpdate(new Request('http://test/bulk', { method: 'PUT', body: JSON.stringify(body) }))

const invoiceTotal = async (id: string) =>
  (await prisma.invoice.findUniqueOrThrow({ where: { id } })).totalAmount

describe('F02 · a time-only edit', () => {
  it('does not change the invoice total', async () => {
    // The reported defect: the draft refresh fired on startTime and rewrote
    // every line to the job's client rate, turning $125 into $200.
    const { job, invoice } = await seed({ withAddOn: true })
    const res = await editJob(job.id, { startTime: '10:00' })
    expect(res.status).toBe(200)

    expect(await invoiceTotal(invoice.id)).toBe(125)
  })

  it('does not reprice the add-on line', async () => {
    const { job, addOn } = await seed({ withAddOn: true })
    await editJob(job.id, { startTime: '10:00' })

    const line = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { addOnServiceId: addOn!.id },
    })
    expect(line.amount).toBe(25)
    expect(line.description).toBe('Carpet shampoo')
  })

  it('does not rewrite the cleaning line description', async () => {
    const { job } = await seed({ withAddOn: true })
    await editJob(job.id, { startTime: '10:00' })

    const line = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { jobId: job.id, addOnServiceId: null },
    })
    expect(line.description).toBe('Cleaning - Bigco Offices - Sep 7, 2026')
  })

  it('does not change anything when the window moves either', async () => {
    const { job, invoice } = await seed({ withAddOn: true })
    await editJob(job.id, { startWindowBegin: '08:00', startWindowEnd: '12:00' })
    expect(await invoiceTotal(invoice.id)).toBe(125)
  })
})

describe('F02 · a rate change', () => {
  it('moves the cleaning line and leaves the add-on alone', async () => {
    const { job, addOn, invoice } = await seed({ withAddOn: true })
    await editJob(job.id, { clientRate: 140 })

    const cleaning = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { jobId: job.id, addOnServiceId: null },
    })
    const extra = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { addOnServiceId: addOn!.id },
    })
    expect(cleaning.amount).toBe(140)
    expect(extra.amount).toBe(25)
    expect(await invoiceTotal(invoice.id)).toBe(165)
  })
})

describe('F02 · a date change', () => {
  it('moves the description and the service date together', async () => {
    // The old refresh changed the description and never the serviceDate, so a
    // line said one day and was filed under another.
    const { job } = await seed()
    const moved = day(14)
    // The route takes a date-only day, not an instant.
    const res = await editJob(job.id, { date: moved.toISOString().slice(0, 10) })
    expect(res.status).toBe(200)

    const line = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { jobId: job.id, addOnServiceId: null },
    })
    expect(line.description).toContain('14')
    expect(line.serviceDate).not.toBeNull()
  })
})

describe('F03 · bulk assign', () => {
  it('refuses to move a clean the cleaner has been paid for', async () => {
    // The individual route blocks this. The bulk route did it silently.
    const { job } = await seed()
    await prisma.job.update({ where: { id: job.id }, data: { subcontractorPaid: true } })
    const other = await prisma.subcontractor.create({ data: { name: 'Ana' } })

    const res = await bulk({ jobIds: [job.id], subcontractorId: other.id })
    expect(res.status).toBe(400)

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } })
    expect(after.subcontractorId).toBe(job.subcontractorId)
  })

  it('applies to the jobs it may and reports the rest', async () => {
    const { job, location, cleaner, schedule } = await seed()
    await prisma.job.update({ where: { id: job.id }, data: { subcontractorPaid: true } })
    const free = await prisma.job.create({
      data: {
        locationId: location.id,
        subcontractorId: cleaner.id,
        scheduleId: schedule.id,
        date: day(14),
        clientRate: 100,
        subcontractorRate: 65,
        status: 'SCHEDULED',
      },
    })
    const other = await prisma.subcontractor.create({ data: { name: 'Ana' } })

    const res = await bulk({ jobIds: [job.id, free.id], subcontractorId: other.id })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(body.blocked).toHaveLength(1)
    expect(body.blocked[0].id).toBe(job.id)

    expect((await prisma.job.findUniqueOrThrow({ where: { id: free.id } })).subcontractorId).toBe(other.id)
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).subcontractorId).toBe(cleaner.id)
  })

  it('still assigns ordinary unpaid work', async () => {
    const { job } = await seed()
    const other = await prisma.subcontractor.create({ data: { name: 'Ana' } })

    expect((await bulk({ jobIds: [job.id], subcontractorId: other.id })).status).toBe(200)
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).subcontractorId).toBe(other.id)
  })
})

describe('F03 · bulk cancel', () => {
  it('takes the clean off the draft invoice, as cancelling one does', async () => {
    // The reported defect: bulk cancel was a bare updateMany, so the client
    // kept being billed for work that was no longer happening.
    const { job, invoice } = await seed({ withAddOn: true })
    const res = await bulk({ jobIds: [job.id], status: 'CANCELLED' })
    expect(res.status).toBe(200)

    expect(await prisma.invoiceLineItem.count({ where: { jobId: job.id } })).toBe(0)
    expect(await invoiceTotal(invoice.id)).toBe(0)
  })

  it('unmarks the clean as invoiced so it can be billed again', async () => {
    const { job } = await seed()
    await bulk({ jobIds: [job.id], status: 'CANCELLED' })

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } })
    expect(after.status).toBe('CANCELLED')
    expect(after.invoiced).toBe(false)
  })

  it('matches what cancelling the same clean individually does', async () => {
    const a = await seed({ withAddOn: true })
    await bulk({ jobIds: [a.job.id], status: 'CANCELLED' })
    const bulkTotal = await invoiceTotal(a.invoice.id)

    await resetDb()
    const b = await seed({ withAddOn: true })
    await editJob(b.job.id, { status: 'CANCELLED' })
    const singleTotal = await invoiceTotal(b.invoice.id)

    expect(bulkTotal).toBe(singleTotal)
  })

  it('leaves a SENT invoice alone, which is a record of what we billed', async () => {
    const { job, invoice } = await seed()
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } })

    await bulk({ jobIds: [job.id], status: 'CANCELLED' })

    expect(await prisma.invoiceLineItem.count({ where: { jobId: job.id } })).toBe(1)
    expect(await invoiceTotal(invoice.id)).toBe(100)
  })
})

describe('F14 · converting to a one-off', () => {
  const convert = (jobId: string, body: Record<string, unknown>) =>
    convertToOneTime(
      new Request('http://test/convert', { method: 'POST', body: JSON.stringify(body) }),
      { params: { id: jobId } }
    )

  it('moves the draft line to the new rate', async () => {
    // The conversion repriced the job and left its draft line on the old
    // amount, so the invoice went on charging the old price.
    const { job, invoice } = await seed()
    const res = await convert(job.id, { clientRate: 250, subcontractorRate: 150 })
    expect(res.status).toBe(200)

    const line = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { jobId: job.id, addOnServiceId: null },
    })
    expect(line.amount).toBe(250)
    expect(await invoiceTotal(invoice.id)).toBe(250)
  })

  it('does not reprice an add-on line', async () => {
    const { job, addOn, invoice } = await seed({ withAddOn: true })
    await convert(job.id, { clientRate: 250, subcontractorRate: 150 })

    const extra = await prisma.invoiceLineItem.findFirstOrThrow({
      where: { addOnServiceId: addOn!.id },
    })
    expect(extra.amount).toBe(25)
    expect(await invoiceTotal(invoice.id)).toBe(275)
  })

  it('retotals a draft that still has other lines after future cleans are removed', async () => {
    // Only fully empty drafts were handled. A draft with anything left kept its
    // old total, still counting the cleans just taken off it.
    const { job, location, cleaner, schedule, client } = await seed()
    const future = await prisma.job.create({
      data: {
        locationId: location.id,
        subcontractorId: cleaner.id,
        scheduleId: schedule.id,
        date: day(21),
        clientRate: 100,
        subcontractorRate: 65,
        status: 'SCHEDULED',
      },
    })
    const draft = await prisma.invoice.create({
      data: {
        clientId: client.id,
        invoiceNumber: `INV-F14-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        status: 'DRAFT',
        totalAmount: 200,
      },
    })
    // Two lines: the future clean, and something that will survive its removal.
    await prisma.invoiceLineItem.create({
      data: { invoiceId: draft.id, jobId: future.id, description: 'Cleaning', amount: 100 },
    })
    await prisma.invoiceLineItem.create({
      data: { invoiceId: draft.id, description: 'Supplies', amount: 100 },
    })

    await convert(job.id, { clientRate: 100, subcontractorRate: 65 })

    expect(await prisma.job.count({ where: { id: future.id } })).toBe(0)
    expect(await invoiceTotal(draft.id)).toBe(100)
  })
})
