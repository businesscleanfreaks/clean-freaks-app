import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

type ResetRequestItem = {
  invoiceId?: string
  jobIds?: string[]
}

const FINAL_INVOICE_STATUSES = ['SENT', 'PAID']

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export async function POST(request: Request) {
  try {
    await requireAuth()

    const body = await request.json().catch(() => ({}))
    const items = Array.isArray(body.items) ? (body.items as ResetRequestItem[]) : []

    const invoiceIds = uniqueStrings(items.map(item => item.invoiceId))
    const manualJobIds = uniqueStrings(items.flatMap(item => item.jobIds || []))

    if (invoiceIds.length === 0 && manualJobIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one draft invoice or manually marked job to return to Review.' },
        { status: 400 }
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      let deletedInvoices = 0
      let jobsReset = 0
      const skippedInvoices: Array<{ id: string; reason: string }> = []
      const touchedClientIds = new Set<string>()

      if (invoiceIds.length > 0) {
        const invoices = await tx.invoice.findMany({
          where: { id: { in: invoiceIds } },
          include: {
            lineItems: {
              include: {
                job: {
                  select: {
                    id: true,
                    scheduleId: true,
                    date: true,
                  },
                },
              },
            },
          },
        })

        const foundInvoiceIds = new Set(invoices.map(invoice => invoice.id))
        invoiceIds.forEach(id => {
          if (!foundInvoiceIds.has(id)) skippedInvoices.push({ id, reason: 'Invoice not found' })
        })

        for (const invoice of invoices) {
          touchedClientIds.add(invoice.clientId)

          if (invoice.status !== 'DRAFT') {
            skippedInvoices.push({
              id: invoice.id,
              reason: `${invoice.invoiceNumber} is ${invoice.status.toLowerCase()}, so it was left alone.`,
            })
            continue
          }

          const directJobIds = uniqueStrings(invoice.lineItems.map(item => item.jobId))
          const scheduleMonthKeys = new Map<string, { scheduleId: string; monthStart: Date; monthEnd: Date }>()

          invoice.lineItems.forEach(item => {
            if (!item.job?.scheduleId) return
            const date = new Date(item.job.date)
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
            scheduleMonthKeys.set(`${item.job.scheduleId}:${monthStart.toISOString()}`, {
              scheduleId: item.job.scheduleId,
              monthStart,
              monthEnd,
            })
          })

          const relatedRecurringJobs = scheduleMonthKeys.size > 0
            ? await tx.job.findMany({
                where: {
                  status: { not: 'CANCELLED' },
                  OR: Array.from(scheduleMonthKeys.values()).map(entry => ({
                    scheduleId: entry.scheduleId,
                    date: { gte: entry.monthStart, lte: entry.monthEnd },
                  })),
                  invoiceLineItems: {
                    none: { invoice: { status: { in: FINAL_INVOICE_STATUSES } } },
                  },
                },
                select: { id: true },
              })
            : []

          const invoiceJobIds = uniqueStrings([
            ...directJobIds,
            ...relatedRecurringJobs.map(job => job.id),
          ])

          if (invoiceJobIds.length > 0) {
            const updated = await tx.job.updateMany({
              where: {
                id: { in: invoiceJobIds },
                invoiceLineItems: {
                  none: { invoice: { status: { in: FINAL_INVOICE_STATUSES } } },
                },
              },
              data: { invoiced: false },
            })
            jobsReset += updated.count
          }

          await tx.invoice.delete({ where: { id: invoice.id } })
          deletedInvoices++
        }
      }

      if (manualJobIds.length > 0) {
        const updated = await tx.job.updateMany({
          where: {
            id: { in: manualJobIds },
            invoiceLineItems: {
              none: { invoice: { status: { in: FINAL_INVOICE_STATUSES } } },
            },
          },
          data: { invoiced: false },
        })
        jobsReset += updated.count
      }

      return {
        deletedInvoices,
        jobsReset,
        skippedInvoices,
        touchedClientIds: Array.from(touchedClientIds),
      }
    })

    revalidatePath('/invoices')
    result.touchedClientIds.forEach(clientId => revalidatePath(`/clients/${clientId}`))

    return NextResponse.json({
      success: true,
      message: `${result.deletedInvoices} draft invoice${result.deletedInvoices === 1 ? '' : 's'} deleted and ${result.jobsReset} job${result.jobsReset === 1 ? '' : 's'} returned to Review.`,
      ...result,
    })
  } catch (error) {
    logger.error('Bulk return invoices to review failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to return selected invoices to Review' },
      { status: 500 }
    )
  }
}
