import { describe, expect, it } from 'vitest'
import { createClientSchema, updateClientSchema } from '@/lib/validations'

describe('client property type validation', () => {
  it('accepts residential and commercial client classifications', () => {
    const baseClient = {
      name: 'Property Type Co',
      billingType: 'PER_CLEAN',
      cleanerPayType: 'PER_CLEAN',
    } as const

    expect(createClientSchema.parse({ ...baseClient, propertyType: 'RESIDENTIAL' }).propertyType).toBe('RESIDENTIAL')
    expect(createClientSchema.parse({ ...baseClient, propertyType: 'COMMERCIAL' }).propertyType).toBe('COMMERCIAL')
  })

  it('normalizes a blank property type to null on updates', () => {
    expect(updateClientSchema.parse({ propertyType: '' }).propertyType).toBeNull()
  })

  it('accepts client payment rule presets', () => {
    expect(updateClientSchema.parse({ paymentRulePreset: 'RESIDENTIAL_STANDARD' }).paymentRulePreset).toBe('RESIDENTIAL_STANDARD')
    expect(updateClientSchema.parse({ paymentRulePreset: 'COMMERCIAL_STANDARD' }).paymentRulePreset).toBe('COMMERCIAL_STANDARD')
    expect(updateClientSchema.parse({ paymentRulePreset: '' }).paymentRulePreset).toBeNull()
  })

  it('rejects unknown property types', () => {
    expect(updateClientSchema.safeParse({ propertyType: 'INDUSTRIAL' }).success).toBe(false)
  })

  it('rejects unknown payment rule presets', () => {
    expect(updateClientSchema.safeParse({ paymentRulePreset: 'WEEKLY_WHENEVER' }).success).toBe(false)
  })
})
