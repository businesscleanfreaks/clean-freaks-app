import { describe, expect, it } from 'vitest'
import { markFor, buildDayMap, countByMark, type ScheduleCheckClean } from '@/components/invoices/workspace/schedule-check'

const clean = (over: Partial<ScheduleCheckClean> & { date: string }): ScheduleCheckClean => ({
  status: 'SCHEDULED', ...over,
})

describe('markFor', () => {
  it('marks a cancelled or skipped clean as cancelled, whatever else it is', () => {
    expect(markFor(clean({ date: '2026-06-03', status: 'CANCELLED' }))).toBe('cancelled')
    expect(markFor(clean({ date: '2026-06-03', status: 'SKIPPED' }))).toBe('cancelled')
    // Cancellation wins even for one-off work.
    expect(markFor(clean({ date: '2026-06-03', status: 'CANCELLED', isOneOff: true }))).toBe('cancelled')
  })

  it('marks unscheduled work as a one-off', () => {
    expect(markFor(clean({ date: '2026-06-04', status: 'COMPLETED', isOneOff: true }))).toBe('oneoff')
  })

  it('distinguishes completed from still-scheduled routine cleans', () => {
    expect(markFor(clean({ date: '2026-06-05', status: 'COMPLETED' }))).toBe('completed')
    expect(markFor(clean({ date: '2026-06-06', status: 'SCHEDULED' }))).toBe('scheduled')
  })
})

describe('buildDayMap', () => {
  it('keeps only cleans inside the given month', () => {
    const map = buildDayMap('2026-06', [
      clean({ date: '2026-06-10', status: 'COMPLETED' }),
      clean({ date: '2026-05-10', status: 'COMPLETED' }),
      clean({ date: '2026-07-10', status: 'COMPLETED' }),
    ])
    expect([...map.keys()]).toEqual([10])
  })

  it('ignores unparseable dates instead of throwing', () => {
    const map = buildDayMap('2026-06', [clean({ date: 'not-a-date' })])
    expect(map.size).toBe(0)
  })

  it('shows the most meaningful mark when a day has several cleans', () => {
    // A real visit outranks a cancellation on the same day.
    const map = buildDayMap('2026-06', [
      clean({ date: '2026-06-12', status: 'CANCELLED' }),
      clean({ date: '2026-06-12', status: 'COMPLETED' }),
    ])
    expect(map.get(12)?.mark).toBe('completed')
  })

  it('calls out a one-off over a routine scheduled clean', () => {
    const map = buildDayMap('2026-06', [
      clean({ date: '2026-06-15', status: 'SCHEDULED' }),
      clean({ date: '2026-06-15', status: 'SCHEDULED', isOneOff: true }),
    ])
    expect(map.get(15)?.mark).toBe('oneoff')
  })

  it('carries the job id so the day can deep-link', () => {
    const map = buildDayMap('2026-06', [clean({ date: '2026-06-20', status: 'COMPLETED', jobId: 'job-1' })])
    expect(map.get(20)?.jobId).toBe('job-1')
  })
})

describe('countByMark', () => {
  it('counts each mark once per day', () => {
    const map = buildDayMap('2026-06', [
      clean({ date: '2026-06-01', status: 'COMPLETED' }),
      clean({ date: '2026-06-02', status: 'COMPLETED' }),
      clean({ date: '2026-06-03', status: 'CANCELLED' }),
      clean({ date: '2026-06-04', status: 'SCHEDULED', isOneOff: true }),
    ])
    expect(countByMark(map)).toEqual({ completed: 2, scheduled: 0, cancelled: 1, oneoff: 1 })
  })

  it('returns zeros for an empty month', () => {
    expect(countByMark(buildDayMap('2026-06', []))).toEqual({ completed: 0, scheduled: 0, cancelled: 0, oneoff: 0 })
  })
})
