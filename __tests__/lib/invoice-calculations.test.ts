import { describe, it, expect } from 'vitest'
import {
  generatePerCleanLineItems,
  generateFlatRateLineItems,
  calculateReadyToBillTotal,
  type InvoiceJob,
} from '@/lib/invoice-calculations'

// A minimal valid job; override only what each test cares about.
function job(over: Partial<InvoiceJob> = {}): InvoiceJob {
  return {
    id: 'j1',
    date: new Date('2026-05-04T12:00:00Z'),
    clientRate: 100,
    scheduleId: 's1',
    status: 'SCHEDULED',
    location: { name: 'Office A' },
    addOnServices: [],
    schedule: { defaultClientRate: 400, recurringAddOnServices: [] },
    ...over,
  }
}

describe('PER_CLEAN invoicing', () => {
  it('bills one line per non-cancelled clean, plus a line per add-on', () => {
    const jobs = [
      job({ id: 'a', clientRate: 120, addOnServices: [{ id: 'x', description: 'Windows', clientRate: 30 }] }),
      job({ id: 'b', clientRate: 100 }),
      job({ id: 'c', clientRate: 100, status: 'CANCELLED' }), // must be excluded
    ]
    const items = generatePerCleanLineItems(jobs)

    expect(items.length).toBe(3) // a (clean+addon) + b (clean); c excluded
    expect(calculateReadyToBillTotal(jobs, 'PER_CLEAN')).toBe(120 + 30 + 100)
  })

  it('a cancelled clean never reaches the total', () => {
    const jobs = [job({ id: 'a', clientRate: 100 }), job({ id: 'b', clientRate: 100, status: 'CANCELLED' })]
    expect(calculateReadyToBillTotal(jobs, 'PER_CLEAN')).toBe(100)
  })
})

describe('FLAT_RATE invoicing', () => {
  it('bills the monthly schedule rate ONCE, no matter how many cleans happened', () => {
    const jobs = [
      job({ id: 'a', scheduleId: 's1', clientRate: 999, schedule: { defaultClientRate: 400, recurringAddOnServices: [] } }),
      job({ id: 'b', scheduleId: 's1', clientRate: 999, schedule: { defaultClientRate: 400, recurringAddOnServices: [] } }),
      job({ id: 'c', scheduleId: 's1', clientRate: 999, schedule: { defaultClientRate: 400, recurringAddOnServices: [] } }),
    ]
    const monthlyLines = generateFlatRateLineItems(jobs).filter((i) => i.description.startsWith('Monthly Cleaning'))

    expect(monthlyLines.length).toBe(1)
    expect(monthlyLines[0].amount).toBe(400) // schedule rate — not the per-job rate, not x3
    expect(calculateReadyToBillTotal(jobs, 'FLAT_RATE')).toBe(400)
  })

  it('bills a recurring add-on once per schedule per month', () => {
    const recurring = [{ id: 'r1', description: 'Carpets', clientRate: 50 }]
    const jobs = [
      job({ id: 'a', scheduleId: 's1', schedule: { defaultClientRate: 400, recurringAddOnServices: recurring } }),
      job({ id: 'b', scheduleId: 's1', schedule: { defaultClientRate: 400, recurringAddOnServices: recurring } }),
    ]
    expect(calculateReadyToBillTotal(jobs, 'FLAT_RATE')).toBe(400 + 50)
  })

  it('adds one-time add-ons and one-off jobs on top of the flat rate', () => {
    const jobs = [
      job({
        id: 'a',
        scheduleId: 's1',
        schedule: { defaultClientRate: 400, recurringAddOnServices: [] },
        addOnServices: [{ id: 't1', description: 'Deep clean', clientRate: 75 }],
      }),
      job({ id: 'off', scheduleId: null, clientRate: 200, schedule: null, addOnServices: [] }), // one-off
    ]
    // 400 flat + 75 one-time add-on + 200 one-off = 675
    expect(calculateReadyToBillTotal(jobs, 'FLAT_RATE')).toBe(675)
  })
})
