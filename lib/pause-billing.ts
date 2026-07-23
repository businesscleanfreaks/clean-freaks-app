import { calculateScheduleDates } from '@/lib/regenerate-schedule-jobs'
import { calculateDayPauseCredit, roundCurrency } from '@/lib/pause-credit'

export interface PauseBillingSchedule {
  id: string
  frequency: string
  startDate: Date
  daysOfWeek: string | null
  monthlyPattern: string | null
  customDates: string | null
  defaultClientRate: number
  clientPayType: string
  pauseFrom: Date | null
  pauseTo: Date | null
  pauseName: string | null
  pauseBilling: string | null
  pauseCreditMode: string | null
  pauseCreditAmount: number | null
  locationId: string
  location?: {
    name: string
    address?: string | null
  }
}

export interface PauseInvoiceAdjustment {
  scheduleId: string
  locationId: string
  locationName: string
  description: string
  amount: number
  skippedCleanCount: number
}

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
}

function maxDate(a: Date, b: Date) {
  return a > b ? a : b
}

function minDate(a: Date, b: Date) {
  return a < b ? a : b
}

function isWithin(date: Date, start: Date, end: Date) {
  return date >= start && date <= end
}

function daysInUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate()
}

function inclusiveUtcDays(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
}

export function pauseDatesInPeriod(
  schedule: PauseBillingSchedule,
  periodStart: Date,
  periodEnd: Date,
): Date[] {
  if (!schedule.pauseFrom) return []

  const start = maxDate(utcDateOnly(schedule.pauseFrom), utcDateOnly(periodStart))
  const pauseEnd = schedule.pauseTo ? utcDateOnly(schedule.pauseTo) : utcDateOnly(periodEnd)
  const end = minDate(pauseEnd, utcDateOnly(periodEnd))
  if (start > end) return []

  return calculateScheduleDates({
    frequency: schedule.frequency,
    startDate: schedule.startDate,
    endDate: end,
    daysOfWeek: schedule.daysOfWeek,
    monthlyPattern: schedule.monthlyPattern,
    customDates: schedule.customDates,
    excludedDates: null,
  }, end).filter((date) => date >= start && date <= end)
}

export function pausePolicyForDate(
  schedules: PauseBillingSchedule[],
  date: Date,
): PauseBillingSchedule | null {
  const target = utcDateOnly(date)

  return schedules.find((schedule) => {
    if (!schedule.pauseFrom) return false
    const pauseStart = utcDateOnly(schedule.pauseFrom)
    const pauseEnd = schedule.pauseTo ? utcDateOnly(schedule.pauseTo) : target
    return isWithin(target, pauseStart, pauseEnd)
  }) ?? null
}

/**
 * Returns the explicit invoice adjustment for a pause policy.
 *
 * Visit-based flat-rate credits stay in `computeClientProration`, where they
 * are compared with real jobs. A reduced per-clean pause needs no adjustment:
 * the skipped jobs do not exist, so the invoice is already reduced.
 */
export function computePauseInvoiceAdjustment(
  schedule: PauseBillingSchedule,
  periodStart: Date,
  periodEnd: Date,
): PauseInvoiceAdjustment | null {
  if (!schedule.pauseFrom) return null

  const billing = schedule.pauseBilling ?? 'REDUCE'
  const creditMode = schedule.pauseCreditMode ?? 'VISITS'
  const locationName = schedule.location?.name
    || schedule.location?.address?.split(',')[0]
    || 'Location'
  const pauseLabel = schedule.pauseName?.trim() || 'schedule pause'
  const pauseDates = pauseDatesInPeriod(schedule, periodStart, periodEnd)

  if (billing === 'FULL' && schedule.clientPayType === 'PER_CLEAN') {
    const amount = roundCurrency(pauseDates.length * schedule.defaultClientRate)
    if (amount <= 0) return null
    return {
      scheduleId: schedule.id,
      locationId: schedule.locationId,
      locationName,
      description: `${pauseLabel} - ${pauseDates.length} paused clean${pauseDates.length === 1 ? '' : 's'} billed at full rate`,
      amount,
      skippedCleanCount: pauseDates.length,
    }
  }

  if (billing !== 'REDUCE' || schedule.clientPayType !== 'FLAT_RATE') return null

  if (creditMode === 'CUSTOM') {
    const pauseFrom = utcDateOnly(schedule.pauseFrom)
    if (!isWithin(pauseFrom, utcDateOnly(periodStart), utcDateOnly(periodEnd))) return null
    const amount = roundCurrency(Math.min(schedule.defaultClientRate, schedule.pauseCreditAmount ?? 0))
    if (amount <= 0) return null
    return {
      scheduleId: schedule.id,
      locationId: schedule.locationId,
      locationName,
      description: `${pauseLabel} - custom pause credit`,
      amount: -amount,
      skippedCleanCount: pauseDates.length,
    }
  }

  if (creditMode === 'DAYS') {
    const overlapStart = maxDate(utcDateOnly(schedule.pauseFrom), utcDateOnly(periodStart))
    const pauseEnd = schedule.pauseTo ? utcDateOnly(schedule.pauseTo) : utcDateOnly(periodEnd)
    const overlapEnd = minDate(pauseEnd, utcDateOnly(periodEnd))
    if (overlapStart > overlapEnd) return null

    const overlapDays = inclusiveUtcDays(overlapStart, overlapEnd)
    const amount = calculateDayPauseCredit(
      schedule.defaultClientRate,
      overlapDays,
      daysInUtcMonth(periodStart),
    )
    if (amount <= 0) return null
    return {
      scheduleId: schedule.id,
      locationId: schedule.locationId,
      locationName,
      description: `${pauseLabel} - ${overlapDays}-day pause credit`,
      amount: -amount,
      skippedCleanCount: pauseDates.length,
    }
  }

  return null
}
