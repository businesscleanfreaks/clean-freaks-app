import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as confirmPayment } from '@/app/api/payments/[id]/confirm/route'

beforeEach(async () => {
  await prisma.paymentMatch.deleteMany()
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

/** A client with one open invoice, and a detected payment awaiting review. */
async function seed(invoiceTotal: number, paymentAmount: number) {
  const client = await prisma.client.create({
    data: { name: 'Payer Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const invoice = await prisma.invoice.create({
    data: {
      clientId: client.id,
      invoiceNumber: `INV-GUARD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'SENT',
      totalAmount: invoiceTotal,
    },
  })
  const match = await prisma.paymentMatch.create({
    data: {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      amount: paymentAmount,
      senderName: 'A Payer',
      rawSnippet: 'Source: ZELLE payment received',
      confirmationNumber: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      receivedAt: new Date(),
      status: 'NEEDS_REVIEW',
    },
  })
  return { client, invoice, match }
}

const post = (matchId: string, body: unknown) =>
  confirmPayment(
    new Request('http://test/confirm', { method: 'POST', body: JSON.stringify(body) }),
    { params: { id: matchId } },
  )

describe('confirming a detected payment against an invoice', () => {
  it('settles an invoice when the amount matches', async () => {
    const { invoice, match } = await seed(1000, 1000)
    const res = await post(match.id, { invoiceId: invoice.id })
    expect(res.status).toBe(200)

    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(after!.status).toBe('PAID')
  })

  it('refuses to settle a $1,000 invoice with a $100 payment', async () => {
    // The reported defect: this returned success and marked the invoice PAID.
    const { invoice, match } = await seed(1000, 100)
    const res = await post(match.id, { invoiceId: invoice.id })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('PAYMENT_AMOUNT_MISMATCH')
    expect(body.difference).toBe(900)

    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(after!.status).toBe('SENT')
    expect(after!.datePaid).toBeNull()
  })

  it('leaves the payment awaiting review when it is refused', async () => {
    // It must stay in the inbox; silently consuming it would lose the money.
    const { invoice, match } = await seed(1000, 100)
    await post(match.id, { invoiceId: invoice.id })

    const after = await prisma.paymentMatch.findUnique({ where: { id: match.id } })
    expect(after!.status).toBe('NEEDS_REVIEW')
    expect(after!.matchedInvoiceId).toBeNull()
  })

  it('refuses an overpayment too', async () => {
    const { invoice, match } = await seed(1000, 1500)
    const res = await post(match.id, { invoiceId: invoice.id })
    expect(res.status).toBe(409)
    expect((await res.json()).fit).toBe('OVERPAID')

    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(after!.status).toBe('SENT')
  })

  it('applies a mismatch when the reviewer confirms it, and records why', async () => {
    const { invoice, match } = await seed(1000, 100)
    const res = await post(match.id, { invoiceId: invoice.id, confirmMismatch: true })
    expect(res.status).toBe(200)

    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(after!.status).toBe('PAID')
    // The difference is on the record, so it is not mistaken for an exact match.
    expect(after!.paymentNotes).toContain('$900.00 short')
  })

  it('still refuses a second payment against an already paid invoice', async () => {
    const { invoice, match } = await seed(1000, 1000)
    expect((await post(match.id, { invoiceId: invoice.id })).status).toBe(200)

    const second = await prisma.paymentMatch.create({
      data: {
        messageId: `msg-2-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        amount: 1000, senderName: 'A Payer', rawSnippet: 'Source: ZELLE',
        confirmationNumber: `conf-2-${Date.now()}`, receivedAt: new Date(), status: 'NEEDS_REVIEW',
      },
    })
    const res = await post(second.id, { invoiceId: invoice.id })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
