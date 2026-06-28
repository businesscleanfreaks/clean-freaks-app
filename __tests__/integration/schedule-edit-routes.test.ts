import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { regenerateJobsForSchedule } from '@/lib/regenerate-schedule-jobs'
import { PUT as putSchedule } from '@/app/api/schedules/[id]/route'
import { POST as changeGoingForward } from '@/app/api/schedules/[id]/change-going-forward/route'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const utcDaysFromToday = (days: number) => {
  const today = new Date()
  return new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + days,
    12,
    0,
    0,
  ))
}

const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12, 0, 0))

const iso = (date: Date) => date.toISOString().slice(0, 10)

const req = (body: unknown, method: 'PUT' | 'POST') =>
  new Request('http://test/api/schedules/test', {
    method,
    body: JSON.stringify(body),
  })

async function seedSchedule(label: string, start: Date) {
  const client = await prisma.client.create({
    data: {
      name: `${label} Client`,
      billingType: 'PER_CLEAN',
      cleanerPayType: 'PER_CLEAN',
      startDate: start,
    },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: `${label} Site`, address: `${label} Main St` },
  })
  const sub = await prisma.subcontractor.create({ data: { name: `${label} Cleaner` } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: 100,
      defaultSubcontractorRate: 60,
      clientPayType: 'PER_CLEAN',
      subcontractorPayType: 'PER_CLEAN',
      startDate: start,
    },
  })

  await regenerateJobsForSchedule(schedule.id, {
    effectiveDate: schedule.startDate,
    rebuildDraftInvoicedJobs: true,
  })

  return { client, location, sub, schedule }
}

async function protectFirstJob(scheduleId: string, clientId: string, label: string) {
  const job = await prisma.job.findFirst({
    where: { scheduleId },
    orderBy: { date: 'asc' },
  })

  expect(job).not.toBeNull()

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${label}`,
      clientId,
      totalAmount: job!.clientRate,
      status: 'SENT',
      lineItems: {
        create: {
          jobId: job!.id,
          description: 'Protected clean',
          amount: job!.clientRate,
          serviceDate: job!.date,
        },
      },
    },
  })

  await prisma.job.update({ where: { id: job!.id }, data: { invoiced: true } })

  return { job: job!, invoice }
}

function editBody(locationId: string, subcontractorId: string, start: Date) {
  return {
    locationId,
    frequency: 'BI_WEEKLY',
    daysOfWeek: JSON.stringify([start.getUTCDay()]),
    monthlyPattern: null,
    startDate: iso(start),
    endDate: null,
    defaultClientRate: 150,
    defaultSubcontractorRate: 90,
    clientPayType: 'FLAT_RATE',
    subcontractorPayType: 'FLAT_RATE',
    subcontractorId,
    timeType: 'WINDOW',
    startTime: null,
    startWindowBegin: '08:00',
    startWindowEnd: '11:00',
  }
}

async function normalizedJobSnapshot(scheduleId: string) {
  const jobs = await prisma.job.findMany({
    where: { scheduleId },
    orderBy: { date: 'asc' },
    include: {
      invoiceLineItems: {
        include: {
          invoice: {
            select: { status: true },
          },
        },
      },
    },
  })

  return jobs.map((job) => ({
    date: iso(job.date),
    status: job.status,
    invoiced: job.invoiced,
    subcontractorPaid: job.subcontractorPaid,
    clientRate: job.clientRate,
    subcontractorRate: job.subcontractorRate,
    startTime: job.startTime,
    startWindowBegin: job.startWindowBegin,
    startWindowEnd: job.startWindowEnd,
    hasFinalInvoice: job.invoiceLineItems.some((lineItem) =>
      ['SENT', 'PAID'].includes(lineItem.invoice?.status ?? ''),
    ),
    invoiceLineItemCount: job.invoiceLineItems.length,
  }))
}

describe('schedule edit route agreement (real DB)', () => {
  it('PUT and same-start change-going-forward create the same cleans and protect finalized work', async () => {
    const start = utcDaysFromToday(2)
    const putSeed = await seedSchedule('PUT', start)
    const futureChangeSeed = await seedSchedule('CGF', start)
    const putProtected = await protectFirstJob(putSeed.schedule.id, putSeed.client.id, 'PUT')
    const futureChangeProtected = await protectFirstJob(
      futureChangeSeed.schedule.id,
      futureChangeSeed.client.id,
      'CGF',
    )

    const putResponse = await putSchedule(
      req(editBody(putSeed.location.id, putSeed.sub.id, start), 'PUT'),
      { params: { id: putSeed.schedule.id } },
    )
    expect(putResponse.status).toBe(200)

    const futureChangeResponse = await changeGoingForward(
      req(editBody(futureChangeSeed.location.id, futureChangeSeed.sub.id, start), 'POST'),
      { params: { id: futureChangeSeed.schedule.id } },
    )
    expect(futureChangeResponse.status).toBe(200)

    const putJobs = await normalizedJobSnapshot(putSeed.schedule.id)
    const futureChangeJobs = await normalizedJobSnapshot(futureChangeSeed.schedule.id)

    expect(putJobs).toEqual(futureChangeJobs)

    const startIso = iso(start)
    const protectedClean = putJobs.find((job) => job.date === startIso)
    expect(protectedClean).toMatchObject({
      clientRate: 100,
      subcontractorRate: 60,
      startTime: '09:00',
      startWindowBegin: null,
      startWindowEnd: null,
      invoiced: true,
      hasFinalInvoice: true,
    })
    expect(putProtected.job.id).not.toBe(futureChangeProtected.job.id)
    expect(putJobs.filter((job) => job.date === startIso)).toHaveLength(1)
    expect(putJobs.some((job) =>
      job.date !== startIso &&
      job.clientRate === 150 &&
      job.subcontractorRate === 90 &&
      job.startWindowBegin === '08:00' &&
      job.startWindowEnd === '11:00',
    )).toBe(true)

    const [putClient, futureChangeClient] = await Promise.all([
      prisma.client.findUnique({ where: { id: putSeed.client.id } }),
      prisma.client.findUnique({ where: { id: futureChangeSeed.client.id } }),
    ])
    expect(putClient).toMatchObject({ billingType: 'FLAT_RATE', cleanerPayType: 'FLAT_RATE' })
    expect(futureChangeClient).toMatchObject({ billingType: 'FLAT_RATE', cleanerPayType: 'FLAT_RATE' })
  })

  it('PUT rejects an end date before the effective start date', async () => {
    const start = utcDaysFromToday(2)
    const { schedule } = await seedSchedule('GUARD', start)

    const response = await putSchedule(
      req({ endDate: iso(addUtcDays(start, -1)) }, 'PUT'),
      { params: { id: schedule.id } },
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('end date')
  })
})
