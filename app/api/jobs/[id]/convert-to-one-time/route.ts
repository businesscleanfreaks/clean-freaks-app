import { NextResponse } from 'next/server'
import { z } from 'zod'
import { subDays, startOfDay } from 'date-fns'
import { prisma } from '@/lib/db'
import { revalidateJobPages } from '@/lib/revalidate'
import { hasFinalInvoice } from '@/lib/invoice-status'
import { logger } from '@/lib/logger'

/**
 * POST /api/jobs/[id]/convert-to-one-time
 *
 * Converts a recurring job into a standalone one-time job and ends the parent recurring schedule.
 * Per the v5 job-detail design ("Convert & Remove Future Cleans"):
 *  1. Update this specific job with new client rate, cleaner pay, and optionally a new cleaner.
 *  2. Detach this job from its schedule (set scheduleId = null) so it survives as a standalone job.
 *  3. End the parent schedule by setting its endDate to (this job's date - 1 day) and isActive = false.
 *  4. Delete any uninvoiced future SCHEDULED jobs that belonged to the old schedule.
 *
 * Safety: refuses to convert if this job is on a SENT or PAID invoice, or if the cleaner has
 * already been paid for it. Future jobs that are invoiced or have payment records are preserved.
 */
const bodySchema = z.object({
  clientRate: z.number().nonnegative('Client rate must be non-negative'),
  subcontractorRate: z.number().nonnegative('Cleaner pay must be non-negative'),
  subcontractorId: z.string().nullable().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      )
    }
    const { clientRate, subcontractorRate, subcontractorId } = parsed.data

    const result = await prisma.$transaction(async (tx) => {
      // Re-read the job inside the transaction so the safety checks see consistent state.
      const job = await tx.job.findUnique({
        where: { id: resolvedParams.id },
        include: {
          invoiceLineItems: {
            include: { invoice: { select: { id: true, status: true } } },
          },
          schedule: { select: { id: true, endDate: true, isActive: true } },
        },
      })

      if (!job) {
        throw new Error('Job not found')
      }
      if (!job.scheduleId || !job.schedule) {
        throw new Error('This job is not on a recurring schedule — nothing to convert.')
      }
      if (hasFinalInvoice(job.invoiceLineItems)) {
        throw new Error('This job is on a sent or paid invoice. Void or reset that invoice before converting.')
      }
      if (job.subcontractorPaid) {
        throw new Error('The cleaner has already been paid for this clean. Unmark the payment before converting.')
      }

      const jobDate = startOfDay(job.date)
      const dayBefore = subDays(jobDate, 1)
      const scheduleId = job.scheduleId

      // 1. Update this job: new rates, optional cleaner, detach from schedule
      const updatedJob = await tx.job.update({
        where: { id: job.id },
        data: {
          clientRate,
          subcontractorRate,
          // Only change cleaner if subcontractorId was supplied; undefined leaves it as-is.
          ...(subcontractorId !== undefined ? { subcontractorId } : {}),
          scheduleId: null,
        },
      })

      // 2. Cancel future uninvoiced SCHEDULED jobs on this schedule that are not yet paid.
      //    We delete cleanly when possible; otherwise leave them alone (rare case where the
      //    job has a payment record but no invoice yet).
      const futureJobs = await tx.job.findMany({
        where: {
          scheduleId,
          date: { gt: job.date },
          status: 'SCHEDULED',
          invoiced: false,
          subcontractorPaid: false,
        },
        include: {
          invoiceLineItems: { select: { id: true, invoiceId: true, invoice: { select: { status: true } } } },
          paymentLineItems: { select: { id: true } },
          addOnServices: { include: { vendorPaymentLineItems: { select: { id: true } } } },
        },
      })

      let futureJobsRemoved = 0
      const draftInvoiceIds = new Set<string>()
      for (const fj of futureJobs) {
        const onFinal = fj.invoiceLineItems.some(li => li.invoice?.status === 'SENT' || li.invoice?.status === 'PAID')
        const hasPayments = fj.paymentLineItems.length > 0
        const hasVendorPayments = fj.addOnServices.some(a => a.vendorPaymentLineItems.length > 0)
        if (onFinal || hasPayments || hasVendorPayments) continue

        // Collect any draft invoices this job was on, so we can clean them up after.
        for (const li of fj.invoiceLineItems) {
          if (li.invoice?.status === 'DRAFT') draftInvoiceIds.add(li.invoiceId)
        }

        // Remove draft line items + addon services + the job itself
        await tx.invoiceLineItem.deleteMany({ where: { jobId: fj.id } })
        await tx.addOnService.deleteMany({ where: { jobId: fj.id } })
        await tx.job.delete({ where: { id: fj.id } })
        futureJobsRemoved++
      }

      // Clean up draft invoices that have no remaining line items.
      for (const invoiceId of draftInvoiceIds) {
        const remaining = await tx.invoiceLineItem.count({ where: { invoiceId } })
        if (remaining === 0) {
          await tx.invoice.delete({ where: { id: invoiceId } })
        }
      }

      // 3. End the schedule the day before this job's date and deactivate it.
      await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          endDate: dayBefore,
          isActive: false,
        },
      })

      return {
        job: updatedJob,
        futureJobsRemoved,
        scheduleEndedOn: dayBefore.toISOString(),
      }
    })

    revalidateJobPages()
    logger.info(`[convert-to-one-time] Converted job ${resolvedParams.id}, removed ${result.futureJobsRemoved} future jobs`)

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to convert job'
    logger.error('[convert-to-one-time] error', { error: message })
    const isUserError = message.includes('invoice') || message.includes('paid') || message.includes('not on a recurring') || message.includes('not found')
    return NextResponse.json({ error: message }, { status: isUserError ? 400 : 500 })
  }
}
