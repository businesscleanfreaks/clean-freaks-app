import { describe, expect, it } from 'vitest'
import {
  sanitizePaymentMethods,
  DEFAULT_PAYMENT_METHODS,
  MAX_PAYMENT_METHODS,
  MAX_METHOD_LENGTH,
} from '@/lib/payment-methods'

describe('sanitizePaymentMethods', () => {
  it('keeps a clean list as-is', () => {
    expect(sanitizePaymentMethods(['Zelle', 'Check'])).toEqual(['Zelle', 'Check'])
  })

  it('trims and drops blank entries', () => {
    expect(sanitizePaymentMethods(['  Zelle  ', '', '   ', 'Check'])).toEqual(['Zelle', 'Check'])
  })

  it('removes case-insensitive duplicates, keeping the first', () => {
    expect(sanitizePaymentMethods(['Zelle', 'zelle', 'ZELLE', 'Check'])).toEqual(['Zelle', 'Check'])
  })

  it('drops non-string entries', () => {
    expect(sanitizePaymentMethods(['Zelle', 42, null, undefined, {}, 'Check'])).toEqual(['Zelle', 'Check'])
  })

  it('caps the number of methods', () => {
    const many = Array.from({ length: MAX_PAYMENT_METHODS + 5 }, (_, i) => `Method ${i}`)
    expect(sanitizePaymentMethods(many)).toHaveLength(MAX_PAYMENT_METHODS)
  })

  it('truncates an over-long method name', () => {
    const long = 'x'.repeat(MAX_METHOD_LENGTH + 20)
    expect(sanitizePaymentMethods([long])[0]).toHaveLength(MAX_METHOD_LENGTH)
  })

  it('falls back to the defaults when given a non-array', () => {
    expect(sanitizePaymentMethods(null)).toEqual(DEFAULT_PAYMENT_METHODS)
    expect(sanitizePaymentMethods('Zelle')).toEqual(DEFAULT_PAYMENT_METHODS)
  })

  it('allows an explicitly empty list', () => {
    expect(sanitizePaymentMethods([])).toEqual([])
  })
})
