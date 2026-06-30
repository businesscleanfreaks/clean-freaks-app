import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { computeOwedForCleanerPeriod } from '@/lib/cleaner-invoice'
import { POST as recordInvoice } from '@/app/api/subcontractors/[id]/cleaner-invoices/route'
import { POST as resolveInvoice } from '@/app/api/subcontractors/[id]/cleaner-invoices/[invoiceId]/resolve/route'
import { POST as paySubcontractor } from '@/app/api/subcontractors/[id]/payments/route'

const pay = (id: string, body: unknown) =>
  paySubcontractor(
    new Request('http://test', { method: 'POST', body: JSON.stringify(body) }),
    { params: { id } },
  )

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// A cleaner with two unpaid $200 one-off cleans in June 2026 → we owe $400.
async function seedCleanerWithOwed() {
  const client = await prisma.client.create({
    data: { name: 'Acme Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '1 Rd' } })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam' } })
  for (const day of [5, 19]) {
    await prisma.job.create({
      data: {
        locationId: location.id, subcontractorId: sub.id, date: new Date(Date.UTC(2026, 5, day, 12)),
        clientRate: 300, subcontractorRate: 200, status: 'COMPLETED', invoiced: false, subcontractorPaid: false,
      },
    })
  }
  return { sub }
}

const post = (id: string, body: unknown) =>
  recordInvoice(
    new Request('http://test', { method: 'POST', body: JSON.stringify(body) }),
    { params: { id } },
  )

describe('cleaner invoice reconciliation', () => {
  it('computes what we owe a cleaner for a period from the shared ledger', async () => {
    const { sub } = await seedCleanerWithOwed()
    expect(await computeOwedForCleanerPeriod(prisma, sub.id, '2026-06')).toBe(400)
  })

  it('records a matching invoice as MATCHED', async () => {
    const { sub } = await seedCleanerWithOwed()
    const res = await post(sub.id, { period: '2026-06', claimedAmount: 400, reference: 'INV-9' })
    expect(res.status).toBe(200)
    const { invoice } = await res.json()
    expect(invoice.status).toBe('MATCHED')
    expect(invoice.computedOwed).toBe(400)
    expect(invoice.claimedAmount).toBe(400)
  })

  it('records a differing invoice as MISMATCH, then resolves it', async () => {
    const { sub } = await seedCleanerWithOwed()
    const res = await post(sub.id, { period: '2026-06', claimedAmount: 350 })
    const { invoice } = await res.json()
    expect(invoice.status).toBe('MISMATCH')
    expect(invoice.computedOwed).toBe(400)

    const resolved = await resolveInvoice(
      new Request('http://test', { method: 'POST' }),
      { params: { id: sub.id, invoiceId: invoice.id } },
    )
    expect(resolved.status).toBe(200)
    const after = await prisma.cleanerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(after.status).toBe('RESOLVED')
    expect(after.resolvedAt).not.toBeNull()
  })

  it('rejects a bad period format', async () => {
    const { sub } = await seedCleanerWithOwed()
    const res = await post(sub.id, { period: 'June', claimedAmount: 400 })
    expect(res.status).toBe(400)
  })

  it('blocks paying a cleaner with no matching invoice, allows with confirm', async () => {
    const { sub } = await seedCleanerWithOwed()
    const jobIds = (await prisma.job.findMany({ where: { subcontractorId: sub.id } })).map((j) => j.id)

    const blocked = await pay(sub.id, { jobIds, datePaid: '2026-06-20' })
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).code).toBe('NO_MATCHING_CLEANER_INVOICE')

    const forced = await pay(sub.id, { jobIds, datePaid: '2026-06-20', confirmNoInvoice: true })
    expect(forced.status).toBe(201)
  })

  it('allows paying once a matching invoice is on file', async () => {
    const { sub } = await seedCleanerWithOwed()
    const jobIds = (await prisma.job.findMany({ where: { subcontractorId: sub.id } })).map((j) => j.id)
    await post(sub.id, { period: '2026-06', claimedAmount: 400 }) // MATCHED

    const res = await pay(sub.id, { jobIds, datePaid: '2026-06-20' })
    expect(res.status).toBe(201)
  })
})
