import { NextResponse } from "next/server"
import { format } from "date-fns"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { getBillingStartDate } from "@/lib/billing-settings"
import { getEffectiveCadence, isJobPayable, getPayableStatusText } from "@/lib/payment-cadence"
import type { CadenceSubcontractorInfo, CadenceScheduleInfo, CadenceJobInfo } from "@/lib/payment-cadence"
import { buildSubcontractorPayLedger } from "@/lib/payout-calculator"
import { ensureOperationalDataForDateRange } from "@/lib/operational-reconciliation"

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
  itemKind?: 'job' | 'addon' // 'job' = clean/job ids; 'addon' = add-on ids
  payableItemIds: string[] // job ids (cleaner) / add-on ids (vendor / cleaner add-on) payable now
  allItemIds: string[]
  cleans: Array<{ date: string; amount: number }>
  propertyType: string | null
  payablePeriods: string[]
  payeeInvoiceStatus: 'matched' | 'missing' | 'mismatch' | 'not-required'
  clientInvoiceIds: string[]
  canMarkClientPaid: boolean
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

type PayeeInvoiceCoverageRow = {
  payeeId: string
  period: string
  status: string
}

function applyPayeeInvoiceCoverage(payees: Payable[], rows: PayeeInvoiceCoverageRow[]) {
  const byPayeePeriod = new Map<string, Set<string>>()
  rows.forEach((row) => {
    const key = `${row.payeeId}:${row.period}`
    const statuses = byPayeePeriod.get(key) || new Set<string>()
    statuses.add(row.status)
    byPayeePeriod.set(key, statuses)
  })

  payees.forEach((payee) => {
    payee.accounts.forEach((account) => {
      if (account.payableItemIds.length === 0 || account.payablePeriods.length === 0) {
        account.payeeInvoiceStatus = 'not-required'
        return
      }

      const uncovered = account.payablePeriods.filter((period) => {
        const statuses = byPayeePeriod.get(`${payee.id}:${period}`)
        return !statuses || (!statuses.has('MATCHED') && !statuses.has('RESOLVED'))
      })

      if (uncovered.length === 0) {
        account.payeeInvoiceStatus = 'matched'
        return
      }

      account.payeeInvoiceStatus = uncovered.some((period) => {
        const statuses = byPayeePeriod.get(`${payee.id}:${period}`)
        return statuses?.has('MISMATCH') || statuses?.has('PENDING')
      }) ? 'mismatch' : 'missing'
    })
  })
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
    const payablesEnsureStart =
      isCurrent && billingStartDate && billingStartDate < monthStart
        ? billingStartDate
        : monthStart
    const payablesEnsureEnd = isCurrent ? today : monthEnd

    await ensureOperationalDataForDateRange({
      startDate: payablesEnsureStart,
      endDate: payablesEnsureEnd,
      surface: 'payables',
    })

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
        invoiceLineItems: { include: { invoice: { select: { id: true, status: true } } } },
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
          fastPay: sub.fastPay,
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
            const waitingCadence = waitingJob
              ? getEffectiveCadence(cadenceSub, scheduleFor(waitingJob.scheduleId))
              : null
            const clientInvoiceIds = Array.from(new Set(
              groupJobs.flatMap((job) =>
                job.invoiceLineItems
                  .filter((lineItem) => lineItem.invoice.status !== 'PAID')
                  .map((lineItem) => lineItem.invoice.id),
              ),
            ))
            const canMarkClientPaid = Boolean(
              waitingJob &&
              clientInvoiceIds.length > 0 &&
              (waitingCadence === 'AFTER_CLIENT_PAYS' || waitingCadence === 'COMMERCIAL_CLIENT_PAID_OR_7TH'),
            )
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
                amount: (j.subcontractorRate || 0) + (j.addOnServices?.reduce((s, a) => s + ((!a.vendorId && (!a.subcontractorId || a.subcontractorId === sub.id)) ? (a.subcontractorRate || 0) : 0), 0) || 0),
              })),
              propertyType: groupJobs[0]?.location.client.propertyType || null,
              payablePeriods: Array.from(new Set(groupJobs.filter(payableOf).map((job) => format(job.date, 'yyyy-MM')))),
              payeeInvoiceStatus: 'not-required' as const,
              clientInvoiceIds,
              canMarkClientPaid,
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
    // ── CLEANER-ASSIGNED ADD-ONS (Payout-B) ───────────────────────────────
    // Add-ons performed by a DIFFERENT in-house cleaner than the one running the
    // schedule/job. They pay the performer — surfaced as that cleaner's own
    // "ready to pay" account, separate from their regular cleans.
    const assignedAddOns = await prisma.addOnService.findMany({
      where: { subcontractorId: { in: subIds }, subcontractorPaid: false },
      select: {
        id: true,
        subcontractorRate: true,
        subcontractorId: true,
        createdAt: true,
        job: { select: { date: true, subcontractorId: true, location: { select: { client: { select: { id: true, name: true, propertyType: true } } } } } },
        schedule: { select: { subcontractorId: true, location: { select: { client: { select: { id: true, name: true, propertyType: true } } } } } },
      },
    })
    // performer id → clientId → account accumulator
    const addOnsBySub = new Map<string, Map<string, { clientName: string; propertyType: string | null; owed: number; ids: string[]; cleans: Array<{ date: string; amount: number }> }>>()
    for (const a of assignedAddOns) {
      const performer = a.subcontractorId
      if (!performer) continue
      const owner = a.job?.subcontractorId ?? a.schedule?.subcontractorId ?? null
      if (owner === performer) continue // same-cleaner add-on: already paid via the job
      if (billingStartDate && a.job?.date && a.job.date < billingStartDate) continue
      const client = a.job?.location.client || a.schedule?.location.client || null
      const clientId = client?.id || 'unassigned'
      const clientName = client?.name ? `${client.name} · add-ons` : 'Add-ons performed'
      const byClient = addOnsBySub.get(performer) || new Map()
      const e = byClient.get(clientId) || { clientName, propertyType: client?.propertyType || null, owed: 0, ids: [] as string[], cleans: [] as Array<{ date: string; amount: number }> }
      e.owed += a.subcontractorRate
      e.ids.push(a.id)
      e.cleans.push({ date: (a.job?.date || a.createdAt).toISOString(), amount: a.subcontractorRate })
      byClient.set(clientId, e)
      addOnsBySub.set(performer, byClient)
    }
    // Merge add-on accounts into the matching cleaner and bump their totals.
    for (const c of allCleaners) {
      const byClient = addOnsBySub.get(c.id)
      if (!byClient) continue
      for (const [clientId, e] of byClient.entries()) {
        c.accounts.push({
          id: `${c.id}:addon:${clientId}`,
          clientName: e.clientName,
          owed: e.owed,
          safeOwed: e.owed,
          waitingOwed: 0,
          status: 'safe',
          reason: 'Add-on you performed — ready to pay',
          payType: 'PER_CLEAN',
          itemKind: 'addon',
          payableItemIds: e.ids,
          allItemIds: e.ids,
          cleans: e.cleans,
          propertyType: e.propertyType,
          payablePeriods: Array.from(new Set(e.cleans.map((clean) => format(new Date(clean.date), 'yyyy-MM')))),
          payeeInvoiceStatus: 'not-required',
          clientInvoiceIds: [],
          canMarkClientPaid: false,
        })
        c.total += e.owed
        c.safe += e.owed
      }
    }

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
            job: { select: { id: true, date: true, location: { select: { client: { select: { id: true, name: true, propertyType: true } } } } } },
            schedule: { select: { location: { select: { client: { select: { id: true, name: true, propertyType: true } } } } } },
          },
        },
        jobs: {
          where: {
            vendorPaid: false,
            scheduleId: null,
            ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
            OR: [{ status: 'COMPLETED' }, { status: 'SCHEDULED', date: { lte: today } }],
          },
          select: {
            id: true,
            subcontractorRate: true,
            date: true,
            location: { select: { client: { select: { id: true, name: true, propertyType: true } } } },
          },
        },
      },
    })

    const allVendors: Payable[] = vendorRows
      .map((v) => {
        const byClient = new Map<string, {
          clientName: string
          propertyType: string | null
          addOns: typeof v.addOnServices
          jobs: typeof v.jobs
        }>()
        v.addOnServices.forEach((a) => {
          const client = a.job?.location.client || a.schedule?.location.client || null
          const key = client?.id || 'unassigned'
          const name = client?.name || 'Unassigned'
          const e = byClient.get(key) || { clientName: name, propertyType: client?.propertyType || null, addOns: [], jobs: [] }
          e.addOns.push(a)
          byClient.set(key, e)
        })
        v.jobs.forEach((job) => {
          const client = job.location.client
          const key = client?.id || 'unassigned'
          const name = client?.name || 'Unassigned'
          const e = byClient.get(key) || { clientName: name, propertyType: client?.propertyType || null, addOns: [], jobs: [] }
          e.jobs.push(job)
          byClient.set(key, e)
        })
        const accounts: PayableAccount[] = Array.from(byClient.entries()).flatMap(([clientId, e]) => {
          const rows: PayableAccount[] = []
          if (e.addOns.length > 0) {
            const owed = e.addOns.reduce((sum, addOn) => sum + addOn.subcontractorRate, 0)
            rows.push({
              id: `${v.id}:${clientId}:addons`,
              clientName: e.jobs.length > 0 ? `${e.clientName} · add-ons` : e.clientName,
              owed,
              safeOwed: owed,
              waitingOwed: 0,
              status: 'safe' as AccountStatus,
              reason: 'Ready to pay',
              payType: 'PER_CLEAN',
              itemKind: 'addon',
              payableItemIds: e.addOns.map((addOn) => addOn.id),
              allItemIds: e.addOns.map((addOn) => addOn.id),
              cleans: e.addOns.map((addOn) => ({
                date: (addOn.job?.date || addOn.createdAt).toISOString(),
                amount: addOn.subcontractorRate,
              })),
              propertyType: e.propertyType,
              payablePeriods: Array.from(new Set(e.addOns.map((addOn) => format(new Date(addOn.job?.date || addOn.createdAt), 'yyyy-MM')))),
              payeeInvoiceStatus: 'not-required',
              clientInvoiceIds: [],
              canMarkClientPaid: false,
            })
          }
          if (e.jobs.length > 0) {
            const owed = e.jobs.reduce((sum, job) => sum + job.subcontractorRate, 0)
            rows.push({
              id: `${v.id}:${clientId}:jobs`,
              clientName: e.addOns.length > 0 ? `${e.clientName} · one-off jobs` : e.clientName,
              owed,
              safeOwed: owed,
              waitingOwed: 0,
              status: 'safe' as AccountStatus,
              reason: 'Vendor-performed one-off job · ready to pay',
              payType: 'PER_CLEAN',
              itemKind: 'job',
              payableItemIds: e.jobs.map((job) => job.id),
              allItemIds: e.jobs.map((job) => job.id),
              cleans: e.jobs.map((job) => ({
                date: job.date.toISOString(),
                amount: job.subcontractorRate,
              })),
              propertyType: e.propertyType,
              payablePeriods: Array.from(new Set(e.jobs.map((job) => format(job.date, 'yyyy-MM')))),
              payeeInvoiceStatus: 'not-required',
              clientInvoiceIds: [],
              canMarkClientPaid: false,
            })
          }
          return rows
        })
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

    // Surface the payee-invoice gate in the workspace. Payment endpoints still
    // enforce this independently; this is only the read model that tells Grace
    // which rows are genuinely ready and which need an invoice or review first.
    const [cleanerInvoiceRows, vendorInvoiceRows] = await Promise.all([
      prisma.cleanerInvoice.findMany({
        where: { subcontractorId: { in: subIds } },
        select: { subcontractorId: true, period: true, status: true },
      }),
      prisma.vendorInvoice.findMany({
        where: { vendorId: { in: vendorRows.map((vendor) => vendor.id) } },
        select: { vendorId: true, period: true, status: true },
      }),
    ])
    applyPayeeInvoiceCoverage(
      allCleaners,
      cleanerInvoiceRows.map((invoice) => ({ payeeId: invoice.subcontractorId, period: invoice.period, status: invoice.status })),
    )
    applyPayeeInvoiceCoverage(
      allVendors,
      vendorInvoiceRows.map((invoice) => ({ payeeId: invoice.vendorId, period: invoice.period, status: invoice.status })),
    )

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
