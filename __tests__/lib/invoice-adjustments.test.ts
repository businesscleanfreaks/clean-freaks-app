import { describe, expect, it } from 'vitest'
import {
  parseMoney, perCleanValue, pctOffAmount, signedAmount,
  adjustmentsTotal, adjustedTotal, allApproved, pendingCount,
  sendBlockedReason, defaultLabel, isValidMode, type Adjustment,
} from '@/lib/invoice-adjustments'

const adj = (over: Partial<Adjustment> & { id: string }): Adjustment => ({
  mode: 'COURTESY', label: 'Credit', amount: -50, serviceDay: null, approved: true, ...over,
})

describe('parseMoney', () => {
  it('reads money the way an operator types it', () => {
    expect(parseMoney('$1,950')).toBe(1950)
    expect(parseMoney('1 950.50')).toBe(1950.50)
    expect(parseMoney('  42 ')).toBe(42)
    expect(parseMoney(75)).toBe(75)
  })

  it('returns null for nothing usable, so blank is not treated as zero', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('$')).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
  })

  it('distinguishes an explicit zero from blank', () => {
    expect(parseMoney('0')).toBe(0)
    expect(parseMoney('')).toBeNull()
  })
})

describe('signedAmount', () => {
  it('stores credits negative and charges positive regardless of how it was typed', () => {
    expect(signedAmount('COURTESY', '50')).toBe(-50)
    expect(signedAmount('COURTESY', '-50')).toBe(-50)
    expect(signedAmount('COMP', '$120.00')).toBe(-120)
    expect(signedAmount('CHARGE', '80')).toBe(80)
    expect(signedAmount('CHARGE', '-80')).toBe(80)
  })

  it('rejects a zero or empty amount rather than storing a no-op row', () => {
    expect(signedAmount('CHARGE', '0')).toBeNull()
    expect(signedAmount('COURTESY', '')).toBeNull()
    expect(signedAmount('COURTESY', 'abc')).toBeNull()
  })
})

describe('perCleanValue and pctOffAmount', () => {
  it('divides a per-clean invoice by its clean count', () => {
    expect(perCleanValue({ billingType: 'PER_CLEAN', total: 600, cleanCount: 4 })).toBe(150)
  })

  it('spreads a flat monthly rate across service days', () => {
    expect(perCleanValue({ billingType: 'FLAT_RATE', total: 2100, cleanCount: 0, flatServiceDays: 21 })).toBe(100)
  })

  it('never divides by zero', () => {
    expect(perCleanValue({ billingType: 'PER_CLEAN', total: 600, cleanCount: 0 })).toBe(0)
    expect(perCleanValue({ billingType: 'FLAT_RATE', total: 600, cleanCount: 0, flatServiceDays: 0 })).toBe(0)
  })

  it('computes a percentage off one clean', () => {
    expect(pctOffAmount(150, 20)).toBe(30)
    expect(pctOffAmount(133.33, 10)).toBe(13.33)
  })
})

describe('totals', () => {
  it('sums signed adjustments and applies them to the base total', () => {
    const list = [adj({ id: '1', amount: -50 }), adj({ id: '2', mode: 'CHARGE', amount: 80 })]
    expect(adjustmentsTotal(list)).toBe(30)
    expect(adjustedTotal(1000, list)).toBe(1030)
  })

  it('reduces the total when credits outweigh charges', () => {
    expect(adjustedTotal(1000, [adj({ id: '1', amount: -250 })])).toBe(750)
  })

  it('leaves the base total alone when there are no adjustments', () => {
    expect(adjustedTotal(1342, [])).toBe(1342)
  })

  it('avoids floating point drift', () => {
    expect(adjustedTotal(0.1, [adj({ id: '1', amount: 0.2 })])).toBe(0.3)
  })
})

describe('approval gates sending', () => {
  it('blocks sending until every adjustment is approved', () => {
    const list = [adj({ id: '1', approved: true }), adj({ id: '2', approved: false })]
    expect(allApproved(list)).toBe(false)
    expect(pendingCount(list)).toBe(1)
    expect(sendBlockedReason(list)).toBe('Approve 1 adjustment before sending')
  })

  it('pluralises the blocking reason', () => {
    const list = [adj({ id: '1', approved: false }), adj({ id: '2', approved: false })]
    expect(sendBlockedReason(list)).toBe('Approve 2 adjustments before sending')
  })

  it('allows sending once all are approved, and when there are none at all', () => {
    expect(sendBlockedReason([adj({ id: '1', approved: true })])).toBeNull()
    expect(allApproved([])).toBe(true)
    expect(sendBlockedReason([])).toBeNull()
  })
})

describe('labels and mode validation', () => {
  it('falls back to a readable label', () => {
    expect(defaultLabel('PCT_OFF', 12)).toBe('Discount · day 12')
    expect(defaultLabel('COMP', 3)).toBe('Comped clean · day 3')
    expect(defaultLabel('CHARGE', null)).toBe('Additional charge')
    expect(defaultLabel('COURTESY', null)).toBe('Courtesy credit')
  })

  it('validates modes', () => {
    expect(isValidMode('COMP')).toBe(true)
    expect(isValidMode('DISCOUNT')).toBe(false)
    expect(isValidMode(null)).toBe(false)
  })
})
