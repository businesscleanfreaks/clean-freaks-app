import { describe, it, expect } from 'vitest'
import { buildSubcontractorPayLedger } from '@/lib/payout-calculator'

// Minimal cleaner-pay job; override only what each test needs.
function job(over: Record<string, any> = {}) {
  return {
    id: 'j1',
    date: new Date('2026-05-04T12:00:00Z'),
    scheduleId: 's1',
    subcontractorId: 'CL1',
    subcontractorPaid: false,
    subcontractorRate: 999,
    location: { id: 'L1', name: 'Office', client: { id: 'C1', name: 'Acme', cleanerPayType: 'FLAT_RATE' } },
    schedule: { subcontractorPayType: 'FLAT_RATE', defaultSubcontractorRate: 300 },
    addOnServices: [] as any[],
    ...over,
  }
}

describe('cleaner payout — FLAT_RATE', () => {
  it('owes the monthly rate ONCE no matter how many cleans, while any are unpaid', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]
    const { totalOwed, groups } = buildSubcontractorPayLedger(jobs)
    expect(groups.length).toBe(1)
    expect(totalOwed).toBe(300) // once — not 3x, not the per-job 999
  })

  it('owes nothing once every clean in the month is paid', () => {
    const jobs = [job({ id: 'a', subcontractorPaid: true }), job({ id: 'b', subcontractorPaid: true })]
    expect(buildSubcontractorPayLedger(jobs).totalOwed).toBe(0)
  })
})

describe('cleaner payout — PER_CLEAN', () => {
  it('owes each unpaid clean its own rate; paid cleans drop off', () => {
    const perClean = (over: Record<string, any>) =>
      job({ subcontractorRate: 80, schedule: { subcontractorPayType: 'PER_CLEAN' }, ...over })
    const jobs = [
      perClean({ id: 'a' }),
      perClean({ id: 'b' }),
      perClean({ id: 'c', subcontractorPaid: true }),
    ]
    expect(buildSubcontractorPayLedger(jobs).totalOwed).toBe(160) // a + b; c already paid
  })
})

describe('cleaner payout — add-on credit rules (who actually gets paid)', () => {
  it('credits the job cleaner only for add-ons nobody else performed', () => {
    const j = job({
      id: 'a',
      subcontractorRate: 80,
      subcontractorId: 'CL1',
      schedule: { subcontractorPayType: 'PER_CLEAN' },
      addOnServices: [
        { subcontractorRate: 10, vendorId: null, subcontractorId: null }, // unassigned → credited
        { subcontractorRate: 20, vendorId: null, subcontractorId: 'CL1' }, // same cleaner → credited
        { subcontractorRate: 40, vendorId: null, subcontractorId: 'CL2' }, // a DIFFERENT cleaner → NOT credited
        { subcontractorRate: 50, vendorId: 'V1', subcontractorId: null }, // an outside vendor → NOT credited
      ],
    })
    // 80 base + 10 + 20 = 110
    expect(buildSubcontractorPayLedger([j]).totalOwed).toBe(110)
  })
})
