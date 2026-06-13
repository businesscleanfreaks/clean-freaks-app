import { NextResponse } from "next/server"
import { format } from "date-fns"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { getBillingStartDate } from "@/lib/billing-settings"
import { isJobPayable, getPayableStatusText } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo, CadenceJobInfo } from "@/lib/payment-cadence"
import { buildSubcontractorPayLedger } from "@/lib/payout-calculator"

export const dynamic = 'force-dynamic'

type AccountStatus = 'safe' | 'waiting' | 'partial' | 'pay-today'

interface PayableAccount {
  id: string
  clientName: string
  owed: number
  safeOwed: number
  waitingOwed: number
  status: AccountStatus
  reason: string
  payType: string
  payableItemIds: string[] // job ids (cleaner) / add-on ids (vendor) that are payable now
  allItemIds: string[]
  cleans: Array<{ date: string; amount: number }>
}

interface Payable {
  id: string
  type: 'cleaner' | 'vendor'
  name: string
  initials: string
  zelleEmail: string | null
  contactPhone: string | null
  accounts: PayableAccount[]
  total: number
  safe: number
  waiting: number
  payToday: number
  fastPay: boolean
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Mirror buildSubcontractorPayLedger's grouping key so we can match a ledger
// group back to its source jobs.
function ledgerKey(job: { date: Date; scheduleId: string | null; location: { id: string; client: { id: string } }; id: string }): string {
  const monthKey = format(new Date(job.date), 'yyyy-MM')
  return job.scheduleId
    ? `${job.location.client.id}:${job.scheduleId}:${monthKey}`
    : `${job.location.client.id}:${job.location.id}:one-off:${job.id}`
}

/**
 * GET /api/payables/data
 * Consolidated "what we owe" — cleaners (subcontractors) + vendors, grouped into
 * per-client accounts with owed + a gate status (safe / waiting / partial).
 * Reuses the existing cadence + ledger helpers so the numbers never diverge.
 */
export async function GET(request: Request) {
  try {
    await requireAuth()
    const billingStartDate = await getBillingStartDate()
    const today = new Date()
    today.setHours(23, 59, 59, 999)

    // Selected month (for paid history). Owed is "now" and only shown for the
    // current month; past months show what was paid then.
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const periodParam = new URL(request.url).searchParams.get("period")
    const period = periodParam && /^\d{4}-\d{2}$/.test(periodParam) ? periodParam : currentPeriod
    const isCurrent = period === currentPeriod
    const [py, pm] = period.split("-").map(Number)
    const monthStart = new Date(py, pm - 1, 1, 0, 0, 0)
    const monthEnd = new Date(py, pm, 0, 23, 59, 59, 999)

    // ── CLEANERS ──────────────────────────────────────────────────────────
    const subcontractors = await prisma.subcontractor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })
    const subIds = subcontractors.map((s) => s.id)

    const unpaidJobs = await prisma.job.findMany({
      where: {
        subcontractorId: { in: subIds },
        subcontractorPaid: false,
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
        OR: [{ status: 'COMPLETED' }, { status: 'SCHEDULED', date: { lte: today } }],
      },
      include: {
        location: { include: { client: true } },
        addOnServices: true,
        schedule: true,
        invoiceLineItems: { include: { invoice: { select: { status: true } } } },
      },
      orderBy: { date: 'asc' },
    })

    const jobsBySub = new Map<string, typeof unpaidJobs>()
    unpaidJobs.forEach((j) => {
      if (!j.subcontractorId) return
      const arr = jobsBySub.get(j.subcontractorId) || []
      arr.push(j)
      jobsBySub.set(j.subcontractorId, arr)
    })

    const allCleaners: Payable[] = subcontractors
      .map((sub) => {
        const allJobs = jobsBySub.get(sub.id) || []
        const cadenceSub: CadenceSubcontractorInfo = {
          paymentCadence: sub.paymentCadence,
          excludeClientIds: sub.excludeClientIds,
        }
        const scheduleMap = new Map<string | null, CadenceScheduleInfo | null>()
        allJobs.forEach((j) => {
          if (j.scheduleId && j.schedule && !scheduleMap.has(j.scheduleId)) {
            scheduleMap.set(j.scheduleId, { paymentCadenceOverride: j.schedule.paymentCadenceOverride ?? null })
          }
        })
        const scheduleFor = (sid: string | null) => (sid ? scheduleMap.get(sid) || null : null)
        const payableOf = (j: (typeof allJobs)[number]) =>
          isJobPayable(j as unknown as CadenceJobInfo, cadenceSub, scheduleFor(j.scheduleId))

        const payableJobs = allJobs.filter(payableOf)
        const ledgerAll = buildSubcontractorPayLedger(allJobs)
        const ledgerSafe = buildSubcontractorPayLedger(payableJobs)
        const safeByKey = new Map(ledgerSafe.groups.map((g) => [g.clientId, g.owedAmount]))

        const accounts: PayableAccount[] = ledgerAll.groups
          .filter((g) => g.owedAmount > 0)
          .map((g) => {
            const safeOwed = safeByKey.get(g.clientId) || 0
            const waitingOwed = Math.max(0, g.owedAmount - safeOwed)
            let status: AccountStatus = waitingOwed === 0 ? 'safe' : safeOwed === 0 ? 'waiting' : 'partial'
            const groupJobs = allJobs.filter((j) => ledgerKey(j) === g.clientId)
            const waitingJob = groupJobs.find((j) => !payableOf(j))
            let reason = waitingJob
              ? getPayableStatusText(waitingJob as unknown as CadenceJobInfo, cadenceSub, scheduleFor(waitingJob.scheduleId))
              : 'Ready to pay'
            // Fast-pay (residential): a ready account flips to "Pay today" once its
            // latest clean has gone past 72h unpaid.
            if (sub.fastPay && status === 'safe') {
              const payableDates = groupJobs.filter(payableOf).map((j) => j.date.getTime())
              if (payableDates.length > 0) {
                const overdue = Date.now() - Math.max(...payableDates) >= 3 * 86400000
                status = overdue ? 'pay-today' : status
                reason = overdue ? 'Residential — pay within 72h (overdue)' : 'Residential — pay within 72h'
              }
            }
            return {
              id: g.clientId,
              clientName: g.clientName,
              owed: g.owedAmount,
              safeOwed,
              waitingOwed,
              status,
              reason,
              payType: g.payType,
              payableItemIds: groupJobs.filter(payableOf).map((j) => j.id),
              allItemIds: groupJobs.map((j) => j.id),
              cleans: groupJobs.map((j) => ({
                date: j.date.toISOString(),
                amount: (j.subcontractorRate || 0) + (j.addOnServices?.reduce((s, a) => s + (a.vendorId ? 0 : (a.subcontractorRate || 0)), 0) || 0),
              })),
            }
          })

        const total = ledgerAll.totalOwed
        const safe = ledgerSafe.totalOwed
        const payToday = accounts.filter((a) => a.status === 'pay-today').reduce((s, a) => s + a.safeOwed, 0)
        return {
          id: sub.id,
          type: 'cleaner' as const,
          name: sub.name,
          initials: initialsOf(sub.name),
          zelleEmail: sub.email || null,
          contactPhone: sub.phone || null,
          accounts,
          total,
          safe,
          waiting: Math.max(0, total - safe),
          payToday,
          fastPay: sub.fastPay,
        }
      })
    const cleaners = allCleaners.filter((c) => c.accounts.length > 0)
    const othersCleaners = allCleaners.filter((c) => c.accounts.length === 0)

    // ── VENDORS ───────────────────────────────────────────────────────────
    const vendorRows = await prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        addOnServices: {
          where: { vendorPaid: false },
          select: {
            id: true,
            subcontractorRate: true,
            description: true,
            createdAt: true,
            job: { select: { id: true, date: true, location: { select: { client: { select: { id: true, name: true } } } } } },
            schedule: { select: { location: { select: { client: { select: { id: true, name: true } } } } } },
          },
        },
      },
    })

    const allVendors: Payable[] = vendorRows
      .map((v) => {
        const byClient = new Map<string, { clientName: string; ids: string[]; owed: number; cleans: Array<{ date: string; amount: number }> }>()
        v.addOnServices.forEach((a) => {
          const client = a.job?.location.client || a.schedule?.location.client || null
          const key = client?.id || 'unassigned'
          const name = client?.name || 'Unassigned'
          const e = byClient.get(key) || { clientName: name, ids: [], owed: 0, cleans: [] }
          e.ids.push(a.id)
          e.owed += a.subcontractorRate
          e.cleans.push({ date: (a.job?.date || a.createdAt).toISOString(), amount: a.subcontractorRate })
          byClient.set(key, e)
        })
        const accounts: PayableAccount[] = Array.from(byClient.entries()).map(([clientId, e]) => ({
          id: `${v.id}:${clientId}`,
          clientName: e.clientName,
          owed: e.owed,
          safeOwed: e.owed,
          waitingOwed: 0,
          status: 'safe' as AccountStatus,
          reason: 'Ready to pay',
          payType: 'PER_CLEAN',
          payableItemIds: e.ids,
          allItemIds: e.ids,
          cleans: e.cleans,
        }))
        const total = accounts.reduce((s, a) => s + a.owed, 0)
        return {
          id: v.id,
          type: 'vendor' as const,
          name: v.name,
          initials: initialsOf(v.name),
          zelleEmail: v.zelle || v.email || null,
          contactPhone: v.phone || null,
          accounts,
          total,
          safe: total,
          waiting: 0,
          payToday: 0,
          fastPay: false,
        }
      })
    const vendors = allVendors.filter((v) => v.accounts.length > 0)
    const othersVendors = allVendors.filter((v) => v.accounts.length === 0)

    const sumBy = (arr: Payable[], f: (p: Payable) => number) => arr.reduce((s, x) => s + f(x), 0)
    const totals = {
      cleaners: { total: sumBy(cleaners, (c) => c.total), safe: sumBy(cleaners, (c) => c.safe), waiting: sumBy(cleaners, (c) => c.waiting), payToday: sumBy(cleaners, (c) => c.payToday) },
      vendors: { total: sumBy(vendors, (v) => v.total), safe: sumBy(vendors, (v) => v.safe), waiting: sumBy(vendors, (v) => v.waiting), payToday: 0 },
    }

    // ── PAID HISTORY for the selected month ───────────────────────────────
    const [subPayments, vendorPayments] = await Promise.all([
      prisma.subcontractorPayment.findMany({
        where: { datePaid: { gte: monthStart, lte: monthEnd } },
        include: { subcontractor: { select: { name: true } } },
        orderBy: { datePaid: 'desc' },
      }),
      prisma.vendorPayment.findMany({
        where: { datePaid: { gte: monthStart, lte: monthEnd } },
        include: { vendor: { select: { name: true } } },
        orderBy: { datePaid: 'desc' },
      }),
    ])
    const paidCleaners = subPayments.map((p) => ({
      paymentId: p.id, name: p.subcontractor.name, initials: initialsOf(p.subcontractor.name),
      amount: p.totalAmount, datePaid: p.datePaid.toISOString(), notes: p.notes || null,
    }))
    const paidVendors = vendorPayments.map((p) => ({
      paymentId: p.id, name: p.vendor.name, initials: initialsOf(p.vendor.name),
      amount: p.totalAmount, datePaid: p.datePaid.toISOString(), notes: p.notes || null,
    }))
    const paid = {
      cleaners: paidCleaners,
      vendors: paidVendors,
      total: paidCleaners.reduce((s, x) => s + x.amount, 0) + paidVendors.reduce((s, x) => s + x.amount, 0),
    }

    const emptyTotals = { cleaners: { total: 0, safe: 0, waiting: 0, payToday: 0 }, vendors: { total: 0, safe: 0, waiting: 0, payToday: 0 } }
    return NextResponse.json(
      {
        cleaners: isCurrent ? cleaners : [],
        vendors: isCurrent ? vendors : [],
        othersCleaners: isCurrent ? othersCleaners : [],
        othersVendors: isCurrent ? othersVendors : [],
        totals: isCurrent ? totals : emptyTotals,
        period,
        isCurrent,
        paid,
      },
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=59' } },
    )
  } catch (error) {
    console.error('Payables data error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payables' },
      { status: 500 },
    )
  }
}
