import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getErrorMessage } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import {
  clampDay,
  jobPayState,
  tallyAccountInvoices,
  tallyCleanerInvoices,
  type CleanerAccount,
  type InvoiceUnit,
} from '@/lib/cleaner-payables'
import { getEffectiveCadence } from '@/lib/payment-cadence'

export const dynamic = 'force-dynamic'

/**
 * The Cleaners page: one row per cleaner, their accounts beneath, and what is
 * ready to pay right now.
 *
 * Built alongside `/api/payables/data` rather than replacing it, so the current
 * page keeps working while the new table is assembled on top of this.
 */

/** Cadences that hold end-of-month work until the client pays or the day comes. */
const HOLDING_CADENCES = new Set([
  'AFTER_CLIENT_PAYS',
  'END_OF_MONTH',
  'COMMERCIAL_CLIENT_PAID_OR_7TH',
])

function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) }
}

export async function GET(request: Request) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || new Date().toISOString().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'Period must look like 2026-08' }, { status: 400 })
    }
    const { start, end } = monthRange(period)
    const now = new Date()

    const [cleaners, jobs, receipts, payments, vendors] = await Promise.all([
      prisma.subcontractor.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          invoicesUs: true,
          payByDay: true,
          paymentCadence: true,
          fastPay: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.job.findMany({
        where: {
          subcontractorId: { not: null },
          date: { gte: start, lte: end },
          OR: [
            { status: 'COMPLETED' },
            { status: 'SCHEDULED', date: { lte: now } },
            // A cancelled clean still owes the cleaner its gas fee.
            { status: 'CANCELLED', cancellationFee: { gt: 0 } },
          ],
        },
        select: {
          id: true,
          date: true,
          status: true,
          subcontractorId: true,
          locationId: true,
          subcontractorRate: true,
          subcontractorPaid: true,
          cancellationFee: true,
          scheduleId: true,
          schedule: { select: { paymentCadenceOverride: true, cleanerInvoiceUnit: true } },
          location: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true, propertyType: true } },
            },
          },
          invoiceLineItems: { select: { invoice: { select: { status: true } } } },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.cleanerInvoiceReceipt.findMany({
        where: { period },
        select: { subcontractorId: true, locationId: true, jobId: true },
      }),
      // What has already gone out this month, for the "Paid so far" cell and
      // the log it opens.
      prisma.subcontractorPayment.findMany({
        where: { datePaid: { gte: start, lte: end } },
        select: {
          id: true,
          datePaid: true,
          totalAmount: true,
          paymentMethod: true,
          subcontractor: { select: { name: true } },
          _count: { select: { lineItems: true } },
        },
        orderBy: { datePaid: 'desc' },
      }),
      // Vendors are a separate model but the same mechanic: they invoice per
      // job and are paid per job. Their work is one-offs and add-ons, so it is
      // never held for a pay-by day — once the invoice is in, it is ready.
      prisma.vendor.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          services: true,
          jobs: {
            where: {
              vendorPaid: false,
              date: { gte: start, lte: end },
              // The vendor payment route only settles one-offs, so anything on a
              // schedule must not be offered here as payable.
              scheduleId: null,
              OR: [{ status: 'COMPLETED' }, { status: 'SCHEDULED', date: { lte: now } }],
            },
            select: {
              id: true,
              date: true,
              subcontractorRate: true,
              vendorPaid: true,
              locationId: true,
              location: {
                select: { id: true, name: true, client: { select: { id: true, name: true, propertyType: true } } },
              },
              invoiceLineItems: { select: { invoice: { select: { status: true } } } },
            },
          },
        },
      }),
    ])

    // Receipts indexed for lookup: account-wide ones and per-clean ones.
    const accountWide = new Set<string>()
    const perClean = new Set<string>()
    for (const r of receipts) {
      if (r.jobId) perClean.add(`${r.subcontractorId}|${r.locationId}|${r.jobId}`)
      else accountWide.add(`${r.subcontractorId}|${r.locationId}`)
    }

    type JobRow = (typeof jobs)[number]

    const rows = cleaners
      .map(c => {
        const mine = jobs.filter(j => j.subcontractorId === c.id)
        const payByDay = clampDay(c.payByDay)

        const byAccount = new Map<string, JobRow[]>()
        for (const j of mine) {
          const list = byAccount.get(j.locationId) ?? []
          list.push(j)
          byAccount.set(j.locationId, list)
        }

        const accounts = Array.from(byAccount.entries()).map(([locationId, accountJobs]) => {
          const first = accountJobs[0]
          const unit: InvoiceUnit =
            first.schedule?.cleanerInvoiceUnit === 'PER_CLEAN' ? 'PER_CLEAN' : 'PER_ACCOUNT'

          const unpaid = accountJobs.filter(j => !j.subcontractorPaid)
          const invoicedJobIds =
            unit === 'PER_ACCOUNT'
              ? accountWide.has(`${c.id}|${locationId}`)
                ? unpaid.map(j => j.id)
                : []
              : unpaid.filter(j => perClean.has(`${c.id}|${locationId}|${j.id}`)).map(j => j.id)

          // Paid means an invoice covers this work AND none are outstanding.
          const lineItems = accountJobs.flatMap(j => j.invoiceLineItems)
          const clientHasPaid =
            lineItems.length > 0 && lineItems.every(li => li.invoice.status === 'PAID')

          const cadence = getEffectiveCadence(
            { paymentCadence: c.paymentCadence, excludeClientIds: null, fastPay: c.fastPay },
            first.schedule ? { paymentCadenceOverride: first.schedule.paymentCadenceOverride } : null,
          )

          const account: CleanerAccount = {
            id: locationId,
            clientName: first.location.client.name,
            invoiceUnit: unit,
            jobIds: unpaid.map(j => j.id),
            invoicedJobIds,
            clientHasPaid,
            holdsUntilPayByDay: HOLDING_CADENCES.has(cadence),
          }

          const amountOf = (j: JobRow) =>
            j.status === 'CANCELLED' ? j.cancellationFee ?? 0 : j.subcontractorRate || 0

          return {
            id: locationId,
            clientId: first.location.client.id,
            clientName: first.location.client.name,
            locationName: first.location.name,
            propertyType: first.location.client.propertyType,
            invoiceUnit: unit,
            clientHasPaid,
            invoiceTally: tallyAccountInvoices(account),
            jobs: accountJobs.map(j => ({
              id: j.id,
              date: j.date.toISOString(),
              amount: amountOf(j),
              paid: j.subcontractorPaid,
              cancelled: j.status === 'CANCELLED',
              invoiced: account.invoicedJobIds.includes(j.id),
              state: jobPayState({
                jobId: j.id,
                paid: j.subcontractorPaid,
                account,
                invoicesUs: c.invoicesUs,
                payByDay,
                period,
                now,
              }),
            })),
            _account: account,
          }
        })

        let readyNow = 0
        let stillOwed = 0
        let unpaidJobs = 0
        for (const a of accounts) {
          for (const j of a.jobs) {
            if (j.paid) continue
            unpaidJobs += 1
            if (j.state === 'ready') readyNow += j.amount
            else stillOwed += j.amount
          }
        }

        return {
          id: c.id,
          name: c.name,
          kind: 'cleaner' as const,
          email: c.email,
          phone: c.phone,
          invoicesUs: c.invoicesUs,
          payByDay,
          accounts: accounts.map(({ _account, ...rest }) => rest),
          invoiceTally: tallyCleanerInvoices(accounts.map(a => a._account), c.invoicesUs),
          clientPaidTally: {
            paid: accounts.filter(a => a.clientHasPaid).length,
            total: accounts.length,
          },
          readyNow,
          stillOwed,
          unpaidJobs,
        }
      })
      .filter(r => r.accounts.length > 0)

    const vendorRows = vendors
      .map(v => {
        const byAccount = new Map<string, (typeof v.jobs)[number][]>()
        for (const j of v.jobs) {
          const list = byAccount.get(j.locationId) ?? []
          list.push(j)
          byAccount.set(j.locationId, list)
        }

        const accounts = Array.from(byAccount.entries()).map(([locationId, accountJobs]) => {
          const first = accountJobs[0]
          const unpaid = accountJobs.filter(j => !j.vendorPaid)
          const invoicedJobIds = unpaid
            .filter(j => perClean.has(`${v.id}|${locationId}|${j.id}`))
            .map(j => j.id)

          const lineItems = accountJobs.flatMap(j => j.invoiceLineItems)
          const clientHasPaid =
            lineItems.length > 0 && lineItems.every(li => li.invoice.status === 'PAID')

          const account: CleanerAccount = {
            id: locationId,
            clientName: first.location.client.name,
            invoiceUnit: 'PER_CLEAN',
            jobIds: unpaid.map(j => j.id),
            invoicedJobIds,
            clientHasPaid,
            // Vendor work is one-off: nothing to wait a pay-by day for.
            holdsUntilPayByDay: false,
          }

          return {
            id: locationId,
            clientId: first.location.client.id,
            clientName: first.location.client.name,
            locationName: first.location.name,
            propertyType: first.location.client.propertyType,
            invoiceUnit: 'PER_CLEAN' as const,
            clientHasPaid,
            invoiceTally: tallyAccountInvoices(account),
            jobs: accountJobs.map(j => ({
              id: j.id,
              date: j.date.toISOString(),
              amount: j.subcontractorRate || 0,
              paid: j.vendorPaid,
              cancelled: false,
              invoiced: account.invoicedJobIds.includes(j.id),
              state: jobPayState({
                jobId: j.id,
                paid: j.vendorPaid,
                account,
                invoicesUs: true,
                payByDay: 1,
                period,
                now,
              }),
            })),
            _account: account,
          }
        })

        let readyNow = 0
        let stillOwed = 0
        let unpaidJobs = 0
        for (const a of accounts) {
          for (const j of a.jobs) {
            if (j.paid) continue
            unpaidJobs += 1
            if (j.state === 'ready') readyNow += j.amount
            else stillOwed += j.amount
          }
        }

        return {
          id: v.id,
          name: v.name,
          kind: 'vendor' as const,
          specialty: v.services[0] ?? null,
          email: null,
          phone: null,
          invoicesUs: true,
          payByDay: 1,
          accounts: accounts.map(({ _account, ...rest }) => rest),
          invoiceTally: tallyCleanerInvoices(accounts.map(a => a._account), true),
          clientPaidTally: {
            paid: accounts.filter(a => a.clientHasPaid).length,
            total: accounts.length,
          },
          readyNow,
          stillOwed,
          unpaidJobs,
        }
      })
      .filter(r => r.accounts.length > 0)

    const totals = [...rows, ...vendorRows].reduce(
      (acc, r) => ({
        readyNow: acc.readyNow + r.readyNow,
        stillOwed: acc.stillOwed + r.stillOwed,
        unpaidJobs: acc.unpaidJobs + r.unpaidJobs,
      }),
      { readyNow: 0, stillOwed: 0, unpaidJobs: 0 },
    )

    const paidSoFar = payments.reduce((sum, p) => sum + p.totalAmount, 0)

    return NextResponse.json(
      {
        period,
        cleaners: rows,
        vendors: vendorRows,
        totals: { ...totals, paidSoFar },
        payments: payments.map(p => ({
          id: p.id,
          name: p.subcontractor.name,
          amount: p.totalAmount,
          date: p.datePaid.toISOString(),
          detail: `${p._count.lineItems} job${p._count.lineItems === 1 ? '' : 's'} · ${
            p.paymentMethod.charAt(0) + p.paymentMethod.slice(1).toLowerCase()
          }`,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
