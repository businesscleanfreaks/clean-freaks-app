import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateSubcontractorPages } from '@/lib/revalidate'
import { createPaymentSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { getBillingStartDate } from '@/lib/billing-settings'
import { format } from 'date-fns'
import { requireAuth } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error-handler'
import { isUniqueViolation } from '@/lib/invoice-number'
import {
  buildObligations,
  coveredJobIds,
  lineBelongsToObligation,
  obligationKeysForJobs,
  obligationLines,
  obligationsTotal,
  type PayableJob,
} from '@/lib/payment-obligations'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()

    const resolvedParams = await Promise.resolve(params)
    const body = await request.json()
    
    // Validate request body
    const validationResult = createPaymentSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }
    
    const { jobIds, addOnIds, datePaid, notes } = validationResult.data

    // An add-on belongs to THIS cleaner's pay only when nobody else performs it:
    // not an outside vendor, and not a different in-house cleaner. (Jobs queried
    // below all have subcontractorId === this cleaner, so === resolvedParams.id is
    // equivalent to === job.subcontractorId.)
    const creditsThisCleaner = (addOn: { vendorId: string | null; subcontractorId: string | null }) =>
      !addOn.vendorId && (!addOn.subcontractorId || addOn.subcontractorId === resolvedParams.id)

    // Get billing start date to prevent paying pre-cutoff jobs
    const billingStartDate = await getBillingStartDate()

    // Get the jobs with location, client info, and add-ons to calculate total correctly
    const jobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
        subcontractorId: resolvedParams.id,
        subcontractorPaid: false, // Only allow paying unpaid jobs
        ...(billingStartDate ? { date: { gte: billingStartDate } } : {}),
      },
      include: {
        location: {
          include: {
            client: true,
          },
        },
        addOnServices: true,
        schedule: true,
      },
    })

    // Add-ons this cleaner performed on someone else's schedule/job (Payout-B):
    // paid via a flag, no job line item. Only this cleaner's unpaid ones count.
    const assignedAddOns = await prisma.addOnService.findMany({
      where: {
        id: { in: addOnIds },
        subcontractorId: resolvedParams.id,
        subcontractorPaid: false,
      },
      select: {
        id: true,
        subcontractorRate: true,
        createdAt: true,
        job: { select: { date: true } },
      },
    })

    if (jobs.length === 0 && assignedAddOns.length === 0) {
      return NextResponse.json(
        { error: 'No valid unpaid jobs or add-ons found for this subcontractor' },
        { status: 400 }
      )
    }

    // Idempotency guard: if some requested jobs are already paid, return 409
    if (jobs.length < jobIds.length) {
      const foundIds = new Set(jobs.map(j => j.id))
      const alreadyPaid = jobIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `${alreadyPaid.length} job(s) already paid or not found`, alreadyPaidJobIds: alreadyPaid },
        { status: 409 }
      )
    }
    if (assignedAddOns.length < addOnIds.length) {
      const foundIds = new Set(assignedAddOns.map(a => a.id))
      const alreadyPaid = addOnIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `${alreadyPaid.length} add-on(s) already paid or not found`, alreadyPaidAddOnIds: alreadyPaid },
        { status: 409 }
      )
    }

    // Pay-gate (Josh's rule): don't pay a cleaner for a month unless they've sent
    // us an invoice that matches what we owe (MATCHED) or a human has RESOLVED a
    // mismatch. Grace can still pay by passing confirmNoInvoice after reviewing.
    const periodsBeingPaid = Array.from(new Set([
      ...jobs.map(j => format(new Date(j.date), 'yyyy-MM')),
      ...assignedAddOns.map(a => format(new Date(a.job?.date || a.createdAt), 'yyyy-MM')),
    ]))
    if (periodsBeingPaid.length > 0 && body.confirmNoInvoice !== true) {
      // Two shapes of evidence count, because cleaners invoice per ACCOUNT
      // (Josh 2026-08-26) and the Cleaners page records those receipts, while
      // the older intake recorded one invoice per cleaner per month. Either
      // proves they billed us, so either releases the payment.
      const [matching, receipts] = await Promise.all([
        prisma.cleanerInvoice.findMany({
          where: {
            subcontractorId: resolvedParams.id,
            period: { in: periodsBeingPaid },
            status: { in: ['MATCHED', 'RESOLVED'] },
          },
          select: { period: true },
        }),
        prisma.cleanerInvoiceReceipt.findMany({
          where: { subcontractorId: resolvedParams.id, period: { in: periodsBeingPaid } },
          select: { period: true },
        }),
      ])
      const covered = new Set([
        ...matching.map(m => m.period),
        ...receipts.map(r => r.period),
      ])
      const uncovered = periodsBeingPaid.filter(p => !covered.has(p))
      if (uncovered.length > 0) {
        return NextResponse.json(
          {
            code: 'NO_MATCHING_CLEANER_INVOICE',
            error: `No matching cleaner invoice on file for ${uncovered.join(', ')}. Record or resolve it first, or pay anyway.`,
            periods: uncovered,
          },
          { status: 409 }
        )
      }
    }

    // What this payment settles. A flat-rate schedule owes one amount for one
    // month however many cleans happened; per-clean and one-off work owes per
    // visit. The grouping and the money live in lib/payment-obligations.ts ·
    // this route only shapes Prisma rows for it and writes the answer down.
    const payableJobs: PayableJob[] = jobs.map(job => ({
      id: job.id,
      date: job.date,
      scheduleId: job.scheduleId,
      subcontractorRate: job.subcontractorRate,
      clientId: job.location.client.id,
      subcontractorPayType: job.schedule?.subcontractorPayType ?? null,
      addOnTotal: job.addOnServices
        .filter(creditsThisCleaner)
        .reduce((sum, addOn) => sum + addOn.subcontractorRate, 0),
    }))

    const obligations = buildObligations(payableJobs)

    // Add-ons this cleaner performed on someone else's schedule/job: paid via the
    // subcontractorPaid flag (no job line item), folded into the payment total.
    const assignedAddOnTotal = assignedAddOns.reduce((sum, a) => sum + a.subcontractorRate, 0)
    const totalAmount = Math.round((obligationsTotal(obligations) + assignedAddOnTotal) * 100) / 100

    // Plain-English names for the 409 below, built while the jobs are in hand.
    const obligationLabels = new Map(
      obligations.map(obligation => {
        const job = jobs.find(j => j.id === obligation.jobIds[0])
        const client = job?.location.client.name ?? 'this account'
        const when = job
          ? format(new Date(job.date), obligation.kind === 'SCHEDULE_MONTH' ? 'MMMM yyyy' : 'MMM d, yyyy')
          : obligation.period
        return [obligation.key, `${client} · ${when}`]
      })
    )

    try {
      // Use transaction to ensure payment and job updates happen atomically
      const payment = await prisma.$transaction(async (tx) => {
        // Create the payment record with line items · one per covered clean, so
        // the payment lists the work it paid for. A flat month used to write a
        // single line item on the first job, which is why the payment history
        // reported "1 job" for a fifteen-visit month and why undoing through
        // any other clean found nothing to undo.
        const newPayment = await tx.subcontractorPayment.create({
          data: {
            subcontractorId: resolvedParams.id,
            datePaid: datePaid ? new Date(datePaid + 'T12:00:00') : new Date(),
            totalAmount,
            notes: notes || null,
            lineItems: {
              create: obligationLines(obligations),
            },
          },
          include: {
            lineItems: {
              include: {
                job: {
                  include: {
                    location: {
                      include: {
                        client: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })

        // Claim each obligation. obligationKey is UNIQUE in the database, so a
        // second payment for the same schedule-month or the same clean fails
        // here rather than being written · including when two requests arrive
        // at once, which the "unpaid jobs only" read above cannot catch by
        // itself because both requests read the jobs before either writes.
        if (obligations.length > 0) {
          await tx.subcontractorPaymentCoverage.createMany({
            data: obligations.map(obligation => ({
              paymentId: newPayment.id,
              obligationKey: obligation.key,
              kind: obligation.kind,
              amount: obligation.amount,
              period: obligation.period,
              scheduleId: obligation.scheduleId,
            })),
          })
        }

        // Mark every covered job paid · all the cleans of a flat month, not
        // only the one carrying the rate.
        const jobIdsToMark = coveredJobIds(obligations)
        if (jobIdsToMark.length > 0) {
          await tx.job.updateMany({
            where: {
              id: { in: jobIdsToMark },
            },
            data: {
              subcontractorPaid: true,
            },
          })
        }

        // Mark this cleaner's performed add-ons paid
        if (assignedAddOns.length > 0) {
          await tx.addOnService.updateMany({
            where: { id: { in: assignedAddOns.map(a => a.id) } },
            data: { subcontractorPaid: true },
          })
        }

        return newPayment
      })

      // Revalidate all subcontractor-related pages
      revalidateSubcontractorPages(resolvedParams.id)

      return NextResponse.json(payment, { status: 201 })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error

      // Something in this selection is already settled. Name it, because the
      // operator's next move is to undo that payment, not to try again.
      const claimed = await prisma.subcontractorPaymentCoverage.findMany({
        where: { obligationKey: { in: obligations.map(o => o.key) } },
        select: { obligationKey: true },
      })
      const already = claimed.map(c => obligationLabels.get(c.obligationKey) ?? c.obligationKey)
      return NextResponse.json(
        {
          code: 'OBLIGATION_ALREADY_PAID',
          error: already.length > 0
            ? `Already paid: ${already.join(', ')}. Undo that payment first if it needs to change.`
            : 'Part of this selection has already been paid. Refresh and try again.',
          obligationKeys: claimed.map(c => c.obligationKey),
        },
        { status: 409 }
      )
    }
  } catch (error) {
    logger.error('Error creating payment:', error)
    return handleApiError(error, 'Failed to create payment')
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    await requireAuth()

    const resolvedParams = await Promise.resolve(params)
    const { jobIds } = await request.json().catch(() => ({ jobIds: [] }))

    if (!Array.isArray(jobIds) || jobIds.length === 0 || !jobIds.every(id => typeof id === 'string')) {
      return NextResponse.json(
        { error: 'jobIds must be a non-empty array' },
        { status: 400 }
      )
    }

    const jobs = await prisma.job.findMany({
      where: {
        id: { in: jobIds },
        subcontractorId: resolvedParams.id,
      },
      select: {
        id: true,
        date: true,
        scheduleId: true,
        subcontractorRate: true,
        location: { select: { clientId: true } },
        schedule: { select: { subcontractorPayType: true } },
      },
    })

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: 'No matching jobs found for this subcontractor' },
        { status: 404 }
      )
    }

    const validJobIds = jobs.map(job => job.id)

    // Undo reverses OBLIGATIONS, not the cleans the operator happened to tick.
    // A flat month is one obligation covering every clean in it, paid as one
    // amount, so unticking any one of them reverses the month. Reversing by
    // clicked job is what made undo asymmetric: unticking the first clean took
    // the money back while the other cleans stayed marked paid, and unticking
    // any other clean marked it unpaid while the payment still claimed to cover
    // it · a clean that was paid and unpaid at the same time.
    const obligationKeys = obligationKeysForJobs(
      jobs.map(job => ({
        id: job.id,
        date: job.date,
        scheduleId: job.scheduleId,
        subcontractorRate: job.subcontractorRate,
        clientId: job.location.clientId,
        subcontractorPayType: job.schedule?.subcontractorPayType ?? null,
        addOnTotal: 0,
      }))
    )

    const result = await prisma.$transaction(async (tx) => {
      const coverage = await tx.subcontractorPaymentCoverage.findMany({
        where: {
          obligationKey: { in: obligationKeys },
          payment: { subcontractorId: resolvedParams.id },
        },
        select: {
          id: true,
          obligationKey: true,
          kind: true,
          period: true,
          scheduleId: true,
          paymentId: true,
        },
      })

      const affectedPaymentIds = new Set(coverage.map(row => row.paymentId))

      // Every line item of the affected payments, with enough of the job to say
      // which obligation each one belongs to.
      const items = affectedPaymentIds.size > 0
        ? await tx.subcontractorPaymentLineItem.findMany({
            where: { paymentId: { in: Array.from(affectedPaymentIds) } },
            select: {
              id: true,
              jobId: true,
              paymentId: true,
              job: { select: { date: true, scheduleId: true } },
            },
          })
        : []

      const lineItemIdsToRemove = new Set<string>()
      const jobIdsToUnmark = new Set<string>()

      for (const row of coverage) {
        for (const item of items) {
          if (item.paymentId !== row.paymentId) continue
          if (!lineBelongsToObligation(row, item)) continue
          lineItemIdsToRemove.add(item.id)
          jobIdsToUnmark.add(item.jobId)
        }
        // The clean itself, even if its line item has since gone.
        if (row.kind === 'JOB') jobIdsToUnmark.add(row.obligationKey.slice('job:'.length))
      }

      // Payments written before obligations were recorded have no coverage rows.
      // Reverse those the old way, by line item, so their undo keeps working.
      const legacyJobIds = validJobIds.filter(id => !jobIdsToUnmark.has(id))
      if (legacyJobIds.length > 0) {
        const legacyItems = await tx.subcontractorPaymentLineItem.findMany({
          where: { jobId: { in: legacyJobIds } },
          select: { id: true, paymentId: true },
        })
        for (const item of legacyItems) {
          lineItemIdsToRemove.add(item.id)
          affectedPaymentIds.add(item.paymentId)
        }
        for (const id of legacyJobIds) jobIdsToUnmark.add(id)
      }

      if (coverage.length > 0) {
        // Releasing the obligation is what lets the month be paid again.
        await tx.subcontractorPaymentCoverage.deleteMany({
          where: { id: { in: coverage.map(row => row.id) } },
        })
      }

      if (lineItemIdsToRemove.size > 0) {
        await tx.subcontractorPaymentLineItem.deleteMany({
          where: { id: { in: Array.from(lineItemIdsToRemove) } },
        })
      }

      for (const paymentId of affectedPaymentIds) {
        const remaining = await tx.subcontractorPaymentLineItem.findMany({
          where: { paymentId },
          select: { amount: true },
        })

        if (remaining.length === 0) {
          // Deleting the payment cascades any coverage it still held, so every
          // obligation it settled is released together with the money.
          await tx.subcontractorPayment.delete({ where: { id: paymentId } })
        } else {
          const totalAmount = remaining.reduce((sum, item) => sum + item.amount, 0)
          await tx.subcontractorPayment.update({
            where: { id: paymentId },
            data: { totalAmount },
          })
        }
      }

      const updatedJobs = await tx.job.updateMany({
        where: { id: { in: Array.from(jobIdsToUnmark) } },
        data: { subcontractorPaid: false },
      })

      return {
        unmarkedCount: updatedJobs.count,
        removedLineItemCount: lineItemIdsToRemove.size,
        affectedPaymentCount: affectedPaymentIds.size,
        reversedObligationKeys: coverage.map(row => row.obligationKey),
      }
    })

    revalidateSubcontractorPages(resolvedParams.id)

    return NextResponse.json({
      success: true,
      message: `Unchecked ${result.unmarkedCount} job(s).`,
      ...result,
    })
  } catch (error) {
    logger.error('Error unmarking payment jobs:', error)
    return handleApiError(error, 'Failed to unmark paid jobs')
  }
}
