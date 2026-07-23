import { describe, expect, it } from 'vitest'
import {
  computePauseInvoiceAdjustment,
  pauseDatesInPeriod,
  type PauseBillingSchedule,
} from '@/lib/pause-billing'

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

const MAY = {
  start: utc(2026, 5, 1),
  end: utc(2026, 5, 31),
}

function weeklyPause(overrides: Partial<PauseBillingSchedule> = {}): PauseBillingSchedule {
  return {
    id: 'schedule-1',
    locationId: 'location-1',
    frequency: 'WEEKLY',
    startDate: utc(2026, 5, 4),
    daysOfWeek: JSON.stringify([1]),
    monthlyPattern: null,
    customDates: null,
    defaultClientRate: 100,
    clientPayType: 'PER_CLEAN',
    pauseFrom: utc(2026, 5, 11),
    pauseTo: utc(2026, 5, 18),
    pauseName: 'School break',
    pauseBilling: 'FULL',
    pauseCreditMode: null,
    pauseCreditAmount: null,
    location: { name: 'Main campus' },
    ...overrides,
  }
}

describe('pause invoice adjustments', () => {
  it('uses the real cadence to bill paused per-clean visits at full rate', () => {
    const schedule = weeklyPause()

    expect(pauseDatesInPeriod(schedule, MAY.start, MAY.end)).toHaveLength(2)
    expect(computePauseInvoiceAdjustment(schedule, MAY.start, MAY.end)).toMatchObject({
      amount: 200,
      skippedCleanCount: 2,
      description: 'School break - 2 paused cleans billed at full rate',
    })
  })

  it('does not add an explicit adjustment for full-rate flat billing', () => {
    const adjustment = computePauseInvoiceAdjustment(
      weeklyPause({ clientPayType: 'FLAT_RATE', defaultClientRate: 400 }),
      MAY.start,
      MAY.end,
    )

    expect(adjustment).toBeNull()
  })

  it('calculates a day-based flat-rate credit and caps it at the monthly rate', () => {
    const adjustment = computePauseInvoiceAdjustment(
      weeklyPause({
        clientPayType: 'FLAT_RATE',
        defaultClientRate: 400,
        pauseFrom: utc(2026, 5, 11),
        pauseTo: utc(2026, 5, 17),
        pauseBilling: 'REDUCE',
        pauseCreditMode: 'DAYS',
      }),
      MAY.start,
      MAY.end,
    )

    expect(adjustment).toMatchObject({
      amount: -90.32,
      description: 'School break - 7-day pause credit',
    })
  })

  it('applies a custom flat-rate credit only in the period where the pause starts', () => {
    const schedule = weeklyPause({
      clientPayType: 'FLAT_RATE',
      defaultClientRate: 400,
      pauseBilling: 'REDUCE',
      pauseCreditMode: 'CUSTOM',
      pauseCreditAmount: 125,
    })

    expect(computePauseInvoiceAdjustment(schedule, MAY.start, MAY.end)).toMatchObject({
      amount: -125,
      description: 'School break - custom pause credit',
    })
    expect(computePauseInvoiceAdjustment(
      schedule,
      utc(2026, 6, 1),
      utc(2026, 6, 30),
    )).toBeNull()
  })

  it('leaves visit-based flat-rate credits to the proration reconciler', () => {
    const adjustment = computePauseInvoiceAdjustment(
      weeklyPause({
        clientPayType: 'FLAT_RATE',
        pauseBilling: 'REDUCE',
        pauseCreditMode: 'VISITS',
      }),
      MAY.start,
      MAY.end,
    )

    expect(adjustment).toBeNull()
  })
})
