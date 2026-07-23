import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing-settings', () => ({
  getBillingStartDate: async () => new Date(Date.UTC(2026, 4, 1, 12, 0, 0)),
}))

import { prisma } from '@/lib/db'
import { GET as getCandidates } from '@/app/api/invoices/candidates/route'
import { resetDb } from './db-helpers'

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function seedClient(billingType: 'FLAT_RATE' | 'PER_CLEAN') {
  const client = await prisma.client.create({
    data: {
      name: `${billingType} Pause Client`,
      billingType,
      cleanerPayType: 'PER_CLEAN',
      invoicingEmail: 'billing@example.com',
    },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Main site', address: '1 Pause Way' },
  })
  const subcontractor = await prisma.subcontractor.create({
    data: { name: 'Pause Cleaner' },
  })
  return { client, location, subcontractor }
}

function candidatesRequest() {
  return new Request(
    'http://test/api/invoices/candidates?start=2026-05-01&end=2026-05-31',
  )
}

describe('pause billing in invoice candidates', () => {
  it('bills one flat monthly rate across split intervals and applies one custom credit', async () => {
    const { client, location, subcontractor } = await seedClient('FLAT_RATE')
    const ended = await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: subcontractor.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([1]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        startDate: utc(2026, 5, 4),
        endDate: utc(2026, 5, 10),
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
        pauseFrom: utc(2026, 5, 11),
        pauseTo: utc(2026, 5, 17),
        pauseName: 'School break',
        pauseBilling: 'REDUCE',
        pauseCreditMode: 'CUSTOM',
        pauseCreditAmount: 100,
      },
    })
    const resumed = await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: subcontractor.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([1]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        startDate: utc(2026, 5, 18),
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
      },
    })
    await prisma.job.createMany({
      data: [
        {
          locationId: location.id,
          scheduleId: ended.id,
          subcontractorId: subcontractor.id,
          date: utc(2026, 5, 4),
          clientRate: 400,
          subcontractorRate: 80,
        },
        {
          locationId: location.id,
          scheduleId: resumed.id,
          subcontractorId: subcontractor.id,
          date: utc(2026, 5, 18),
          clientRate: 400,
          subcontractorRate: 80,
        },
      ],
    })

    const response = await getCandidates(candidatesRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    const candidate = payload.candidates.find(
      (item: { clientId: string }) => item.clientId === client.id,
    )

    expect(candidate).toBeTruthy()
    expect(candidate.lineItems.filter(
      (item: { sourceType: string }) => item.sourceType === 'FLAT_RATE',
    )).toHaveLength(1)
    expect(candidate.lineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'PAUSE_ADJUSTMENT',
        price: -100,
        description: 'School break - custom pause credit',
      }),
    ]))
    expect(candidate.total).toBe(300)
  })

  it('creates a full-rate per-clean candidate even when the pause removed every job', async () => {
    const { client, location, subcontractor } = await seedClient('PER_CLEAN')
    await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: subcontractor.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([1]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        startDate: utc(2026, 5, 4),
        endDate: utc(2026, 5, 3),
        defaultClientRate: 100,
        defaultSubcontractorRate: 60,
        clientPayType: 'PER_CLEAN',
        subcontractorPayType: 'PER_CLEAN',
        pauseFrom: utc(2026, 5, 4),
        pauseTo: utc(2026, 5, 31),
        pauseName: 'Client closure',
        pauseBilling: 'FULL',
      },
    })

    const response = await getCandidates(candidatesRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    const candidate = payload.candidates.find(
      (item: { clientId: string }) => item.clientId === client.id,
    )

    expect(candidate).toMatchObject({
      billingType: 'PER_CLEAN',
      total: 400,
      jobCount: 0,
    })
    expect(candidate.lineItems).toEqual([
      expect.objectContaining({
        sourceType: 'PAUSE_ADJUSTMENT',
        price: 400,
        description: 'Client closure - 4 paused cleans billed at full rate',
      }),
    ])
  })

  it('keeps the monthly flat charge during a full-rate pause with no resumed interval', async () => {
    const { client, location, subcontractor } = await seedClient('FLAT_RATE')
    await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: subcontractor.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([1]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        startDate: utc(2026, 5, 4),
        endDate: utc(2026, 5, 3),
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
        pauseFrom: utc(2026, 5, 4),
        pauseTo: utc(2026, 5, 31),
        pauseName: 'Summer closure',
        pauseBilling: 'FULL',
      },
    })

    const response = await getCandidates(candidatesRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    const candidate = payload.candidates.find(
      (item: { clientId: string }) => item.clientId === client.id,
    )

    expect(candidate).toMatchObject({
      billingType: 'FLAT_RATE',
      total: 400,
      jobCount: 0,
    })
    expect(candidate.lineItems).toEqual([
      expect.objectContaining({
        sourceType: 'FLAT_RATE',
        price: 400,
      }),
    ])
  })

  it('does not merge independent flat-rate schedules at the same location', async () => {
    const { client, location, subcontractor } = await seedClient('FLAT_RATE')
    await prisma.schedule.createMany({
      data: [
        {
          locationId: location.id,
          subcontractorId: subcontractor.id,
          frequency: 'WEEKLY',
          daysOfWeek: JSON.stringify([1]),
          timeType: 'SPECIFIC',
          startTime: '09:00',
          startDate: utc(2026, 5, 4),
          defaultClientRate: 400,
          defaultSubcontractorRate: 80,
          clientPayType: 'FLAT_RATE',
          subcontractorPayType: 'PER_CLEAN',
        },
        {
          locationId: location.id,
          subcontractorId: subcontractor.id,
          frequency: 'BI_WEEKLY',
          daysOfWeek: JSON.stringify([2]),
          timeType: 'SPECIFIC',
          startTime: '13:00',
          startDate: utc(2026, 5, 5),
          defaultClientRate: 250,
          defaultSubcontractorRate: 60,
          clientPayType: 'FLAT_RATE',
          subcontractorPayType: 'PER_CLEAN',
        },
      ],
    })

    const response = await getCandidates(candidatesRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    const clientCandidates = payload.candidates.filter(
      (item: { clientId: string }) => item.clientId === client.id,
    )

    expect(clientCandidates).toHaveLength(2)
    expect(clientCandidates.map(
      (candidate: { total: number }) => candidate.total,
    ).sort((a: number, b: number) => a - b)).toEqual([250, 400])
  })
})
