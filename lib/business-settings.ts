import { prisma } from '@/lib/db'

/**
 * Business profile — the identity shown to clients on invoices and emails.
 * Backed by the `BusinessSettings` singleton row (id = "singleton").
 */
export interface BusinessProfileData {
  businessName: string
  legalName: string | null
  email: string | null
  phone: string | null
  address: string | null
  paymentEmail: string | null
}

const SINGLETON_ID = 'singleton'

const DEFAULTS: BusinessProfileData = {
  businessName: 'The Clean Freaks',
  legalName: null,
  email: null,
  phone: null,
  address: null,
  paymentEmail: null,
}

export async function getBusinessProfile(): Promise<BusinessProfileData> {
  try {
    const row = await prisma.businessSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (!row) return DEFAULTS
    return {
      businessName: row.businessName || DEFAULTS.businessName,
      legalName: row.legalName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      paymentEmail: row.paymentEmail,
    }
  } catch (error) {
    console.error('Error fetching business profile:', error)
    return DEFAULTS
  }
}

export async function saveBusinessProfile(data: BusinessProfileData): Promise<BusinessProfileData> {
  const clean = {
    businessName: data.businessName?.trim() || DEFAULTS.businessName,
    legalName: data.legalName?.trim() || null,
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    address: data.address?.trim() || null,
    paymentEmail: data.paymentEmail?.trim() || null,
  }
  const row = await prisma.businessSettings.upsert({
    where: { id: SINGLETON_ID },
    update: clean,
    create: { id: SINGLETON_ID, ...clean },
  })
  return {
    businessName: row.businessName,
    legalName: row.legalName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    paymentEmail: row.paymentEmail,
  }
}
