import { describe, expect, it } from 'vitest'
import { computeDefaultDueDate, type InvoiceDefaultsData } from '@/lib/invoice-defaults'

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
