import { prisma } from '@/lib/db'

/**
 * Payment methods the business accepts (Settings → Payments received).
 * Informational only — a record of what clients can pay with. Stored as a JSON
 * string array on the BusinessSettings singleton.
 */

const SINGLETON_ID = 'singleton'

export const DEFAULT_PAYMENT_METHODS = ['Zelle', 'ACH / bank transfer', 'Card', 'Check']

export const MAX_PAYMENT_METHODS = 12
export const MAX_METHOD_LENGTH = 40

/**
 * Cleans a submitted list: trims, drops blanks, enforces per-item length,
 * removes case-insensitive duplicates, and caps the total count.
 */
export function sanitizePaymentMethods(input: unknown): string[] {
  if (!Array.isArray(input)) return DEFAULT_PAYMENT_METHODS
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const value = raw.trim().slice(0, MAX_METHOD_LENGTH)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= MAX_PAYMENT_METHODS) break
  }
  return out
}

export async function getPaymentMethods(): Promise<string[]> {
  try {
    const row = await prisma.businessSettings.findUnique({
      where: { id: SINGLETON_ID },
      select: { acceptedPaymentMethods: true },
    })
    // Unset (never configured) falls back to the standard set; an explicitly
    // saved empty list stays empty.
    if (!row || row.acceptedPaymentMethods == null) return DEFAULT_PAYMENT_METHODS
    if (!Array.isArray(row.acceptedPaymentMethods)) return DEFAULT_PAYMENT_METHODS
    return sanitizePaymentMethods(row.acceptedPaymentMethods)
  } catch (error) {
    console.error('Error fetching payment methods:', error)
    return DEFAULT_PAYMENT_METHODS
  }
}

export async function savePaymentMethods(methods: unknown): Promise<string[]> {
  const clean = sanitizePaymentMethods(methods)
  const row = await prisma.businessSettings.upsert({
    where: { id: SINGLETON_ID },
    update: { acceptedPaymentMethods: clean },
    create: { id: SINGLETON_ID, acceptedPaymentMethods: clean },
  })
  return Array.isArray(row.acceptedPaymentMethods)
    ? sanitizePaymentMethods(row.acceptedPaymentMethods)
    : clean
}
