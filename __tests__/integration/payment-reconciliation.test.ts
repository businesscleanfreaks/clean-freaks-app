import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { ingestMessages, runMatchPass, type RawInboxMessage } from '@/lib/payment-ingest'
import { isJobPayable } from '@/lib/payment-cadence'
import { POST as confirmPayment } from '@/app/api/payments/[id]/confirm/route'
import { POST as dismissPayment } from '@/app/api/payments/[id]/dismiss/route'

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const msg = (over: Partial<RawInboxMessage>): RawInboxMessage => ({
  messageId: 'm-1',
  from: 'alerts@chase.com',
  subject: 'You received $420.00 from ACME PAYMENTS',
  text: 'Zelle® payment. Confirmation number: ZELLE0001.',
  html: null,
  receivedAt: new Date(),
  ...over,
})

// A SENT invoice for $420 with a job linked to a cleaner paid AFTER_CLIENT_PAYS.
async function seedSentInvoiceWithGatedCleaner() {
  const client = await prisma.client.create({
    data: { name: 'Acme Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '1 Rd' } })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam', paymentCadence: 'AFTER_CLIENT_PAYS' } })
  const job = await prisma.job.create({
    data: {
      locationId: location.id, subcontractorId: sub.id, date: new Date('2026-06-10T12:00:00Z'),
      clientRate: 420, subcontractorRate: 200, status: 'COMPLETED', invoiced: true,
    },
  })
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-TEST-0001', clientId: client.id, totalAmount: 420, status: 'SENT',
      lineItems: { create: [{ description: 'Cleaning', amount: 420, jobId: job.id }] },
    },
  })
  return { client, sub, job, invoice }
}

async function jobIsPayable(jobId: string) {
  const j = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true, date: true, scheduleId: true, invoiced: true, subcontractorPaid: true,
      location: { select: { client: { select: { id: true } } } },
      invoiceLineItems: { select: { invoice: { select: { status: true } } } },
    },
  })
  return isJobPayable(j!, { paymentCadence: 'AFTER_CLIENT_PAYS', excludeClientIds: null }, null)
}

describe('payment reconciliation', () => {
  it('ingests a Zelle email, suggests the invoice, and confirm releases the cleaner', async () => {
    const { job, invoice } = await seedSentInvoiceWithGatedCleaner()

    const ingest = await ingestMessages(prisma, [msg({})])
    expect(ingest.created).toBe(1)

    await runMatchPass(prisma)
    const match = await prisma.paymentMatch.findFirst({ where: { messageId: 'm-1' } })
    expect(match).not.toBeNull()
    expect(match!.senderName).toBe('ACME PAYMENTS')
    expect(match!.amount).toBe(420)
    expect(match!.confidence).toBe('MEDIUM') // unknown payer + single exact invoice
    expect(match!.matchedInvoiceId).toBe(invoice.id)

    // Cleaner is NOT payable while the invoice is only SENT.
    expect(await jobIsPayable(job.id)).toBe(false)

    const res = await confirmPayment(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ invoiceId: invoice.id }) }),
      { params: { id: match!.id } },
    )
    expect(res.status).toBe(200)

    // Invoice paid, alias learned, cleaner now released.
    const paid = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(paid!.status).toBe('PAID')
    expect(paid!.paymentTransactionId).toBe('ZELLE0001')
    const alias = await prisma.clientPaymentAlias.findUnique({ where: { normalizedSenderName: 'ACME PAYMENTS' } })
    expect(alias).not.toBeNull()
    expect(await jobIsPayable(job.id)).toBe(true)
  })

  it('is idempotent: re-ingesting the same message creates nothing', async () => {
    await seedSentInvoiceWithGatedCleaner()
    const first = await ingestMessages(prisma, [msg({})])
    const second = await ingestMessages(prisma, [msg({})])
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(1)
    expect(await prisma.paymentMatch.count()).toBe(1)
  })

  it('rejects confirming an already-confirmed payment (no double-apply)', async () => {
    const { invoice } = await seedSentInvoiceWithGatedCleaner()
    await ingestMessages(prisma, [msg({})])
    const match = await prisma.paymentMatch.findFirstOrThrow({ where: { messageId: 'm-1' } })

    const ok = await confirmPayment(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ invoiceId: invoice.id }) }),
      { params: { id: match.id } },
    )
    expect(ok.status).toBe(200)

    const again = await confirmPayment(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ invoiceId: invoice.id }) }),
      { params: { id: match.id } },
    )
    expect(again.status).toBe(409)
  })

  it('dismiss removes a payment from the queue', async () => {
    await seedSentInvoiceWithGatedCleaner()
    await ingestMessages(prisma, [msg({})])
    const match = await prisma.paymentMatch.findFirstOrThrow({ where: { messageId: 'm-1' } })

    const res = await dismissPayment(new Request('http://test', { method: 'POST' }), { params: { id: match.id } })
    expect(res.status).toBe(200)
    const after = await prisma.paymentMatch.findUnique({ where: { id: match.id } })
    expect(after!.status).toBe('DISMISSED')
  })
})
