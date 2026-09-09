import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { allocateInvoiceNumber, createWithInvoiceNumber } from '@/lib/allocate-invoice-number'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const year = new Date().getFullYear()

async function seedClient(name = 'Numbering Co') {
  return prisma.client.create({
    data: { name, billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
}

const makeInvoice = (clientId: string) => (invoiceNumber: string) =>
  prisma.invoice.create({
    data: { clientId, invoiceNumber, status: 'DRAFT', totalAmount: 100 },
  })

describe('invoice numbering against a real database', () => {
  it('starts a year at 001', async () => {
    expect(await allocateInvoiceNumber()).toBe(`INV-${year}-001`)
  })

  it('counts up as invoices are created', async () => {
    const client = await seedClient()
    const first = await createWithInvoiceNumber(makeInvoice(client.id))
    const second = await createWithInvoiceNumber(makeInvoice(client.id))
    expect(first.invoiceNumber).toBe(`INV-${year}-001`)
    expect(second.invoiceNumber).toBe(`INV-${year}-002`)
  })

  it('ignores the old date-stamped numbers already in the database', async () => {
    // Live invoices still carry INV-YYYYMMDD-NNNN. Reading one as a sequence
    // would push every new number into the millions.
    const client = await seedClient()
    await prisma.invoice.create({
      data: { clientId: client.id, invoiceNumber: `INV-${year}0907-0001`, status: 'DRAFT', totalAmount: 50 },
    })
    expect(await allocateInvoiceNumber()).toBe(`INV-${year}-001`)
  })

  it('does not reuse the number of a voided invoice', async () => {
    const client = await seedClient()
    const first = await createWithInvoiceNumber(makeInvoice(client.id))
    await prisma.invoice.update({ where: { id: first.id }, data: { status: 'VOID' } })
    const next = await createWithInvoiceNumber(makeInvoice(client.id))
    expect(next.invoiceNumber).toBe(`INV-${year}-002`)
  })

  it('gives simultaneous creates adjacent numbers instead of failing one', async () => {
    // Both read the same highest number, so one hits the unique index. Before
    // the retry that request returned a 500.
    const client = await seedClient()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createWithInvoiceNumber(makeInvoice(client.id))),
    )
    const numbers = results.map(r => r.invoiceNumber).sort()
    expect(new Set(numbers).size).toBe(5)
    expect(numbers).toEqual([
      `INV-${year}-001`, `INV-${year}-002`, `INV-${year}-003`,
      `INV-${year}-004`, `INV-${year}-005`,
    ])
  })

  it('rethrows a failure that is not a number clash', async () => {
    // Retrying a real error five times would just fail five times.
    await expect(
      createWithInvoiceNumber(async () => { throw new Error('database is on fire') }),
    ).rejects.toThrow('database is on fire')
  })
})
