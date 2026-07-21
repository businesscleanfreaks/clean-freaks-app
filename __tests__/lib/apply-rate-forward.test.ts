import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  jobFindUnique: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  scheduleUpdate: vi.fn(),
  invoiceLineItemFindMany: vi.fn(),
  invoiceLineItemUpdate: vi.fn(),
  invoiceUpdate: vi.fn(),
  revalidateSchedulePages: vi.fn(),
  revalidateInvoicePages: vi.fn(),
}))

const tx = {
  job: { findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany },
  schedule: { update: mocks.scheduleUpdate },
  invoiceLineItem: {
    findMany: mocks.invoiceLineItemFindMany,
    update: mocks.invoiceLineItemUpdate,
  },
  invoice: { update: mocks.invoiceUpdate },
}

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/lib/revalidate', () => ({
  revalidateSchedulePages: mocks.revalidateSchedulePages,
  revalidateInvoicePages: mocks.revalidateInvoicePages,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    job: { findUnique: mocks.jobFindUnique },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}))

import { POST } from '@/app/api/jobs/[id]/apply-rate-forward/route'

const request = (body: unknown) => new Request('http://test/api/jobs/job-current/apply-rate-forward', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const draftLine = { invoice: { status: 'DRAFT' } }
const sentLine = { invoice: { status: 'SENT' } }

const sourceJob = () => ({
  id: 'job-current',
  date: new Date('2026-07-21T12:00:00Z'),
  scheduleId: 'schedule-1',
  status: 'SCHEDULED',
  subcontractorPaid: false,
  vendorPaid: false,
  invoiceLineItems: [draftLine],
  location: { clientId: 'client-1' },
  schedule: {
    defaultClientRate: 100,
    defaultSubcontractorRate: 60,
    subcontractorId: 'sub-old',
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'test-user' })
  mocks.jobFindUnique.mockResolvedValue(sourceJob())
  mocks.jobFindMany.mockResolvedValue([
    {
      id: 'job-current',
      status: 'SCHEDULED',
      subcontractorPaid: false,
      vendorPaid: false,
      invoiceLineItems: [draftLine],
    },
    {
      id: 'job-final',
      status: 'SCHEDULED',
      subcontractorPaid: false,
      vendorPaid: false,
      invoiceLineItems: [sentLine],
    },
    {
      id: 'job-paid',
      status: 'SCHEDULED',
      subcontractorPaid: true,
      vendorPaid: false,
      invoiceLineItems: [],
    },
    {
      id: 'job-cancelled',
      status: 'CANCELLED',
      subcontractorPaid: false,
      vendorPaid: false,
      invoiceLineItems: [],
    },
  ])
  mocks.invoiceLineItemFindMany.mockImplementation(async (args: { where: { invoiceId?: string } }) =>
    args.where.invoiceId
      ? [{ amount: 250 }, { amount: 50 }]
      : [{ id: 'line-1', invoiceId: 'invoice-draft' }]
  )
})

describe('apply cleaner/rate changes going forward', () => {
  it('updates defaults, editable jobs, and draft invoice totals while preserving locked jobs', async () => {
    const response = await POST(
      request({ clientRate: 250, subcontractorRate: 140, subcontractorId: 'sub-new' }),
      { params: { id: 'job-current' } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      updated: 1,
      skipped: 3,
      draftInvoicesUpdated: 1,
      previous: {
        clientRate: 100,
        subcontractorRate: 60,
        subcontractorId: 'sub-old',
      },
    })
    expect(mocks.scheduleUpdate).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: {
        defaultClientRate: 250,
        defaultSubcontractorRate: 140,
        subcontractorId: 'sub-new',
      },
    })
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['job-current'] } },
      data: { clientRate: 250, subcontractorRate: 140, subcontractorId: 'sub-new' },
    })
    expect(mocks.invoiceLineItemFindMany).toHaveBeenCalledWith({
      where: {
        jobId: { in: ['job-current'] },
        addOnServiceId: null,
        invoice: { status: 'DRAFT' },
      },
      select: { id: true, invoiceId: true },
    })
    expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { amount: 250 },
    })
    expect(mocks.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'invoice-draft' },
      data: { totalAmount: 300 },
    })
    expect(mocks.revalidateSchedulePages).toHaveBeenCalledWith('client-1')
    expect(mocks.revalidateInvoicePages).toHaveBeenCalledWith('client-1')
  })

  it('rejects a locked source clean before changing the schedule', async () => {
    mocks.jobFindUnique.mockResolvedValueOnce({
      ...sourceJob(),
      invoiceLineItems: [sentLine],
    })

    const response = await POST(
      request({ clientRate: 250 }),
      { params: { id: 'job-current' } },
    )

    expect(response.status).toBe(409)
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled()
  })
})
