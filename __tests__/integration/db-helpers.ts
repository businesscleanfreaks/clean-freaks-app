import { prisma } from '@/lib/db'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0))

/** Wipe all business data between tests (FK-safe order). */
export async function resetDb() {
  await prisma.cleanerInvoice.deleteMany()
  await prisma.paymentMatch.deleteMany()
  await prisma.clientPaymentAlias.deleteMany()
  await prisma.subcontractorPaymentLineItem.deleteMany()
  await prisma.vendorPaymentLineItem.deleteMany()
  await prisma.subcontractorPayment.deleteMany()
  await prisma.vendorPayment.deleteMany()
  await prisma.invoiceLineItem.deleteMany()
  await prisma.invoicePdfCache.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.addOnService.deleteMany()
  await prisma.job.deleteMany()
  await prisma.schedule.deleteMany()
  await prisma.location.deleteMany()
  await prisma.client.deleteMany()
  await prisma.subcontractor.deleteMany()
  await prisma.vendor.deleteMany()
}

/**
 * Seed a flat-rate client with one location and one weekly schedule.
 * The schedule's weekday is derived from `start` so its own start date is always
 * a valid pattern date.
 */
export async function seedWeeklyFlatRateClient(opts?: { start?: Date; clientRate?: number; subRate?: number }) {
  const start = opts?.start ?? utc(2026, 5, 4)
  const client = await prisma.client.create({
    data: { name: 'Acme Co', billingType: 'FLAT_RATE', cleanerPayType: 'FLAT_RATE', startDate: start },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Acme HQ', address: '1 Main St' },
  })
  const sub = await prisma.subcontractor.create({ data: { name: 'Maria' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id,
      subcontractorId: sub.id,
      frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]),
      timeType: 'SPECIFIC',
      startTime: '09:00',
      defaultClientRate: opts?.clientRate ?? 400,
      defaultSubcontractorRate: opts?.subRate ?? 200,
      clientPayType: 'FLAT_RATE',
      subcontractorPayType: 'FLAT_RATE',
      startDate: start,
    },
  })
  return { client, location, sub, schedule }
}
