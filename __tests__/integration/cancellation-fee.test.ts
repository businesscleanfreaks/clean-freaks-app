import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Some endpoints require a logged-in user; stub it for tests.
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'test-user', email: 'test@example.com', name: 'Test' }),
}))
// from-candidate calls revalidatePath, which only works inside a Next request.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { prisma } from '@/lib/db'
import { resetDb } from './db-helpers'
import { GET as candidatesGET } from '@/app/api/invoices/candidates/route'
import { POST as fromCandidatePOST } from '@/app/api/invoices/from-candidate/route'
import { evaluateInvoiceForSend } from '@/lib/invoice-guard'

const pad = (n: number) => String(n).padStart(2, '0')

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await prisma.$disconnect()
})

// PER_CLEAN weekly client whose cleans land in the CURRENT month.
async function seedPerCleanCurrentMonth() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 2, 12, 0, 0))
  const client = await prisma.client.create({ data: { name: 'PerClean Co', billingType: 'PER_CLEAN', cleanerPayType: 'PER_CLEAN' } })
  const location = await prisma.location.create({ data: { clientId: client.id, name: 'Site', address: '2 Rd' } })
  const sub = await prisma.subcontractor.create({ data: { name: 'Sam' } })
  const schedule = await prisma.schedule.create({
    data: {
      locationId: location.id, subcontractorId: sub.id, frequency: 'WEEKLY',
      daysOfWeek: JSON.stringify([start.getUTCDay()]), timeType: 'SPECIFIC', startTime: '10:00',
      defaultClientRate: 120, defaultSubcontractorRate: 80, clientPayType: 'PER_CLEAN', subcontractorPayType: 'PER_CLEAN',
      startDate: start,
    },
  })
  return { client, location, schedule, y, m }
}

function periodFor(y: number, m: number) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(last)}` }
}

async function getCandidate(clientId: string, y: number, m: number) {
  const { start, end } = periodFor(y, m)
  const res = await candidatesGET(new Request(`http://test/api/invoices/candidates?start=${start}&end=${end}`))
  const json = await res.json()
  return json.candidates.find((c: { clientId: string }) => c.clientId === clientId)
}

interface CandidateLineItem {
  description: string; quantity: number; price: number; sourceType: string; sourceId?: string; jobId?: string
}

describe('cancellation fee — rides the regular invoice', () => {
  it('bills a cancelled clean as a CANCELLATION_FEE line item on the regular invoice', async () => {
    const { client, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m) // generate this month's cleans

    const jobs = await prisma.job.findMany({ where: { location: { clientId: client.id } }, orderBy: { date: 'asc' } })
    const cleanCount = jobs.length
    expect(cleanCount).toBeGreaterThan(1)

    // Cancel the first clean WITH a $90 fee (what the cancellation sheet now does).
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED', cancellationFee: 90 } })

    const candidate = await getCandidate(client.id, y, m)
    const items: CandidateLineItem[] = candidate.lineItems
    const feeItem = items.find((li) => li.sourceType === 'CANCELLATION_FEE')

    expect(feeItem).toBeDefined()
    expect(feeItem!.price).toBe(90)
    expect(feeItem!.jobId).toBe(jobs[0].id)
    // Remaining cleans (cleanCount - 1) at $120 + the $90 fee.
    expect(candidate.total).toBe((cleanCount - 1) * 120 + 90)
    // The cancelled clean is not double-counted as a billable clean.
    expect(candidate.jobIds).not.toContain(jobs[0].id)
  })

  it('the fee does NOT trip the pre-invoice guard, and never double-bills', async () => {
    const { client, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m)
    const jobs = await prisma.job.findMany({ where: { location: { clientId: client.id } }, orderBy: { date: 'asc' } })
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED', cancellationFee: 90 } })

    const candidate = await getCandidate(client.id, y, m)
    const { start, end } = periodFor(y, m)

    // Create the DRAFT invoice from the candidate (mirrors the workspace mapping).
    const createRes = await fromCandidatePOST(new Request('http://test/api/invoices/from-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: client.id,
        start,
        end,
        sourceJobIds: candidate.jobIds,
        lineItems: candidate.lineItems.map((li: CandidateLineItem) => ({
          description: li.description,
          amount: li.price * li.quantity,
          jobId: li.jobId || null,
          addOnServiceId: li.sourceType === 'ADD_ON' ? li.sourceId || null : null,
        })),
      }),
    }))
    expect(createRes.status).toBe(200)
    const invoice = await createRes.json()

    // The cancelled clean is on the invoice (as a fee) but the guard must NOT flag it.
    const guard = await evaluateInvoiceForSend(invoice.id)
    expect(guard.matches).toBe(true)
    expect(guard.findings).toHaveLength(0)

    // Re-running candidates must not re-add the fee (reserved by the line item's jobId).
    const after = await getCandidate(client.id, y, m)
    const feeItemsAfter = (after?.lineItems ?? []).filter((li: CandidateLineItem) => li.sourceType === 'CANCELLATION_FEE')
    expect(feeItemsAfter).toHaveLength(0)
  })

  it('restoring a cancelled clean clears its fee (no phantom charge)', async () => {
    const { client, y, m } = await seedPerCleanCurrentMonth()
    await getCandidate(client.id, y, m)
    const jobs = await prisma.job.findMany({ where: { location: { clientId: client.id } }, orderBy: { date: 'asc' } })
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'CANCELLED', cancellationFee: 90 } })

    // Restore via the same field-clearing the job route does on un-cancel.
    await prisma.job.update({ where: { id: jobs[0].id }, data: { status: 'SCHEDULED', cancellationFee: null } })

    const candidate = await getCandidate(client.id, y, m)
    const feeItems = candidate.lineItems.filter((li: CandidateLineItem) => li.sourceType === 'CANCELLATION_FEE')
    expect(feeItems).toHaveLength(0)
  })
})
