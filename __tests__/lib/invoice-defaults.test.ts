import { describe, expect, it } from 'vitest'
import { computeDefaultDueDate, resolveDueDate, type InvoiceDefaultsData } from '@/lib/invoice-defaults'

const defaults: InvoiceDefaultsData = {
  residentialPaymentTerms: 'NET_7',
  commercialPaymentTerms: 'NET_30',
  invoiceFooterNote: null,
}

// A fixed reference date at UTC noon (how the app stores dates).
const from = new Date('2026-07-24T12:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('computeDefaultDueDate', () => {
  it('uses the residential terms for RESIDENTIAL clients', () => {
    expect(iso(computeDefaultDueDate('RESIDENTIAL', from, defaults))).toBe('2026-07-31') // +7
  })

  it('uses the commercial terms for COMMERCIAL clients', () => {
    expect(iso(computeDefaultDueDate('COMMERCIAL', from, defaults))).toBe('2026-08-23') // +30
  })

  it('falls back to commercial terms when the property type is unset', () => {
    expect(iso(computeDefaultDueDate(null, from, defaults))).toBe('2026-08-23')
  })

  it('returns the same day for DUE_ON_RECEIPT', () => {
    const d = computeDefaultDueDate('RESIDENTIAL', from, { ...defaults, residentialPaymentTerms: 'DUE_ON_RECEIPT' })
    expect(iso(d)).toBe('2026-07-24')
  })

  it('returns the end of the month for MONTH_END', () => {
    const d = computeDefaultDueDate('COMMERCIAL', from, { ...defaults, commercialPaymentTerms: 'MONTH_END' })
    expect(iso(d)).toBe('2026-07-31')
  })
})

describe('resolveDueDate', () => {
  it("uses the client's own terms over the property-type default", () => {
    const d = resolveDueDate({ paymentTerms: 'NET_15', propertyType: 'COMMERCIAL' }, from, defaults)
    expect(iso(d)).toBe('2026-08-08') // +15, not the commercial +30
  })

  it('falls back to the property-type default when the client has no terms', () => {
    expect(iso(resolveDueDate({ paymentTerms: null, propertyType: 'RESIDENTIAL' }, from, defaults)))
      .toBe('2026-07-31') // +7
    expect(iso(resolveDueDate({ propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-08-23') // +30
  })

  it('ignores an empty or whitespace terms value', () => {
    expect(iso(resolveDueDate({ paymentTerms: '   ', propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-08-23')
  })

  it('reads a lower-cased stored value', () => {
    expect(iso(resolveDueDate({ paymentTerms: 'net_7', propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-07-31')
  })

  it('honours MONTH_END on the client', () => {
    expect(iso(resolveDueDate({ paymentTerms: 'MONTH_END', propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-07-31')
  })

  it('honours DUE_ON_RECEIPT on the client · zero days is a real term, not a missing one', () => {
    expect(iso(resolveDueDate({ paymentTerms: 'DUE_ON_RECEIPT', propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-07-24')
  })

  it('falls back rather than guessing when the stored term is unrecognised', () => {
    expect(iso(resolveDueDate({ paymentTerms: 'NET_45', propertyType: 'COMMERCIAL' }, from, defaults)))
      .toBe('2026-08-23')
  })
})
