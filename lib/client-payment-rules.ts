export const CLIENT_PAYMENT_RULE_PRESETS = [
  'RESIDENTIAL_STANDARD',
  'COMMERCIAL_STANDARD',
] as const

export type ClientPaymentRulePreset = typeof CLIENT_PAYMENT_RULE_PRESETS[number]

export const CLIENT_PAYMENT_RULE_LABELS: Record<ClientPaymentRulePreset, string> = {
  RESIDENTIAL_STANDARD: 'Residential Standard',
  COMMERCIAL_STANDARD: 'Commercial Standard',
}

export function cadenceOverrideForClientPaymentRule(
  preset: ClientPaymentRulePreset | string | null | undefined,
): string | null {
  if (preset === 'RESIDENTIAL_STANDARD') return 'RESIDENTIAL_7_DAY'
  if (preset === 'COMMERCIAL_STANDARD') return 'COMMERCIAL_CLIENT_PAID_OR_7TH'
  return null
}

export function propertyTypeForClientPaymentRule(
  preset: ClientPaymentRulePreset | string | null | undefined,
): 'RESIDENTIAL' | 'COMMERCIAL' | null {
  if (preset === 'RESIDENTIAL_STANDARD') return 'RESIDENTIAL'
  if (preset === 'COMMERCIAL_STANDARD') return 'COMMERCIAL'
  return null
}
