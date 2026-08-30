import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getErrorMessage } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import {
  accountOwed,
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
          schedule: {
            select: {
              paymentCadenceOverride: true,
              cleanerInvoiceUnit: true,
              subcontractorPayType: true,
              defaultSubcontractorRate: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true, propertyType: true, cleanerPayType: true } },
            },
          },
          invoiceLineItems: { select: { invoice: { select: { status: true } } } },
          // Add-ons this cleaner performed are paid on top of the clean.
          addOnServices: {
            select: { vendorId: true, subcontractorId: true, subcontractorRate: true },
          },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.cleanerInvoiceReceipt.findMany({
        where: { period },
        select: {
          subcontractorId: true,
          vendorId: true,
          locationId: true,
          jobId: true,
          addOnServiceId: true,
        },
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
          // Specialty work also arrives as add-ons, which are not Jobs. Without
          // these a vendor whose month is all add-ons shows nothing owed.
          addOnServices: {
            where: { vendorPaid: false },
            select: {
              id: true,
              description: true,
              subcontractorRate: true,
              vendorPaid: true,
              createdAt: true,
              job: {
                select: {
                  id: true,
                  date: true,
                  locationId: true,
                  location: { select: { id: true, name: true, client: { select: { id: true, name: true, propertyType: true } } } },
                  invoiceLineItems: { select: { invoice: { select: { status: true } } } },
                },
              },
              schedule: {
                select: {
                  locationId: true,
                  location: { select: { id: true, name: true, client: { select: { id: true, name: true, propertyType: true } } } },
                },
              },
            },
          },
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
    const perAddOn = new Set<string>()
    for (const r of receipts) {
      const payee = r.subcontractorId ?? r.vendorId
      if (r.addOnServiceId) perAddOn.add(`${payee}|${r.locationId}|${r.addOnServiceId}`)
      else if (r.jobId) perClean.add(`${payee}|${r.locationId}|${r.jobId}`)
      else accountWide.add(`${payee}|${r.locationId}`)
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

          // A FLAT_RATE recurring account owes its monthly rate ONCE, however
          // many cleans it had. Summing per clean inflated this by the visit
          // count — 12x on the real data.
          const payType: 'FLAT_RATE' | 'PER_CLEAN' =
            (first.schedule?.subcontractorPayType ?? first.location.client.cleanerPayType) === 'FLAT_RATE'
              ? 'FLAT_RATE'
              : 'PER_CLEAN'
          const monthlyRate =
            first.schedule?.defaultSubcontractorRate ?? first.subcontractorRate ?? 0
          const owed = accountOwed(
            accountJobs.map(j => ({
              id: j.id,
              paid: j.subcontractorPaid,
              rate: j.subcontractorRate || 0,
              cancelled: j.status === 'CANCELLED',
              cancellationFee: j.cancellationFee,
              scheduleId: j.scheduleId,
              // Work done by an outside vendor, or by a different in-house
              // cleaner, is paid through them rather than this cleaner.
              addOnRate: (j.addOnServices ?? []).reduce(
                (sum, a) =>
                  !a.vendorId && (!a.subcontractorId || a.subcontractorId === c.id)
                    ? sum + (a.subcontractorRate || 0)
                    : sum,
                0,
              ),
            })),
            payType,
            monthlyRate,
          )

          return {
            id: locationId,
            clientId: first.location.client.id,
            clientName: first.location.client.name,
            locationName: first.location.name,
            propertyType: first.location.client.propertyType,
            invoiceUnit: unit,
            clientHasPaid,
            invoiceTally: tallyAccountInvoices(account),
            payType,
            owed,
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

        // An account is ready as a whole: its money moves together, so the
        // account's owed figure lands in one bucket or the other.
        let readyNow = 0
        let stillOwed = 0
        let unpaidJobs = 0
        for (const a of accounts) {
          const unpaid = a.jobs.filter(j => !j.paid)
          unpaidJobs += unpaid.length
          if (unpaid.length === 0) continue
          if (unpaid.every(j => j.state === 'ready')) readyNow += a.owed
          else stillOwed += a.owed
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
        // A vendor's month is jobs AND add-ons. Normalise both into one item
        // shape so an account can hold a mix without the UI caring which.
        type Item = {
          id: string
          kind: 'job' | 'addon'
          date: string
          label: string | null
          amount: number
          paid: boolean
          locationId: string
          location: { id: string; name: string; client: { id: string; name: string; propertyType: string | null } }
          lineItems: { invoice: { status: string } }[]
        }

        const items: Item[] = []

        for (const j of v.jobs) {
          items.push({
            id: j.id,
            kind: 'job',
            date: j.date.toISOString(),
            label: null,
            amount: j.subcontractorRate || 0,
            paid: j.vendorPaid,
            locationId: j.locationId,
            location: j.location,
            lineItems: j.invoiceLineItems,
          })
        }

        for (const a of v.addOnServices) {
          const loc = a.job?.location ?? a.schedule?.location ?? null
          const locationId = a.job?.locationId ?? a.schedule?.locationId ?? null
          if (!loc || !locationId) continue
          // A schedule-linked add-on has no date of its own; fall back to when
          // it was created so it still lands in a month.
          const when = a.job?.date ?? a.createdAt
          if (when < start || when > end) continue
          items.push({
            id: a.id,
            kind: 'addon',
            date: when.toISOString(),
            label: a.description,
            amount: a.subcontractorRate || 0,
            paid: a.vendorPaid,
            locationId,
            location: loc,
            lineItems: a.job?.invoiceLineItems ?? [],
          })
        }

        const byAccount = new Map<string, Item[]>()
        for (const it of items) {
          const list = byAccount.get(it.locationId) ?? []
          list.push(it)
          byAccount.set(it.locationId, list)
        }

        const accounts = Array.from(byAccount.entries()).map(([locationId, accountItems]) => {
          const first = accountItems[0]
          const unpaid = accountItems.filter(i => !i.paid)
          const invoicedIds = unpaid
            .filter(i =>
              i.kind === 'addon'
                ? perAddOn.has(`${v.id}|${locationId}|${i.id}`)
                : perClean.has(`${v.id}|${locationId}|${i.id}`),
            )
            .map(i => i.id)

          const lineItems = accountItems.flatMap(i => i.lineItems)
          const clientHasPaid =
            lineItems.length > 0 && lineItems.every(li => li.invoice.status === 'PAID')

          const account: CleanerAccount = {
            id: locationId,
            clientName: first.location.client.name,
            invoiceUnit: 'PER_CLEAN',
            jobIds: unpaid.map(i => i.id),
            invoicedJobIds: invoicedIds,
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
            jobs: accountItems.map(i => ({
              id: i.id,
              kind: i.kind,
              label: i.label,
              date: i.date,
              amount: i.amount,
              paid: i.paid,
              cancelled: false,
              invoiced: account.invoicedJobIds.includes(i.id),
              state: jobPayState({
                jobId: i.id,
                paid: i.paid,
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
