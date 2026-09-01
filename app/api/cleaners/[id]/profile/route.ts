import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/api-error-handler'
import { THRESHOLD_1099 } from '@/lib/payouts-1099'
import { accountOwedOverMonths } from '@/lib/cleaner-payables'
import { rangeBounds, type RangeKind } from '@/lib/profile-range'

export const dynamic = 'force-dynamic'

/** "YYYY-MM" in local time, matching how the range bounds are built. */
const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * Everything the cleaner profile shows: who they are, their accounts, the
 * one-off work, what we have paid them, their contacts, and their tax status.
 *
 * One request rather than six, because the page renders as a whole and the
 * round trips on this link dominate anything the queries cost.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { id } = await Promise.resolve(params)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || new Date().toISOString().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }
    // Month, quarter, or everything. The anchor month drives all three.
    const kindParam = url.searchParams.get('range')
    const kind: RangeKind =
      kindParam === 'quarter' || kindParam === 'all' ? kindParam : 'month'
    const bounds = rangeBounds(period, kind)

    const [y, m] = period.split('-').map(Number)
    const start = bounds.start ? new Date(`${bounds.start}T00:00:00`) : null
    const end = bounds.end ? new Date(`${bounds.end}T23:59:59.999`) : null
    // The $600 rule is a calendar year regardless of the range being viewed.
    const yearStart = new Date(y, 0, 1)
    const inRange = start && end ? { gte: start, lte: end } : undefined

    const cleaner = await prisma.subcontractor.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, phone: true, notes: true,
        isActive: true, createdAt: true, invoicesUs: true, payByDay: true,
        photoMimeType: true,
        w9OnFile: true, w9FileName: true, w9UploadedAt: true,
        legalName: true, taxIdType: true, taxIdLast4: true, profileNotes: true,
        contacts: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!cleaner) return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 })

    const [jobs, payments, paidThisYear] = await Promise.all([
      prisma.job.findMany({
        where: {
          subcontractorId: id,
          ...(inRange ? { date: inRange } : {}),
          // Same filter the Cleaners table uses, so the two never disagree:
          // work that happened, work due by now, and cancellations with a fee.
          OR: [
            { status: 'COMPLETED' },
            { status: 'SCHEDULED', date: { lte: new Date() } },
            { status: 'CANCELLED', cancellationFee: { gt: 0 } },
          ],
        },
        select: {
          id: true, date: true, status: true, scheduleId: true,
          subcontractorRate: true, subcontractorPaid: true, cancellationFee: true, notes: true,
          location: {
            select: {
              id: true, name: true,
              client: { select: { id: true, name: true, propertyType: true, cleanerPayType: true } },
            },
          },
          schedule: {
            select: {
              frequency: true,
              // How the CLEANER is paid. `clientPayType` is how the client is
              // billed — a different question, and using it here made this page
              // disagree with the Cleaners table.
              subcontractorPayType: true,
              defaultSubcontractorRate: true,
            },
          },
          // Add-ons this cleaner performed are paid on top of the clean.
          addOnServices: { select: { vendorId: true, subcontractorId: true, subcontractorRate: true } },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.subcontractorPayment.findMany({
        where: { subcontractorId: id },
        select: { id: true, datePaid: true, totalAmount: true, paymentMethod: true, notes: true },
        orderBy: { datePaid: 'desc' },
        take: 25,
      }),
      // The $600 rule is a calendar-year total, so it is not the period sum.
      prisma.subcontractorPayment.aggregate({
        where: { subcontractorId: id, datePaid: { gte: yearStart } },
        _sum: { totalAmount: true },
      }),
    ])

    // Group the month's work by account, keeping the visit log the design shows.
    const byAccount = new Map<string, typeof jobs>()
    for (const j of jobs) {
      if (!j.scheduleId) continue
      byAccount.set(j.location.id, [...(byAccount.get(j.location.id) ?? []), j])
    }

    const accounts = Array.from(byAccount.entries()).map(([locationId, list]) => {
      const first = list[0]
      const done = list.filter(j => j.status === 'COMPLETED')
      const skipped = list.filter(j => j.status === 'CANCELLED')
      const flat =
        (first.schedule?.subcontractorPayType ?? first.location.client.cleanerPayType) === 'FLAT_RATE'
      return {
        id: locationId,
        clientId: first.location.client.id,
        clientName: first.location.client.name,
        locationName: first.location.name,
        propertyType: first.location.client.propertyType,
        frequency: first.schedule?.frequency ?? null,
        payType: flat ? 'FLAT_RATE' : 'PER_CLEAN',
        rate: flat
          ? first.schedule?.defaultSubcontractorRate ?? first.subcontractorRate
          : first.subcontractorRate,
        completedCount: done.length,
        scheduledCount: list.length,
        skippedCount: skipped.length,
        allPaid: list.every(j => j.subcontractorPaid),
        // Must use the shared rule: a FLAT_RATE month owes its rate ONCE, not
        // once per clean. Summing per job here inflated Maggie to $171,290
        // against a true $13,140. Over a quarter or all time that "once" is
        // once per month, which is what the month key below is for.
        owed: accountOwedOverMonths(
          list.map(j => ({
            id: j.id,
            month: monthKey(j.date),
            paid: j.subcontractorPaid,
            rate: j.subcontractorRate || 0,
            cancelled: j.status === 'CANCELLED',
            cancellationFee: j.cancellationFee,
            scheduleId: j.scheduleId,
            // Work done by an outside vendor, or by a different in-house
            // cleaner, is paid through them rather than this one.
            addOnRate: (j.addOnServices ?? []).reduce(
              (sum, a) =>
                !a.vendorId && (!a.subcontractorId || a.subcontractorId === id)
                  ? sum + (a.subcontractorRate || 0)
                  : sum,
              0,
            ),
          })),
          flat ? 'FLAT_RATE' : 'PER_CLEAN',
          flat ? first.schedule?.defaultSubcontractorRate ?? first.subcontractorRate : 0,
        ),
        visits: list.map(j => ({
          id: j.id,
          date: j.date.toISOString(),
          status: j.status,
          amount: j.status === 'CANCELLED' ? j.cancellationFee ?? 0 : j.subcontractorRate || 0,
          note: j.notes,
          paid: j.subcontractorPaid,
        })),
      }
    })

    // One-off work is anything without a schedule.
    const oneOffs = jobs.filter(j => !j.scheduleId).map(j => ({
      id: j.id,
      date: j.date.toISOString(),
      clientName: j.location.client.name,
      note: j.notes,
      amount: j.subcontractorRate || 0,
      paid: j.subcontractorPaid,
    }))

    const yearTotal = paidThisYear._sum.totalAmount ?? 0

    return NextResponse.json(
      {
        cleaner: {
          id: cleaner.id,
          name: cleaner.name,
          email: cleaner.email,
          phone: cleaner.phone,
          isActive: cleaner.isActive,
          since: cleaner.createdAt.toISOString(),
          invoicesUs: cleaner.invoicesUs,
          payByDay: cleaner.payByDay,
          hasPhoto: !!cleaner.photoMimeType,
          notes: cleaner.profileNotes ?? cleaner.notes,
        },
        range: { kind, start: bounds.start, end: bounds.end },
        accounts,
        oneOffs,
        payments: payments.map(p => ({
          id: p.id,
          date: p.datePaid.toISOString(),
          amount: p.totalAmount,
          method: p.paymentMethod,
          notes: p.notes,
        })),
        contacts: cleaner.contacts,
        tax: {
          w9OnFile: cleaner.w9OnFile,
          w9FileName: cleaner.w9FileName,
          w9UploadedAt: cleaner.w9UploadedAt?.toISOString() ?? null,
          legalName: cleaner.legalName,
          taxIdType: cleaner.taxIdType,
          taxIdLast4: cleaner.taxIdLast4,
          paidThisYear: yearTotal,
          year: y,
          over1099Threshold: yearTotal >= THRESHOLD_1099,
          threshold: THRESHOLD_1099,
        },
        owedNow: accounts.reduce((sum, a) => sum + a.owed, 0)
          + oneOffs.filter(o => !o.paid).reduce((sum, o) => sum + o.amount, 0),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    logger.error('Error loading cleaner profile:', error)
    return handleApiError(error, 'Failed to load the profile')
  }
}
