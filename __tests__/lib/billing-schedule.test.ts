import { describe, expect, it } from 'vitest'
import { validateUpdate, locationPillLabel, type BillingScheduleRow } from '@/lib/billing-schedule'

const ok = (r: ReturnType<typeof validateUpdate>) => {
  if ('error' in r) throw new Error(`expected success, got: ${r.error}`)
  return r.data
}

describe('validateUpdate', () => {
  it('accepts every known option', () => {
    expect(ok(validateUpdate({ clientType: 'COMMERCIAL' }))).toEqual({ clientType: 'COMMERCIAL' })
    expect(ok(validateUpdate({ cadence: 'END_OF_MONTH' }))).toEqual({ cadence: 'END_OF_MONTH' })
    expect(ok(validateUpdate({ terms: 'NET_15' }))).toEqual({ terms: 'NET_15' })
    expect(ok(validateUpdate({ payMethod: 'PORTAL' }))).toEqual({ payMethod: 'PORTAL' })
    expect(ok(validateUpdate({ delivery: 'TRACK_ONLY' }))).toEqual({ delivery: 'TRACK_ONLY' })
    expect(ok(validateUpdate({ separateLocationInvoices: true }))).toEqual({ separateLocationInvoices: true })
  })

  it('allows clearing the optional fields back to "not set"', () => {
    expect(ok(validateUpdate({ terms: null }))).toEqual({ terms: null })
    expect(ok(validateUpdate({ payMethod: null }))).toEqual({ payMethod: null })
    expect(ok(validateUpdate({ clientType: null }))).toEqual({ clientType: null })
  })

  it('rejects unknown values rather than silently writing them', () => {
    expect(validateUpdate({ clientType: 'INDUSTRIAL' })).toMatchObject({ error: expect.stringMatching(/client type/i) })
    expect(validateUpdate({ cadence: 'DAILY' })).toMatchObject({ error: expect.stringMatching(/cadence/i) })
    expect(validateUpdate({ terms: 'NET_45' })).toMatchObject({ error: expect.stringMatching(/terms/i) })
    expect(validateUpdate({ payMethod: 'CRYPTO' })).toMatchObject({ error: expect.stringMatching(/payment method/i) })
    expect(validateUpdate({ delivery: 'CARRIER_PIGEON' })).toMatchObject({ error: expect.stringMatching(/billing method/i) })
  })

  it('refuses a non-boolean invoice split', () => {
    expect(validateUpdate({ separateLocationInvoices: 'yes' })).toMatchObject({ error: expect.stringMatching(/true or false/i) })
  })

  it('never returns an empty write', () => {
    expect(validateUpdate({})).toMatchObject({ error: 'Nothing to update.' })
    expect(validateUpdate({ somethingElse: 1 })).toMatchObject({ error: 'Nothing to update.' })
  })

  it('only returns the fields that were supplied', () => {
    const data = ok(validateUpdate({ terms: 'NET_30', payMethod: 'ZELLE' }))
    expect(Object.keys(data).sort()).toEqual(['payMethod', 'terms'])
  })
})

describe('locationPillLabel', () => {
  const row = (over: Partial<BillingScheduleRow>): BillingScheduleRow => ({
    id: '1', name: 'A&B', clientType: 'COMMERCIAL', cadence: 'END_OF_MONTH',
    terms: null, payMethod: null, delivery: 'EMAIL',
    locationCount: 1, separateLocationInvoices: false, ...over,
  })

  it('is hidden for single-location clients', () => {
    expect(locationPillLabel(row({ locationCount: 1 }))).toBeNull()
  })

  it('describes combined vs separate for multi-location clients', () => {
    expect(locationPillLabel(row({ locationCount: 3 }))).toBe('One combined invoice · 3 locations')
    expect(locationPillLabel(row({ locationCount: 3, separateLocationInvoices: true }))).toBe('Separate invoices')
  })
})
