import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

/** A fake transport. No mail leaves this test, and every send is recorded. */
const sent: Array<{ to: string[] }> = []
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (args: { to: string[] }) => {
    sent.push({ to: args.to })
    return { success: true, messageId: `<msg-${sent.length}@test>` }
  }),
}))
vi.mock('@/lib/email-settings', () => ({
  getEmailConfig: async () => ({
    provider: 'resend',
    resendApiKey: 'test-key',
    realSending: true,
    enabled: true,
  }),
}))
vi.mock('@/lib/email-send-outcome', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, realSendingEnabled: () => true }
})
// The schedule-match guard is a separate concern with its own tests.
vi.mock('@/lib/invoice-guard', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, evaluateInvoiceForSend: async () => ({ matches: true, findings: [] }) }
})

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as sendEmail } from '@/app/api/invoices/[id]/send-email/route'

beforeEach(async () => {
  sent.length = 0
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

async function invoiceWith(status: string) {
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  return prisma.invoice.create({
    data: {
      clientId: client.id,
      invoiceNumber: `INV-SG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status,
      totalAmount: 400,
      // Present so the route gets past its "PDF not generated" check and
      // reaches the status question this test is about.
      pdfUrl: 'https://example.test/invoice.pdf',
    },
  })
}

const send = (id: string, extra: Record<string, unknown> = {}) =>
  sendEmail(
    new Request('http://test/send', {
      method: 'POST',
      body: JSON.stringify({
        to: ['client@example.com'],
        subject: 'Your invoice',
        message: 'Thanks',
        isTest: false,
        ...extra,
      }),
    }),
    { params: { id } },
  )

const reload = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id } })

describe('emailing a void invoice', () => {
  it('is refused', async () => {
    // The reported defect: the workspace creates a VOID preview, finalizes it
    // to DRAFT, then sends · and the finalize response was never checked. When
    // finalize failed, this emailed a void invoice to the client.
    const invoice = await invoiceWith('VOID')
    const res = await send(invoice.id)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVOICE_VOID')
    expect(sent).toHaveLength(0)
  })

  it('leaves it VOID rather than stamping it SENT', async () => {
    // Stamping it SENT while its cleans stayed billable is how the same work
    // got invoiced twice.
    const invoice = await invoiceWith('VOID')
    await send(invoice.id)

    const after = await reload(invoice.id)
    expect(after.status).toBe('VOID')
    expect(after.dateSent).toBeNull()
  })

  it('cannot be forced through with a resend confirmation', async () => {
    const invoice = await invoiceWith('VOID')
    const res = await send(invoice.id, { confirmResend: true })

    expect(res.status).toBe(409)
    expect(sent).toHaveLength(0)
  })
})

describe('emailing an invoice that has already gone', () => {
  it('is refused by default', async () => {
    const invoice = await invoiceWith('SENT')
    const res = await send(invoice.id)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVOICE_ALREADY_SENT')
    expect(sent).toHaveLength(0)
  })

  it('goes when the sender confirms it', async () => {
    // Resending is a real thing to want, so it is allowed on purpose.
    const invoice = await invoiceWith('SENT')
    const res = await send(invoice.id, { confirmResend: true })

    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('refuses a paid invoice by default too', async () => {
    const invoice = await invoiceWith('PAID')
    expect((await send(invoice.id)).status).toBe(409)
    expect(sent).toHaveLength(0)
  })
})

describe('emailing an invoice that is ready', () => {
  it('sends a draft', async () => {
    const invoice = await invoiceWith('DRAFT')
    const res = await send(invoice.id)

    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect((await reload(invoice.id)).status).toBe('SENT')
  })

  it('sends an overdue invoice', async () => {
    const invoice = await invoiceWith('OVERDUE')
    expect((await send(invoice.id)).status).toBe(200)
    expect(sent).toHaveLength(1)
  })
})
