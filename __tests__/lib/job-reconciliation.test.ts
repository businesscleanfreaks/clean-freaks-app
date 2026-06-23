import { describe, it, expect } from 'vitest'
import {
  planScheduleJobReconciliation,
  type ReconciliationSchedule,
  type ReconciliationJob,
} from '@/lib/regenerate-schedule-jobs'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
const iso = (d: Date) => d.toISOString().slice(0, 10)

function makeSchedule(over: Partial<ReconciliationSchedule> = {}): ReconciliationSchedule {
  return {
    id: 's1',
    locationId: 'L1',
    subcontractorId: 'CL1',
    frequency: 'WEEKLY',
    daysOfWeek: JSON.stringify([utc(2026, 5, 4).getUTCDay()]),
    monthlyPattern: null,
    customDates: null,
    excludedDates: null,
    startDate: utc(2026, 5, 4),
    endDate: null,
    defaultClientRate: 100,
    defaultSubcontractorRate: 60,
    timeType: 'SPECIFIC',
    startTime: '09:00',
    startWindowBegin: null,
    startWindowEnd: null,
    location: { client: { startDate: null } },
    ...over,
  }
}

function makeJob(date: Date, over: Partial<ReconciliationJob> = {}): ReconciliationJob {
  return { id: `j-${iso(date)}`, date, startTime: '09:00', startWindowBegin: null, invoiceLineItems: [], ...over }
}

describe('reconciliation is additive — fills gaps', () => {
  it('creates the missing pattern cleans when none exist yet', () => {
    const plan = planScheduleJobReconciliation([makeSchedule()], new Map(), utc(2026, 5, 4), utc(2026, 5, 31))
    expect(plan.toCreate.length).toBeGreaterThan(0)
    expect(plan.toCreate.every((c) => c.scheduleId === 's1')).toBe(true)
    expect(plan.skippedCount).toBe(0)
  })

  it('skips pattern cleans that already exist (no duplicates created)', () => {
    const wanted = planScheduleJobReconciliation([makeSchedule()], new Map(), utc(2026, 5, 4), utc(2026, 5, 31)).toCreate
    const existing = new Map<string, ReconciliationJob[]>([['s1', wanted.map((c) => makeJob(c.date))]])
    const plan = planScheduleJobReconciliation([makeSchedule()], existing, utc(2026, 5, 4), utc(2026, 5, 31))
    expect(plan.toCreate.length).toBe(0)
    expect(plan.skippedCount).toBe(wanted.length)
  })
})

describe('reconciliation never deletes — a legitimately-added extra clean survives', () => {
  it('leaves an off-pattern extra clean untouched and offers no deletion', () => {
    const wanted = planScheduleJobReconciliation([makeSchedule()], new Map(), utc(2026, 5, 4), utc(2026, 5, 31)).toCreate
    const extra = makeJob(utc(2026, 5, 6), { id: 'extra-clean' }) // off-pattern (different weekday)
    const existing = new Map<string, ReconciliationJob[]>([['s1', [...wanted.map((c) => makeJob(c.date)), extra]]])

    const plan = planScheduleJobReconciliation([makeSchedule()], existing, utc(2026, 5, 4), utc(2026, 5, 31))

    // The plan has NO concept of deletion — additive-only by construction.
    expect('toDelete' in plan).toBe(false)
    // The extra clean is neither recreated nor removed; it simply persists.
    expect(plan.toCreate.map((c) => iso(c.date))).not.toContain(iso(extra.date))
    expect(plan.toCreate.length).toBe(0)
  })
})

describe('split schedule does not regenerate pre-start duplicates', () => {
  it('a non-baseline (split) schedule only creates cleans on/after its own start', () => {
    const baseline = makeSchedule({ id: 's-old', startDate: utc(2026, 4, 1), location: { client: { startDate: utc(2026, 1, 1) } } })
    const split = makeSchedule({ id: 's-new', startDate: utc(2026, 6, 11), location: { client: { startDate: utc(2026, 1, 1) } } })

    const plan = planScheduleJobReconciliation([baseline, split], new Map(), utc(2026, 6, 1), utc(2026, 6, 30))
    const splitCreated = plan.toCreate.filter((c) => c.scheduleId === 's-new')

    expect(splitCreated.length).toBeGreaterThan(0)
    for (const c of splitCreated) {
      expect(c.date.getTime()).toBeGreaterThanOrEqual(utc(2026, 6, 11).getTime())
    }
  })
})
