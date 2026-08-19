import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { REMINDER_TEMPLATES } from '@/lib/invoice-tracking'
import {
  normalizeFooterTemplates,
  normalizeOneTimeJobDefaults,
  normalizeReminderTemplates,
  type InvoiceFooterTemplates,
  type OneTimeJobDefaults,
  type ReminderTemplates,
} from '@/lib/billing-sections'

/**
 * DB access for the billing schedule sheet's three sections, on the
 * BusinessSettings singleton. Reads always normalise, so a missing row, a null
 * column or a hand-edited JSON blob still yields a complete, valid shape.
 */

const SINGLETON_ID = 'singleton'

export interface BillingSectionSettings {
  oneTimeJobDefaults: OneTimeJobDefaults
  invoiceFooterTemplates: InvoiceFooterTemplates
  reminderTemplates: ReminderTemplates
}

/** The shipped reminder copy, minus the call script, which is not editable. */
const REMINDER_DEFAULTS: ReminderTemplates = {
  s1: REMINDER_TEMPLATES.s1,
  s2: REMINDER_TEMPLATES.s2,
}

export async function getBillingSectionSettings(): Promise<BillingSectionSettings> {
  try {
    const row = await prisma.businessSettings.findUnique({
      where: { id: SINGLETON_ID },
      select: { oneTimeJobDefaults: true, invoiceFooterTemplates: true, reminderTemplates: true },
    })
    return {
      oneTimeJobDefaults: normalizeOneTimeJobDefaults(row?.oneTimeJobDefaults),
      invoiceFooterTemplates: normalizeFooterTemplates(row?.invoiceFooterTemplates),
      reminderTemplates: normalizeReminderTemplates(row?.reminderTemplates, REMINDER_DEFAULTS),
    }
  } catch (error) {
    // A settings read must never take down invoicing: fall back to defaults.
    console.error('Error reading billing section settings:', error)
    return {
      oneTimeJobDefaults: normalizeOneTimeJobDefaults(null),
      invoiceFooterTemplates: normalizeFooterTemplates(null),
      reminderTemplates: normalizeReminderTemplates(null, REMINDER_DEFAULTS),
    }
  }
}

/** Just the reminder bodies, for the send paths. */
export async function getReminderTemplates(): Promise<ReminderTemplates> {
  return (await getBillingSectionSettings()).reminderTemplates
}

type SectionPatch =
  | { section: 'oneTimeJobDefaults'; value: unknown }
  | { section: 'invoiceFooterTemplates'; value: unknown }
  | { section: 'reminderTemplates'; value: unknown }

/** Saves one section, normalised, and returns the settings as they now stand. */
export async function saveBillingSection(patch: SectionPatch): Promise<BillingSectionSettings> {
  // Cast: these are plain string/number maps, which Prisma's InputJsonValue
  // cannot infer from a typed interface.
  const data =
    patch.section === 'oneTimeJobDefaults'
      ? { oneTimeJobDefaults: normalizeOneTimeJobDefaults(patch.value) as unknown as Prisma.InputJsonValue }
      : patch.section === 'invoiceFooterTemplates'
        ? { invoiceFooterTemplates: normalizeFooterTemplates(patch.value) as unknown as Prisma.InputJsonValue }
        : { reminderTemplates: normalizeReminderTemplates(patch.value, REMINDER_DEFAULTS) as unknown as Prisma.InputJsonValue }

  await prisma.businessSettings.upsert({
    where: { id: SINGLETON_ID },
    update: data as Prisma.BusinessSettingsUpdateInput,
    create: { id: SINGLETON_ID, ...data } as Prisma.BusinessSettingsCreateInput,
  })
  return getBillingSectionSettings()
}
