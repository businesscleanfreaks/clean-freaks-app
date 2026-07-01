import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as createJob } from '@/app/api/jobs/route'
import { GET as getPayables } from '@/app/api/payables/data/route'
import { POST as payVendor } from '@/app/api/vendors/[id]/payments/route'
import { POST as recordVendorInvoice } from '@/app/api/vendors/[id]/vendor-invoices/route'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

function isoToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

const jsonReq = (url: string, method: 'POST', body: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function seedClientAndVendor() {
  const client = await prisma.client.create({
    data: { name: 'Vendor One-Off Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({
    data: { clientId: client.id, name: 'Main Site', address: '1 Vendor Way' },
  })
  const vendor = await prisma.vendor.create({
    data: { name: 'Outside Windows', zelle: 'pay@example.com' },
  })
  return { client, location, vendor }
}

describe('vendor-performed one-off jobs in payables (real DB)', () => {
  it('creates a vendor one-off, surfaces it in vendor payables, and marks it vendor-paid', async () => {
    const { location, vendor } = await seedClientAndVendor()
    const date = isoToday()

    const createResponse = await createJob(jsonReq('http://test/api/jobs', 'POST', {
      locationId: location.id,
      vendorId: vendor.id,
      subcontractorId: null,
      date,
      startTime: '09:00',
      clientRate: 300,
      subcontractorRate: 180,
    }))
    expect(createResponse.status).toBe(200)
    const job = await createResponse.json()
    expect(job.vendorId).toBe(vendor.id)
    expect(job.subcontractorId).toBeNull()
    expect(job.scheduleId).toBeNull()

    const payablesResponse = await getPayables(new Request('http://test/api/payables/data'))
    expect(payablesResponse.status).toBe(200)
    const payables = await payablesResponse.json()
    const vendorPayable = payables.vendors.find((p: { id: string }) => p.id === vendor.id)
    expect(vendorPayable).toBeTruthy()
    expect(vendorPayable.total).toBe(180)
    expect(vendorPayable.accounts).toEqual([
      expect.objectContaining({
        itemKind: 'job',
        owed: 180,
        safeOwed: 180,
        payableItemIds: [job.id],
      }),
    ])

    await recordVendorInvoice(
      jsonReq(`http://test/api/vendors/${vendor.id}/vendor-invoices`, 'POST', {
        period: date.slice(0, 7),
        claimedAmount: 180,
        reference: 'vendor-one-off-test',
      }),
      { params: { id: vendor.id } },
    )

    const paymentResponse = await payVendor(
      jsonReq(`http://test/api/vendors/${vendor.id}/payments`, 'POST', {
        jobIds: [job.id],
        addOnServiceIds: [],
        datePaid: date,
        notes: 'Ref: vendor-one-off-test',
      }),
      { params: Promise.resolve({ id: vendor.id }) },
    )
    expect(paymentResponse.status).toBe(201)
    const payment = await paymentResponse.json()
    expect(payment.totalAmount).toBe(180)

    const updatedJob = await prisma.job.findUnique({
      where: { id: job.id },
      include: { vendorPaymentLineItems: true },
    })
    expect(updatedJob?.vendorPaid).toBe(true)
    expect(updatedJob?.vendorPaymentLineItems).toHaveLength(1)
    expect(updatedJob?.vendorPaymentLineItems[0].amount).toBe(180)
  })
})
