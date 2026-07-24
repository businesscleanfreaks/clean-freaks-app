export const CLIENT_PAYMENT_RULE_PRESETS = [
  'RESIDENTIAL_STANDARD',
  'COMMERCIAL_STANDARD',
] as const

export type ClientPaymentRulePreset = typeof CLIENT_PAYMENT_RULE_PRESETS[number]

export const CLIENT_PAYMENT_RULE_LABELS: Record<ClientPaymentRulePreset, string> = {
  RESIDENTIAL_STANDARD: 'Residential Standard',
  COMMERCIAL_STANDARD: 'Commercial Standard',
}

export interface PayoutCadenceDefaults {
  residential: string
  commercial: string
}

// The historical hardcoded mapping — the fallback when configured defaults
// aren't supplied, so existing callers keep their exact behavior.
const HARDCODED_PAYOUT_DEFAULTS: PayoutCadenceDefaults = {
  residential: 'RESIDENTIAL_7_DAY',
  commercial: 'COMMERCIAL_CLIENT_PAID_OR_7TH',
}

export function cadenceOverrideForClientPaymentRule(
  preset: ClientPaymentRulePreset | string | null | undefined,
  defaults: PayoutCadenceDefaults = HARDCODED_PAYOUT_DEFAULTS,
): string | null {
  if (preset === 'RESIDENTIAL_STANDARD') return defaults.residential
  if (preset === 'COMMERCIAL_STANDARD') return defaults.commercial
  return null
}

export function propertyTypeForClientPaymentRule(
  preset: ClientPaymentRulePreset | string | null | undefined,
): 'RESIDENTIAL' | 'COMMERCIAL' | null {
  if (preset === 'RESIDENTIAL_STANDARD') return 'RESIDENTIAL'
  if (preset === 'COMMERCIAL_STANDARD') return 'COMMERCIAL'
  return null
}
