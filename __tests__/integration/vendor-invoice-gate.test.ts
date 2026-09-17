import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as payVendor } from '@/app/api/vendors/[id]/payments/route'

beforeEach(async () => {
  await prisma.cleanerInvoiceReceipt.deleteMany()
  await prisma.vendorInvoice.deleteMany()
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const now = new Date()
const day = (d: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 12, 0, 0))
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const PERIOD = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

/** One vendor doing one-off work on two accounts in the same month. */
async function seed() {
  const vendor = await prisma.vendor.create({ data: { name: 'Sparkle Windows' } })

  const make = async (name: string, address: string, dayOfMonth: number) => {
    const client = await prisma.client.create({
      data: { name, billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
    })
    const location = await prisma.location.create({
      data: { clientId: client.id, name: `${name} site`, address },
    })
    // Vendor work is one-off, so these carry no schedule.
    const job = await prisma.job.create({
      data: {
        locationId: location.id,
        vendorId: vendor.id,
        date: day(dayOfMonth),
        clientRate: 300,
        subcontractorRate: 180,
        status: 'COMPLETED',
      },
    })
    return { client, location, job }
  }

  const tower = await make('Tower Plaza', '1 Main St', 5)
  const cafe = await make('Corner Cafe', '2 Side St', 6)
  return { vendor, tower, cafe }
}

const recordReceipt = (
  vendorId: string,
  locationId: string,
  scope: { jobId?: string; addOnServiceId?: string } = {},
) =>
  prisma.cleanerInvoiceReceipt.create({
    data: {
      vendorId,
      locationId,
      period: PERIOD,
      jobId: scope.jobId ?? null,
      addOnServiceId: scope.addOnServiceId ?? null,
    },
  })

const pay = (vendorId: string, jobIds: string[], extra: Record<string, unknown> = {}) =>
  payVendor(
    new Request('http://test/pay', {
      method: 'POST',
      body: JSON.stringify({ jobIds, datePaid: ymd(new Date()), ...extra }),
    }),
    { params: Promise.resolve({ id: vendorId }) }
  )

describe('a vendor receipt recorded on the Cleaners page', () => {
  it('releases the payment for that account', async () => {
    // The reported gap: the gate read only VendorInvoice, so ticking a vendor's
    // invoice on the page changed nothing and the payment was still refused.
    const { vendor, tower } = await seed()
    await recordReceipt(vendor.id, tower.location.id)

    const res = await pay(vendor.id, [tower.job.id])
    expect(res.status).toBe(201)
  })

  it('releases a payment for exactly the clean it names', async () => {
    const { vendor, tower } = await seed()
    await recordReceipt(vendor.id, tower.location.id, { jobId: tower.job.id })

    expect((await pay(vendor.id, [tower.job.id])).status).toBe(201)
  })

  it('does not release another account', async () => {
    // Scoped to the work for the same reason the cleaner gate is.
    const { vendor, tower, cafe } = await seed()
    await recordReceipt(vendor.id, tower.location.id)

    const res = await pay(vendor.id, [tower.job.id, cafe.job.id])
    expect(res.status).toBe(409)

    const body = await res.json()
    expect(body.code).toBe('NO_MATCHING_VENDOR_INVOICE')
    expect(body.error).toContain('Corner Cafe')
    expect(body.error).not.toContain('Tower Plaza')
  })

  it('names the account in the refusal', async () => {
    const { vendor, tower, cafe } = await seed()
    await recordReceipt(vendor.id, tower.location.id)

    const body = await (await pay(vendor.id, [tower.job.id, cafe.job.id])).json()
    expect(body.gaps).toHaveLength(1)
    expect(body.gaps[0].locationName).toBe('Corner Cafe')
  })

  it('does not count a receipt recorded against a cleaner', async () => {
    const { vendor, tower } = await seed()
    const cleaner = await prisma.subcontractor.create({ data: { name: 'Maria' } })
    await prisma.cleanerInvoiceReceipt.create({
      data: { subcontractorId: cleaner.id, locationId: tower.location.id, period: PERIOD },
    })

    expect((await pay(vendor.id, [tower.job.id])).status).toBe(409)
  })

  it('does not count a receipt for another vendor', async () => {
    const { vendor, tower } = await seed()
    const other = await prisma.vendor.create({ data: { name: 'Other Co' } })
    await recordReceipt(other.id, tower.location.id)

    expect((await pay(vendor.id, [tower.job.id])).status).toBe(409)
  })
})

describe('the monthly vendor invoice still works as it did', () => {
  it('covers the whole month across accounts', async () => {
    // VendorInvoice is one invoice per vendor per month, so it genuinely does
    // cover the month. Wiring receipts in must not narrow that.
    const { vendor, tower, cafe } = await seed()
    await prisma.vendorInvoice.create({
      data: {
        vendorId: vendor.id,
        period: PERIOD,
        claimedAmount: 360,
        computedOwed: 360,
        status: 'MATCHED',
      },
    })

    expect((await pay(vendor.id, [tower.job.id, cafe.job.id])).status).toBe(201)
  })

  it('does not cover a month it is not for', async () => {
    const { vendor, tower } = await seed()
    await prisma.vendorInvoice.create({
      data: {
        vendorId: vendor.id,
        period: '2020-01',
        claimedAmount: 180,
        computedOwed: 180,
        status: 'MATCHED',
      },
    })

    expect((await pay(vendor.id, [tower.job.id])).status).toBe(409)
  })

  it('does not count an unresolved mismatch', async () => {
    const { vendor, tower } = await seed()
    await prisma.vendorInvoice.create({
      data: {
        vendorId: vendor.id,
        period: PERIOD,
        claimedAmount: 999,
        computedOwed: 180,
        status: 'MISMATCH',
      },
    })

    expect((await pay(vendor.id, [tower.job.id])).status).toBe(409)
  })
})

describe('refusing a vendor payment', () => {
  it('records nothing', async () => {
    const { vendor, tower, cafe } = await seed()
    await recordReceipt(vendor.id, tower.location.id)
    await pay(vendor.id, [tower.job.id, cafe.job.id])

    expect(await prisma.vendorPayment.count()).toBe(0)
    const jobs = await prisma.job.findMany({ select: { vendorPaid: true } })
    expect(jobs.every(j => !j.vendorPaid)).toBe(true)
  })

  it('still lets the reviewer pay anyway', async () => {
    const { vendor, tower, cafe } = await seed()
    const res = await pay(vendor.id, [tower.job.id, cafe.job.id], { confirmNoInvoice: true })
    expect(res.status).toBe(201)
  })
})
