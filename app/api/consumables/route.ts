import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'
import { revalidatePath } from 'next/cache'
import { validateConsumable, type ConsumableKind } from '@/lib/consumables'

export const dynamic = 'force-dynamic'

const KINDS: ConsumableKind[] = ['RECURRING', 'ADHOC', 'ALLOWANCE']

/**
 * GET — consumables, filtered.
 *
 * `?clientId=` for one client's recurring charge, `?subcontractorId=` for a
 * cleaner's allowance slices, `?jobId=` for one visit's entries, and
 * `?period=yyyy-MM` to scope ad-hoc entries to a month.
 */
export async function GET(request: Request) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const url = new URL(request.url)
    const clientId = url.searchParams.get('clientId')
    const subcontractorId = url.searchParams.get('subcontractorId')
    const period = url.searchParams.get('period')
    const jobId = url.searchParams.get('jobId')
    const kind = url.searchParams.get('kind')

    let dateFilter: { gte: Date; lte: Date } | undefined
    if (period) {
      if (!/^\d{4}-\d{2}$/.test(period)) {
        return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
      }
      const [y, m] = period.split('-').map(Number)
      dateFilter = { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59, 999) }
    }

    const rows = await prisma.consumable.findMany({
      where: {
        isActive: true,
        ...(clientId ? { clientId } : {}),
        ...(subcontractorId ? { subcontractorId } : {}),
        ...(jobId ? { jobId } : {}),
        ...(kind && KINDS.includes(kind as ConsumableKind) ? { kind } : {}),
        // Only ad-hoc entries carry a date; the recurring ones apply to every
        // month, so a period filter must not exclude them.
        ...(dateFilter ? { OR: [{ date: dateFilter }, { date: null }] } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        subcontractor: { select: { id: true, name: true } },
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ consumables: rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('Error reading consumables:', error)
    return handleApiError(error, 'Failed to load consumables')
  }
}

/**
 * POST — start or change a consumable.
 *
 * RECURRING and ALLOWANCE are one-per-anchor, so this upserts rather than
 * piling up duplicates. Both sides of the money travel together: saving a
 * recurring charge sets the cleaner's payback in the same record, which is why
 * stopping it can never leave an orphaned payback behind.
 */
export async function POST(request: Request) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json().catch(() => ({}))
    const kind = body?.kind as ConsumableKind
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Unknown consumable type.' }, { status: 400 })
    }

    const bill = Number(body?.billAmount ?? 0)
    const payback = Number(body?.paybackAmount ?? 0)
    const problem = validateConsumable({ bill, payback })
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    const description =
      typeof body?.description === 'string' ? body.description.trim().slice(0, 200) : null

    if (kind === 'RECURRING') {
      const clientId = typeof body?.clientId === 'string' ? body.clientId : ''
      if (!clientId) return NextResponse.json({ error: 'Client is required' }, { status: 400 })

      // The payback goes to whoever actually cleans for this client. Resolved
      // here so the two sides cannot be pointed at different people.
      const subcontractorId = await cleanerForClient(clientId)

      const existing = await prisma.consumable.findFirst({
        where: { kind: 'RECURRING', clientId, isActive: true },
        select: { id: true },
      })
      const data = { billAmount: bill, paybackAmount: payback, subcontractorId, description }
      const row = existing
        ? await prisma.consumable.update({ where: { id: existing.id }, data })
        : await prisma.consumable.create({ data: { kind, clientId, ...data } })

      revalidatePath('/invoices')
      return NextResponse.json({ consumable: row }, { status: existing ? 200 : 201 })
    }

    if (kind === 'ALLOWANCE') {
      const subcontractorId = typeof body?.subcontractorId === 'string' ? body.subcontractorId : ''
      if (!subcontractorId) return NextResponse.json({ error: 'Cleaner is required' }, { status: 400 })
      if (bill > 0) {
        return NextResponse.json(
          { error: 'A standalone allowance is a payback only · nothing is billed to a client.' },
          { status: 400 },
        )
      }

      const existing = await prisma.consumable.findFirst({
        where: { kind: 'ALLOWANCE', subcontractorId, isActive: true },
        select: { id: true },
      })
      const data = { billAmount: 0, paybackAmount: payback, description }
      const row = existing
        ? await prisma.consumable.update({ where: { id: existing.id }, data })
        : await prisma.consumable.create({ data: { kind, subcontractorId, ...data } })

      revalidatePath('/payables')
      return NextResponse.json({ consumable: row }, { status: existing ? 200 : 201 })
    }

    // ADHOC — supplies bought on one visit.
    const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
    if (!jobId) return NextResponse.json({ error: 'Visit is required' }, { status: 400 })
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, date: true, subcontractorId: true, location: { select: { clientId: true } } },
    })
    if (!job) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })

    const row = await prisma.consumable.create({
      data: {
        kind: 'ADHOC',
        jobId,
        clientId: job.location.clientId,
        // Whoever worked the visit is who bought the supplies.
        subcontractorId: payback > 0 ? job.subcontractorId : null,
        description,
        billAmount: bill,
        paybackAmount: payback,
        date: job.date,
      },
    })

    revalidatePath('/invoices')
    revalidatePath('/calendar')
    return NextResponse.json({ consumable: row }, { status: 201 })
  } catch (error) {
    logger.error('Error saving consumable:', error)
    return handleApiError(error, 'Failed to save')
  }
}

/** The cleaner on this client's active schedule, or null if nobody is assigned. */
async function cleanerForClient(clientId: string): Promise<string | null> {
  const schedule = await prisma.schedule.findFirst({
    where: { isActive: true, location: { clientId }, subcontractorId: { not: null } },
    select: { subcontractorId: true },
    orderBy: { createdAt: 'asc' },
  })
  return schedule?.subcontractorId ?? null
}
