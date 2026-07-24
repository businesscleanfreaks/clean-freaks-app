import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  jobFindUnique: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  scheduleUpdate: vi.fn(),
  revalidateSchedulePages: vi.fn(),
}))

const tx = {
  job: { findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany },
  schedule: { update: mocks.scheduleUpdate },
}

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/lib/revalidate', () => ({
  revalidateSchedulePages: mocks.revalidateSchedulePages,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    job: { findUnique: mocks.jobFindUnique },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}))

import { POST } from '@/app/api/jobs/[id]/move-forward/route'

const request = (body: unknown) =>
  new Request('http://test/api/jobs/job-current/move-forward', {
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
  schedule: { startTime: '09:00' },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'test-user' })
  mocks.jobFindUnique.mockResolvedValue(sourceJob())
  mocks.jobFindMany.mockResolvedValue([
    { id: 'job-current', status: 'SCHEDULED', subcontractorPaid: false, vendorPaid: false, invoiceLineItems: [draftLine] },
    { id: 'job-future', status: 'SCHEDULED', subcontractorPaid: false, vendorPaid: false, invoiceLineItems: [] },
    { id: 'job-final', status: 'SCHEDULED', subcontractorPaid: false, vendorPaid: false, invoiceLineItems: [sentLine] },
    { id: 'job-paid', status: 'SCHEDULED', subcontractorPaid: true, vendorPaid: false, invoiceLineItems: [] },
    { id: 'job-cancelled', status: 'CANCELLED', subcontractorPaid: false, vendorPaid: false, invoiceLineItems: [] },
  ])
})

describe('move recurring clean time going forward', () => {
  it('shifts the time on the schedule + editable future jobs, skips locked ones, returns previous time', async () => {
    const response = await POST(request({ startTime: '11:00' }), { params: { id: 'job-current' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      updated: 2,
      skipped: 3,
      previous: { startTime: '09:00' },
    })
    expect(mocks.scheduleUpdate).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: { startTime: '11:00' },
    })
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['job-current', 'job-future'] } },
      data: { startTime: '11:00' },
    })
    expect(mocks.revalidateSchedulePages).toHaveBeenCalledWith('client-1')
  })

  it('rejects a locked source clean before changing anything', async () => {
    mocks.jobFindUnique.mockResolvedValueOnce({ ...sourceJob(), subcontractorPaid: true })

    const response = await POST(request({ startTime: '11:00' }), { params: { id: 'job-current' } })

    expect(response.status).toBe(409)
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled()
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a one-off (non-recurring) job', async () => {
    mocks.jobFindUnique.mockResolvedValueOnce({ ...sourceJob(), scheduleId: null, schedule: null })

    const response = await POST(request({ startTime: '11:00' }), { params: { id: 'job-current' } })

    expect(response.status).toBe(400)
    expect(mocks.scheduleUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed start time', async () => {
    const response = await POST(request({ startTime: '9am' }), { params: { id: 'job-current' } })

    expect(response.status).toBe(400)
    expect(mocks.jobFindUnique).not.toHaveBeenCalled()
  })
})
