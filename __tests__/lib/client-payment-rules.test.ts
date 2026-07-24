import { describe, expect, it } from 'vitest'
import {
  cadenceOverrideForClientPaymentRule,
  propertyTypeForClientPaymentRule,
} from '@/lib/client-payment-rules'

describe('cadenceOverrideForClientPaymentRule', () => {
  it('falls back to the historical hardcoded cadences when no defaults are passed', () => {
    expect(cadenceOverrideForClientPaymentRule('RESIDENTIAL_STANDARD')).toBe('RESIDENTIAL_7_DAY')
    expect(cadenceOverrideForClientPaymentRule('COMMERCIAL_STANDARD')).toBe('COMMERCIAL_CLIENT_PAID_OR_7TH')
  })

  it('uses the configured defaults when supplied', () => {
    const defaults = { residential: 'AFTER_CLIENT_PAYS', commercial: 'END_OF_MONTH' }
    expect(cadenceOverrideForClientPaymentRule('RESIDENTIAL_STANDARD', defaults)).toBe('AFTER_CLIENT_PAYS')
    expect(cadenceOverrideForClientPaymentRule('COMMERCIAL_STANDARD', defaults)).toBe('END_OF_MONTH')
  })

  it('returns null for an unknown / cleared preset (never forces a cadence)', () => {
    const defaults = { residential: 'AFTER_CLIENT_PAYS', commercial: 'END_OF_MONTH' }
    expect(cadenceOverrideForClientPaymentRule(null, defaults)).toBeNull()
    expect(cadenceOverrideForClientPaymentRule('SOMETHING_ELSE', defaults)).toBeNull()
  })
})

describe('propertyTypeForClientPaymentRule', () => {
  it('maps presets to property type', () => {
    expect(propertyTypeForClientPaymentRule('RESIDENTIAL_STANDARD')).toBe('RESIDENTIAL')
    expect(propertyTypeForClientPaymentRule('COMMERCIAL_STANDARD')).toBe('COMMERCIAL')
    expect(propertyTypeForClientPaymentRule(null)).toBeNull()
  })
})
