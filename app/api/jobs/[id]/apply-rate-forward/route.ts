import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { hasFinalInvoice } from '@/lib/invoice-status'
import { revalidateInvoicePages, revalidateSchedulePages } from '@/lib/revalidate'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  clientRate: z.number().min(0, 'Client rate must be non-negative').optional(),
  subcontractorRate: z.number().min(0, 'Cleaner rate must be non-negative').optional(),
  subcontractorId: z.string().min(1).nullable().optional(),
}).refine(
  value => value.clientRate !== undefined || value.subcontractorRate !== undefined || value.subcontractorId !== undefined,
  { message: 'Provide a rate or cleaner change' },
)

async function recalculateDraftInvoiceTotal(invoiceId: string, tx: Prisma.TransactionClient) {
  const lineItems = await tx.invoiceLineItem.findMany({
    where: { invoiceId },
    select: { amount: true },
  })
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { totalAmount: lineItems.reduce((sum, item) => sum + item.amount, 0) },
  })
}

/**
 * Apply cleaner and/or rate changes to this recurring clean and all editable
 * occurrences after it. Paid, cancelled, and finalized-invoice jobs are kept
 * unchanged, while draft invoice amounts follow an updated client rate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    await requireAuth()
    const { id } = await Promise.resolve(params)

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const updates = parsed.data

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        date: true,
        scheduleId: true,
        status: true,
        subcontractorPaid: true,
        vendorPaid: true,
        invoiceLineItems: { select: { invoice: { select: { status: true } } } },
        location: { select: { clientId: true } },
        schedule: {
          select: {
            defaultClientRate: true,
            defaultSubcontractorRate: true,
            subcontractorId: true,
          },
        },
      },
    })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!job.scheduleId || !job.schedule) {
      return NextResponse.json({ error: 'This clean is not part of a recurring schedule' }, { status: 400 })
    }
    if (hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || job.vendorPaid || job.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'This clean is locked by an invoice, payment, or cancellation.' },
        { status: 409 },
      )
    }

    const previous = {
      clientRate: job.schedule.defaultClientRate,
      subcontractorRate: job.schedule.defaultSubcontractorRate,
      subcontractorId: job.schedule.subcontractorId,
    }

    const result = await prisma.$transaction(async tx => {
      const seriesJobs = await tx.job.findMany({
        where: { scheduleId: job.scheduleId!, date: { gte: job.date } },
        select: {
          id: true,
          status: true,
          subcontractorPaid: true,
          vendorPaid: true,
          invoiceLineItems: { select: { invoice: { select: { status: true } } } },
        },
      })
      const updatableIds = seriesJobs
        .filter(seriesJob =>
          !hasFinalInvoice(seriesJob.invoiceLineItems) &&
          !seriesJob.subcontractorPaid &&
          !seriesJob.vendorPaid &&
          seriesJob.status !== 'CANCELLED'
        )
        .map(seriesJob => seriesJob.id)

      const scheduleData: Prisma.ScheduleUncheckedUpdateInput = {}
      const jobData: Prisma.JobUncheckedUpdateManyInput = {}
      if (updates.clientRate !== undefined) {
        scheduleData.defaultClientRate = updates.clientRate
        jobData.clientRate = updates.clientRate
      }
      if (updates.subcontractorRate !== undefined) {
        scheduleData.defaultSubcontractorRate = updates.subcontractorRate
        jobData.subcontractorRate = updates.subcontractorRate
      }
      if (updates.subcontractorId !== undefined) {
        scheduleData.subcontractorId = updates.subcontractorId
        jobData.subcontractorId = updates.subcontractorId
      }

      await tx.schedule.update({ where: { id: job.scheduleId! }, data: scheduleData })
      await tx.job.updateMany({ where: { id: { in: updatableIds } }, data: jobData })

      const draftInvoiceIds = new Set<string>()
      if (updates.clientRate !== undefined && updatableIds.length > 0) {
        const draftLineItems = await tx.invoiceLineItem.findMany({
          where: {
            jobId: { in: updatableIds },
            addOnServiceId: null,
            invoice: { status: 'DRAFT' },
          },
          select: { id: true, invoiceId: true },
        })
        for (const item of draftLineItems) {
          await tx.invoiceLineItem.update({
            where: { id: item.id },
            data: { amount: updates.clientRate },
          })
          draftInvoiceIds.add(item.invoiceId)
        }
        for (const invoiceId of draftInvoiceIds) {
          await recalculateDraftInvoiceTotal(invoiceId, tx)
        }
      }

      return {
        updated: updatableIds.length,
        skipped: seriesJobs.length - updatableIds.length,
        draftInvoicesUpdated: draftInvoiceIds.size,
      }
    }, { maxWait: 10000, timeout: 30000 })

    revalidateSchedulePages(job.location.clientId)
    if (result.draftInvoicesUpdated > 0) revalidateInvoicePages(job.location.clientId)

    return NextResponse.json({ ...result, previous })
  } catch (error) {
    logger.error('[apply-rate-forward] failed:', error)
    return handleApiError(error, 'Failed to apply changes to future cleans')
  }
}
