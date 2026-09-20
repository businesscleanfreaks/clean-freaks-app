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
  return { id: `j-${iso(date)}`, date, startTime: '09:00', startWindowBegin: null, ...over }
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

describe('repairing a clean that has no time on it', () => {
  const timed = () => makeSchedule({ startTime: '09:00' })

  it('fills in the missing time', () => {
    const untimed = makeJob(utc(2026, 5, 4), { startTime: null })
    const plan = planScheduleJobReconciliation(
      [timed()],
      new Map([['s1', [untimed]]]),
      utc(2026, 5, 4),
      utc(2026, 5, 4),
    )
    expect(plan.toRepair.flatMap(r => r.ids)).toContain(untimed.id)
  })

  it('leaves a clean alone once it is on a sent or paid invoice · never edit billed work', () => {
    const untimed = makeJob(utc(2026, 5, 4), { startTime: null })
    const plan = planScheduleJobReconciliation(
      [timed()],
      new Map([['s1', [untimed]]]),
      utc(2026, 5, 4),
      utc(2026, 5, 4),
      new Set([untimed.id]),
    )
    expect(plan.toRepair.flatMap(r => r.ids)).not.toContain(untimed.id)
  })

  const planFor = (job: ReconciliationJob) =>
    planScheduleJobReconciliation(
      [timed()],
      new Map([['s1', [job]]]),
      utc(2026, 5, 4),
      utc(2026, 5, 4),
    )

  it('repairs the time and nothing else', () => {
    // The reported defect: a job was selected for having no TIME and then had
    // its cleaner and BOTH RATES reset to the schedule defaults. The two have
    // nothing to do with each other, and because reconciliation runs on
    // ordinary reads, opening the calendar undid a rate agreed for one clean.
    const untimed = makeJob(utc(2026, 5, 4), { startTime: null })
    const [repair] = planFor(untimed).toRepair

    expect(Object.keys(repair.data).sort())
      .toEqual(['startTime', 'startWindowBegin', 'startWindowEnd'])
  })

  it('never touches a clean the cleaner has been paid for', () => {
    const paid = makeJob(utc(2026, 5, 4), { startTime: null, subcontractorPaid: true })
    expect(planFor(paid).toRepair.flatMap(r => r.ids)).not.toContain(paid.id)
  })

  it('never touches a clean the vendor has been paid for', () => {
    const paid = makeJob(utc(2026, 5, 4), { startTime: null, vendorPaid: true })
    expect(planFor(paid).toRepair.flatMap(r => r.ids)).not.toContain(paid.id)
  })

  it('never touches a cancelled clean · it is a record, not a plan', () => {
    const cancelled = makeJob(utc(2026, 5, 4), { startTime: null, status: 'CANCELLED' })
    expect(planFor(cancelled).toRepair.flatMap(r => r.ids)).not.toContain(cancelled.id)
  })

  it('still repairs an ordinary scheduled clean', () => {
    // The guard must not spread: filling in a missing time is the point.
    const ordinary = makeJob(utc(2026, 5, 4), { startTime: null, status: 'SCHEDULED' })
    expect(planFor(ordinary).toRepair.flatMap(r => r.ids)).toContain(ordinary.id)
  })

  it('still repairs a completed clean that nobody has been paid for', () => {
    const done = makeJob(utc(2026, 5, 4), { startTime: null, status: 'COMPLETED' })
    expect(planFor(done).toRepair.flatMap(r => r.ids)).toContain(done.id)
  })
})
