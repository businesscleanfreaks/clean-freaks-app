import { prisma } from '@/lib/db'

/**
 * Invoice defaults — applied to every new invoice (the operator can still
 * override them per invoice). Backed by the `BusinessSettings` singleton.
 */
export interface InvoiceDefaultsData {
  residentialPaymentTerms: string
  commercialPaymentTerms: string
  invoiceFooterNote: string | null
}

const SINGLETON_ID = 'singleton'

export const RESIDENTIAL_TERM_OPTIONS = ['DUE_ON_RECEIPT', 'NET_7', 'NET_14'] as const
export const COMMERCIAL_TERM_OPTIONS = ['NET_15', 'NET_30', 'MONTH_END'] as const

const DEFAULTS: InvoiceDefaultsData = {
  residentialPaymentTerms: 'DUE_ON_RECEIPT',
  commercialPaymentTerms: 'NET_30',
  invoiceFooterNote: null,
}

export async function getInvoiceDefaults(): Promise<InvoiceDefaultsData> {
  try {
    const row = await prisma.businessSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (!row) return DEFAULTS
    return {
      residentialPaymentTerms: row.residentialPaymentTerms || DEFAULTS.residentialPaymentTerms,
      commercialPaymentTerms: row.commercialPaymentTerms || DEFAULTS.commercialPaymentTerms,
      invoiceFooterNote: row.invoiceFooterNote,
    }
  } catch (error) {
    console.error('Error fetching invoice defaults:', error)
    return DEFAULTS
  }
}

export async function saveInvoiceDefaults(data: InvoiceDefaultsData): Promise<InvoiceDefaultsData> {
  const clean = {
    residentialPaymentTerms: RESIDENTIAL_TERM_OPTIONS.includes(data.residentialPaymentTerms as never)
      ? data.residentialPaymentTerms
      : DEFAULTS.residentialPaymentTerms,
    commercialPaymentTerms: COMMERCIAL_TERM_OPTIONS.includes(data.commercialPaymentTerms as never)
      ? data.commercialPaymentTerms
      : DEFAULTS.commercialPaymentTerms,
    invoiceFooterNote: data.invoiceFooterNote?.trim() || null,
  }
  const row = await prisma.businessSettings.upsert({
    where: { id: SINGLETON_ID },
    update: clean,
    create: { id: SINGLETON_ID, ...clean },
  })
  return {
    residentialPaymentTerms: row.residentialPaymentTerms || DEFAULTS.residentialPaymentTerms,
    commercialPaymentTerms: row.commercialPaymentTerms || DEFAULTS.commercialPaymentTerms,
    invoiceFooterNote: row.invoiceFooterNote,
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12, 0, 0))
}

const TERM_DAYS: Record<string, number> = {
  DUE_ON_RECEIPT: 0,
  NET_7: 7,
  NET_14: 14,
  NET_15: 15,
  NET_30: 30,
}

/**
 * Compute the default due date for a new invoice from the configured terms and
 * the client's property type. RESIDENTIAL clients use the residential terms;
 * everything else (COMMERCIAL or unset) uses the commercial terms.
 */
export function computeDefaultDueDate(
  propertyType: string | null | undefined,
  from: Date,
  defaults: InvoiceDefaultsData,
): Date {
  const term =
    propertyType === 'RESIDENTIAL' ? defaults.residentialPaymentTerms : defaults.commercialPaymentTerms
  if (term === 'MONTH_END') return endOfMonth(from)
  return addDays(from, TERM_DAYS[term] ?? 0)
}
