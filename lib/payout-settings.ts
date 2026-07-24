import { prisma } from '@/lib/db'

/**
 * Default cleaner payout cadence by client type. When a client is on the
 * Residential/Commercial preset, these decide the cadence applied to its
 * schedules (see cadenceOverrideForClientPaymentRule). Backed by the
 * BusinessSettings singleton.
 */
export interface PayoutSettingsData {
  residentialPayoutCadence: string
  commercialPayoutCadence: string
}

const SINGLETON_ID = 'singleton'

// The historical hardcoded mapping — used as the fallback so behavior is
// unchanged until these are configured.
export const DEFAULT_PAYOUT_SETTINGS: PayoutSettingsData = {
  residentialPayoutCadence: 'RESIDENTIAL_7_DAY',
  commercialPayoutCadence: 'COMMERCIAL_CLIENT_PAID_OR_7TH',
}

// Cadences the operator can pick for each client type (a curated subset of the
// full Subcontractor.paymentCadence enum).
export const PAYOUT_CADENCE_OPTIONS = [
  'IMMEDIATE',
  'AFTER_CLIENT_PAYS',
  'RESIDENTIAL_7_DAY',
  'COMMERCIAL_CLIENT_PAID_OR_7TH',
  'END_OF_MONTH',
  'SEMI_MONTHLY',
  'ON_CLEANER_INVOICE',
] as const

export async function getPayoutSettings(): Promise<PayoutSettingsData> {
  try {
    const row = await prisma.businessSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (!row) return DEFAULT_PAYOUT_SETTINGS
    return {
      residentialPayoutCadence: row.residentialPayoutCadence || DEFAULT_PAYOUT_SETTINGS.residentialPayoutCadence,
      commercialPayoutCadence: row.commercialPayoutCadence || DEFAULT_PAYOUT_SETTINGS.commercialPayoutCadence,
    }
  } catch (error) {
    console.error('Error fetching payout settings:', error)
    return DEFAULT_PAYOUT_SETTINGS
  }
}

export async function savePayoutSettings(data: PayoutSettingsData): Promise<PayoutSettingsData> {
  const valid = (v: string, fallback: string) =>
    (PAYOUT_CADENCE_OPTIONS as readonly string[]).includes(v) ? v : fallback
  const clean = {
    residentialPayoutCadence: valid(data.residentialPayoutCadence, DEFAULT_PAYOUT_SETTINGS.residentialPayoutCadence),
    commercialPayoutCadence: valid(data.commercialPayoutCadence, DEFAULT_PAYOUT_SETTINGS.commercialPayoutCadence),
  }
  const row = await prisma.businessSettings.upsert({
    where: { id: SINGLETON_ID },
    update: clean,
    create: { id: SINGLETON_ID, ...clean },
  })
  return {
    residentialPayoutCadence: row.residentialPayoutCadence || DEFAULT_PAYOUT_SETTINGS.residentialPayoutCadence,
    commercialPayoutCadence: row.commercialPayoutCadence || DEFAULT_PAYOUT_SETTINGS.commercialPayoutCadence,
  }
}
