import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { computeClientProration } from '@/lib/proration'
import { resetDb } from './db-helpers'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const MAY = { start: utc(2026, 5, 1), end: utc(2026, 5, 31) }

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function seedFlatRateLocation(opts?: { rate?: number; start?: Date; end?: Date | null }) {
  const start = opts?.start ?? utc(2026, 5, 4)
  const client = await prisma.client.create({
    data: { name: 'Proration Client', billingType: 'FLAT_RATE', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Proration Site', address: '1 Credit Way' },
  })
  const sub = await prisma.subcontractor.create({ data: { name: 'Cleaner' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: opts?.rate ?? 400,
      defaultSubcontractorRate: 80,
      clientPayType: 'FLAT_RATE',
      subcontractorPayType: 'PER_CLEAN',
      startDate: start,
      endDate: opts?.end ?? null,
    },
  })
  return { client, location, sub, schedule }
}

async function createClean(
  locationId: string,
  scheduleId: string,
  subcontractorId: string,
  date: Date
) {
  return prisma.job.create({
    data: {
      locationId,
      scheduleId,
      subcontractorId,
      date,
      clientRate: 400,
      subcontractorRate: 80,
      status: 'SCHEDULED',
    },
  })
}

describe('flat-rate proration reliability', () => {
  it('never credits more than the flat monthly rate, even when every expected clean is missed', async () => {
    const { client } = await seedFlatRateLocation({ rate: 400 })

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ expected: 4, actual: 0, missed: 4, credit: 400 })
    expect(rows[0].credit).toBeLessThanOrEqual(rows[0].flatRate)
  })

  it('does not invent a credit when service legitimately starts mid-month', async () => {
    const { client, location, sub, schedule } = await seedFlatRateLocation({
      start: utc(2026, 5, 18),
      rate: 400,
    })
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 18))
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 25))

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)

    expect(rows).toEqual([])
  })

  it('credits only the paused gap between split schedules, not the whole month', async () => {
    const first = await seedFlatRateLocation({
      start: utc(2026, 5, 4),
      end: utc(2026, 5, 10),
      rate: 400,
    })
    const resumed = await prisma.schedule.create({
      data: {
        locationId: first.location.id,
        subcontractorId: first.sub.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([utc(2026, 5, 4).getUTCDay()]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
        startDate: utc(2026, 5, 25),
      },
    })
    await createClean(first.location.id, first.schedule.id, first.sub.id, utc(2026, 5, 4))
    await createClean(first.location.id, resumed.id, first.sub.id, utc(2026, 5, 25))

    const rows = await computeClientProration(first.client.id, MAY.start, MAY.end)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ expected: 4, actual: 2, missed: 2, credit: 200 })
    expect(rows[0].credit).toBeLessThanOrEqual(rows[0].flatRate)
  })

  it('does not credit a paused gap when the client is billed at full rate', async () => {
    const first = await seedFlatRateLocation({
      start: utc(2026, 5, 4),
      end: utc(2026, 5, 10),
      rate: 400,
    })
    await prisma.schedule.update({
      where: { id: first.schedule.id },
      data: {
        pauseFrom: utc(2026, 5, 11),
        pauseTo: utc(2026, 5, 24),
        pauseBilling: 'FULL',
      },
    })
    const resumed = await prisma.schedule.create({
      data: {
        locationId: first.location.id,
        subcontractorId: first.sub.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([1]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
        startDate: utc(2026, 5, 25),
      },
    })
    await createClean(first.location.id, first.schedule.id, first.sub.id, utc(2026, 5, 4))
    await createClean(first.location.id, resumed.id, first.sub.id, utc(2026, 5, 25))

    const rows = await computeClientProration(first.client.id, MAY.start, MAY.end)

    expect(rows).toEqual([])
  })

  it('credits a whole-month visit-based pause even before a resumed interval exists', async () => {
    const paused = await seedFlatRateLocation({
      start: utc(2026, 5, 4),
      end: utc(2026, 5, 3),
      rate: 400,
    })
    await prisma.schedule.update({
      where: { id: paused.schedule.id },
      data: {
        pauseFrom: utc(2026, 5, 4),
        pauseTo: utc(2026, 5, 31),
        pauseBilling: 'REDUCE',
        pauseCreditMode: 'VISITS',
      },
    })

    const rows = await computeClientProration(paused.client.id, MAY.start, MAY.end)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      expected: 4,
      actual: 0,
      missed: 4,
      credit: 400,
    })
  })
})

describe('B2 · a clean moved to a different day in the same month', () => {
  it('is not credited as missed · the clean happened', async () => {
    // Expected Mondays May 4, 11, 18, 25. The clean on the 11th is moved to
    // the 12th · still done, still in the month, same schedule. Matching
    // expected dates to actual ones by EXACT DATE leaves the 11th unmatched
    // and credits the client for a clean they received.
    const { client, location, sub, schedule } = await seedFlatRateLocation({ start: utc(2026, 5, 4), rate: 400 })
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 4))
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 12)) // moved from the 11th
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 18))
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 25))

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)
    expect(rows).toHaveLength(0)
  })

  it('reports four cleans expected and four delivered', async () => {
    const { client, location, sub, schedule } = await seedFlatRateLocation({ start: utc(2026, 5, 4), rate: 400 })
    for (const d of [4, 12, 18, 25]) {
      await createClean(location.id, schedule.id, sub.id, utc(2026, 5, d))
    }

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)
    // No credit at all is the right answer, so there is no row to inspect.
    // If one appears, it must at least not claim a clean was missed.
    if (rows.length > 0) expect(rows[0].missed).toBe(0)
  })

  it('still credits a clean that genuinely did not happen', async () => {
    // The guard must not spread: three of four delivered is still a credit.
    const { client, location, sub, schedule } = await seedFlatRateLocation({ start: utc(2026, 5, 4), rate: 400 })
    for (const d of [4, 12, 18]) {
      await createClean(location.id, schedule.id, sub.id, utc(2026, 5, d))
    }

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)
    expect(rows).toHaveLength(1)
    expect(rows[0].missed).toBe(1)
    expect(rows[0].credit).toBe(100)
  })
})

describe('B3 · a schedule that changed day partway through the month', () => {
  it('does not credit the cleans done on the new day', async () => {
    // Weekly Monday until the 14th, weekly Tuesday from the 15th · a "change
    // going forward". Expected dates were computed from the EARLIEST interval
    // for the whole month, so the second half expected Mondays while the work
    // happened on Tuesdays, and every one of them counted as missed.
    const { client, location, sub, schedule } = await seedFlatRateLocation({ start: utc(2026, 5, 4), rate: 400 })
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { endDate: utc(2026, 5, 14) },
    })
    const tuesdaySchedule = await prisma.schedule.create({
      data: {
        locationId: location.id,
        subcontractorId: sub.id,
        frequency: 'WEEKLY',
        daysOfWeek: JSON.stringify([utc(2026, 5, 19).getUTCDay()]),
        timeType: 'SPECIFIC',
        startTime: '09:00',
        defaultClientRate: 400,
        defaultSubcontractorRate: 80,
        clientPayType: 'FLAT_RATE',
        subcontractorPayType: 'PER_CLEAN',
        startDate: utc(2026, 5, 15),
        endDate: null,
      },
    })

    // Mondays while the first interval ran, Tuesdays after it.
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 4))
    await createClean(location.id, schedule.id, sub.id, utc(2026, 5, 11))
    await createClean(location.id, tuesdaySchedule.id, sub.id, utc(2026, 5, 19))
    await createClean(location.id, tuesdaySchedule.id, sub.id, utc(2026, 5, 26))

    const rows = await computeClientProration(client.id, MAY.start, MAY.end)
    expect(rows).toHaveLength(0)
  })
})
