import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCron: () => true }))
vi.mock('@/lib/error-alerting', () => ({ alertOperationalIssue: vi.fn(async () => undefined) }))

/** A fake transport. No mail leaves this test, and every send is recorded. */
const sent: Array<{ to: string[]; subject: string }> = []
let sendBehaviour: 'ok' | 'fail' | 'throw' = 'ok'

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (args: { to: string[]; subject: string }) => {
    if (sendBehaviour === 'throw') {
      // Accepted by the provider, then something blew up afterwards: the one
      // outcome where we cannot know whether the client got it.
      sent.push({ to: args.to, subject: args.subject })
      throw new Error('connection reset after accept')
    }
    if (sendBehaviour === 'fail') return { success: false, error: 'mailbox unavailable' }
    sent.push({ to: args.to, subject: args.subject })
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

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { POST as runCron } from '@/app/api/cron/send-scheduled/route'

beforeEach(async () => {
  sent.length = 0
  sendBehaviour = 'ok'
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000)

async function scheduledInvoice(opts?: { status?: string; payload?: unknown; at?: Date }) {
  const client = await prisma.client.create({
    data: { name: 'Bigco Offices', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' },
  })
  return prisma.invoice.create({
    data: {
      clientId: client.id,
      invoiceNumber: `INV-SS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: opts?.status ?? 'DRAFT',
      totalAmount: 400,
      scheduledSendAt: opts?.at ?? YESTERDAY,
      scheduledPayload:
        opts?.payload === undefined
          ? { to: ['client@example.com'], subject: 'Your invoice', message: 'Thanks' }
          : (opts.payload as never),
    },
  })
}

const run = async () => {
  const res = await runCron(new Request('http://test/cron', { method: 'POST' }))
  return { status: res.status, body: await res.json() }
}

const reload = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id } })

describe('sending a scheduled invoice', () => {
  it('sends it and records that it went', async () => {
    const invoice = await scheduledInvoice()
    const { body } = await run()

    expect(body.sent).toBe(1)
    expect(sent).toHaveLength(1)

    const after = await reload(invoice.id)
    expect(after.status).toBe('SENT')
    expect(after.scheduledSendAt).toBeNull()
  })

  it('stores the provider message id, so reminders keep the thread', async () => {
    // The manual send stored this and the scheduled one did not, so an
    // auto-sent invoice started a new thread every time.
    const invoice = await scheduledInvoice()
    await run()

    const after = await reload(invoice.id)
    expect(after.emailMessageId).toMatch(/^<msg-/)
  })
})

describe('an invoice that should not go out', () => {
  it('never emails a voided invoice', async () => {
    // The reported defect: the query was `notIn: ['SENT','PAID']`, and VOID is
    // neither, so a deliberately voided invoice still had its schedule fire.
    const invoice = await scheduledInvoice({ status: 'VOID' })
    const { body } = await run()

    expect(sent).toHaveLength(0)
    expect(body.sent).toBe(0)
    expect((await reload(invoice.id)).status).toBe('VOID')
  })

  it('never emails one that has already been sent', async () => {
    await scheduledInvoice({ status: 'SENT' })
    await run()
    expect(sent).toHaveLength(0)
  })

  it('drops a schedule with no recipients rather than retrying forever', async () => {
    const invoice = await scheduledInvoice({ payload: { to: [], subject: 'x', message: '' } })
    await run()

    expect(sent).toHaveLength(0)
    expect((await reload(invoice.id)).scheduledSendAt).toBeNull()
  })

  it('leaves one that is not due yet alone', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const invoice = await scheduledInvoice({ at: tomorrow })
    await run()

    expect(sent).toHaveLength(0)
    expect((await reload(invoice.id)).scheduledSendAt).not.toBeNull()
  })
})

describe('two runs overlapping', () => {
  it('sends exactly once', async () => {
    // Nothing claimed the invoice, so two runs both read it as due and both
    // sent it. The claim is a conditional UPDATE: one wins, one matches no rows.
    await scheduledInvoice()
    await Promise.all([run(), run()])

    expect(sent).toHaveLength(1)
    expect(await prisma.invoice.count({ where: { status: 'SENT' } })).toBe(1)
  })

  it('sends each of several invoices exactly once across overlapping runs', async () => {
    await scheduledInvoice()
    await scheduledInvoice()
    await scheduledInvoice()

    await Promise.all([run(), run(), run()])

    expect(sent).toHaveLength(3)
    expect(new Set(sent.map(s => s.to[0])).size).toBe(1)
    expect(await prisma.invoice.count({ where: { status: 'SENT' } })).toBe(3)
  })
})

describe('when the send does not succeed', () => {
  it('puts a refused invoice back in the queue', async () => {
    // Nothing left the building, so it is safe to try again later.
    sendBehaviour = 'fail'
    const invoice = await scheduledInvoice()
    const { body } = await run()

    expect(body.failed).toBe(1)
    const after = await reload(invoice.id)
    expect(after.status).toBe('DRAFT')
    expect(after.scheduledSendAt).not.toBeNull()
  })

  it('sends a requeued invoice on the next run', async () => {
    sendBehaviour = 'fail'
    const invoice = await scheduledInvoice()
    await run()

    sendBehaviour = 'ok'
    await run()

    expect(sent).toHaveLength(1)
    expect((await reload(invoice.id)).status).toBe('SENT')
  })

  it('does NOT requeue when the outcome is unknown', async () => {
    // The mail may already have gone. Leaving it queued is how an invoice gets
    // sent twice; leaving it claimed and unsent needs a person, which is the
    // lesser of the two.
    sendBehaviour = 'throw'
    const invoice = await scheduledInvoice()
    const { body } = await run()

    expect(body.failed).toBe(1)
    expect(body.results[0].status).toBe('failed:needs-review')

    const after = await reload(invoice.id)
    expect(after.scheduledSendAt).toBeNull()
    expect(after.status).toBe('DRAFT')
  })

  it('does not send again on the next run after an unknown outcome', async () => {
    sendBehaviour = 'throw'
    await scheduledInvoice()
    await run()
    const afterFirst = sent.length

    sendBehaviour = 'ok'
    await run()
    expect(sent).toHaveLength(afterFirst)
  })
})
