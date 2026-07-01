import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { computeOwedForVendorPeriod } from '@/lib/vendor-invoice'
import { POST as recordInvoice } from '@/app/api/vendors/[id]/vendor-invoices/route'
import { POST as resolveInvoice } from '@/app/api/vendors/[id]/vendor-invoices/[invoiceId]/resolve/route'
import {
  GET as downloadInvoiceAttachment,
  POST as uploadInvoiceAttachment,
} from '@/app/api/vendors/[id]/vendor-invoices/[invoiceId]/attachment/route'
import { POST as payVendor } from '@/app/api/vendors/[id]/payments/route'

const now = new Date()
const testYear = now.getFullYear()
const testMonth = now.getMonth()
const testPeriod = `${testYear}-${String(testMonth + 1).padStart(2, '0')}`
const testDate = (day: number) => new Date(Date.UTC(testYear, testMonth, day, 12))
const testDateString = (day: number) => `${testPeriod}-${String(day).padStart(2, '0')}`

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

async function seedVendorWithOwed() {
  const client = await prisma.client.create({
    data: { name: 'Vendor Intake Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '1 Rd' } })
  const vendor = await prisma.vendor.create({ data: { name: 'Window Pros', zelle: 'vendor@example.com' } })
  const owner = await prisma.subcontractor.create({ data: { name: 'Owner Cleaner' } })
  const job = await prisma.job.create({
    data: {
      locationId: location.id,
      vendorId: vendor.id,
      date: testDate(5),
      clientRate: 300,
      subcontractorRate: 180,
      status: 'COMPLETED',
      vendorPaid: false,
    },
  })
  const ownerJob = await prisma.job.create({
    data: {
      locationId: location.id,
      subcontractorId: owner.id,
      date: testDate(12),
      clientRate: 300,
      subcontractorRate: 200,
      status: 'COMPLETED',
    },
  })
  const addOn = await prisma.addOnService.create({
    data: {
      jobId: ownerJob.id,
      vendorId: vendor.id,
      description: 'Exterior glass',
      clientRate: 100,
      subcontractorRate: 40,
      vendorPaid: false,
    },
  })
  return { vendor, job, addOn }
}

const post = (id: string, body: unknown) =>
  recordInvoice(
    new Request('http://test', { method: 'POST', body: JSON.stringify(body) }),
    { params: { id } },
  )

const pay = (id: string, body: unknown) =>
  payVendor(
    new Request('http://test', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )

function pdfFile(name = 'vendor-invoice.pdf') {
  return new File(['%PDF-1.4\nvendor invoice'], name, { type: 'application/pdf' })
}

const postWithPdf = (id: string, file = pdfFile()) => {
  const form = new FormData()
  form.set('period', testPeriod)
  form.set('claimedAmount', '220')
  form.set('reference', 'VEND-PDF')
  form.set('file', file)
  return recordInvoice(
    new Request('http://test', { method: 'POST', body: form }),
    { params: { id } },
  )
}

describe('vendor invoice reconciliation', () => {
  it('computes what we owe a vendor for a period from unpaid vendor work', async () => {
    const { vendor } = await seedVendorWithOwed()
    expect(await computeOwedForVendorPeriod(prisma, vendor.id, testPeriod)).toBe(220)
  })

  it('records a matching vendor invoice as MATCHED', async () => {
    const { vendor } = await seedVendorWithOwed()
    const res = await post(vendor.id, { period: testPeriod, claimedAmount: 220, reference: 'VEND-9' })
    expect(res.status).toBe(200)
    const { invoice } = await res.json()
    expect(invoice.status).toBe('MATCHED')
    expect(invoice.computedOwed).toBe(220)
    expect(invoice.claimedAmount).toBe(220)
  })

  it('records a vendor invoice PDF and serves it without leaking bytes in JSON', async () => {
    const { vendor } = await seedVendorWithOwed()
    const res = await postWithPdf(vendor.id, pdfFile('vendor-july.pdf'))
    expect(res.status).toBe(200)
    const { invoice } = await res.json()
    expect(invoice.status).toBe('MATCHED')
    expect(invoice.attachmentFileName).toBe('vendor-july.pdf')
    expect(invoice.attachmentSize).toBeGreaterThan(0)
    expect(invoice.attachmentData).toBeUndefined()

    const downloaded = await downloadInvoiceAttachment(
      new Request('http://test'),
      { params: { id: vendor.id, invoiceId: invoice.id } },
    )
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers.get('content-type')).toContain('application/pdf')
    expect(Buffer.from(await downloaded.arrayBuffer()).toString('utf8')).toContain('%PDF-1.4')
  })

  it('attaches a vendor invoice PDF after the invoice record exists', async () => {
    const { vendor } = await seedVendorWithOwed()
    const created = await post(vendor.id, { period: testPeriod, claimedAmount: 220 })
    const { invoice } = await created.json()
    expect(invoice.attachmentFileName).toBeNull()

    const form = new FormData()
    form.set('file', pdfFile('later-vendor.pdf'))
    const attached = await uploadInvoiceAttachment(
      new Request('http://test', { method: 'POST', body: form }),
      { params: { id: vendor.id, invoiceId: invoice.id } },
    )
    expect(attached.status).toBe(200)
    const body = await attached.json()
    expect(body.invoice.attachmentFileName).toBe('later-vendor.pdf')
    expect(body.invoice.attachmentData).toBeUndefined()
  })

  it('records a differing vendor invoice as MISMATCH, then resolves it', async () => {
    const { vendor } = await seedVendorWithOwed()
    const res = await post(vendor.id, { period: testPeriod, claimedAmount: 200 })
    const { invoice } = await res.json()
    expect(invoice.status).toBe('MISMATCH')
    expect(invoice.computedOwed).toBe(220)

    const resolved = await resolveInvoice(
      new Request('http://test', { method: 'POST' }),
      { params: { id: vendor.id, invoiceId: invoice.id } },
    )
    expect(resolved.status).toBe(200)
    const after = await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(after.status).toBe('RESOLVED')
    expect(after.resolvedAt).not.toBeNull()
  })

  it('blocks paying a vendor with no matching invoice, allows with confirm', async () => {
    const { vendor, job, addOn } = await seedVendorWithOwed()

    const blocked = await pay(vendor.id, {
      jobIds: [job.id],
      addOnServiceIds: [addOn.id],
      datePaid: testDateString(20),
    })
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).code).toBe('NO_MATCHING_VENDOR_INVOICE')

    const forced = await pay(vendor.id, {
      jobIds: [job.id],
      addOnServiceIds: [addOn.id],
      datePaid: testDateString(20),
      confirmNoInvoice: true,
    })
    expect(forced.status).toBe(201)
  })

  it('allows paying once a matching vendor invoice is on file', async () => {
    const { vendor, job, addOn } = await seedVendorWithOwed()
    await post(vendor.id, { period: testPeriod, claimedAmount: 220 })

    const res = await pay(vendor.id, {
      jobIds: [job.id],
      addOnServiceIds: [addOn.id],
      datePaid: testDateString(20),
    })
    expect(res.status).toBe(201)
  })
})
