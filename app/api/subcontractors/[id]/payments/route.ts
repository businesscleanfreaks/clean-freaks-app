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
import { paymentLineDescription } from '@/lib/payment-line'
import { checkInvoiceGate, describeGaps, type PayableUnit } from '@/lib/cleaner-invoice-gate'
import {
  buildAddOnObligations,
  buildObligations,
  coveredAddOnIds,
  coveredJobIds,
  lineBelongsToObligation,
  obligationKeysForAddOns,
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
        description: true,
        subcontractorRate: true,
        createdAt: true,
        job: {
          select: {
            date: true,
            locationId: true,
            location: { select: { client: { select: { name: true } } } },
          },
        },
        schedule: {
          select: {
            locationId: true,
            location: { select: { client: { select: { name: true } } } },
          },
        },
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

    // Pay-gate (Josh's rule): don't pay a cleaner for work unless they've sent us
    // an invoice for it · either a MATCHED/RESOLVED CleanerInvoice for the month,
    // or a receipt recorded on the Cleaners page. Grace can still pay by passing
    // confirmNoInvoice after reviewing.
    //
    // The unit of the check is the WORK, not the month. Receipts are recorded
    // per account, and optionally per clean or add-on, but this only asked
    // whether any receipt existed for the cleaner in the month · so one
    // account's invoice released payment for every account that cleaner worked
    // that month. The rule lives in lib/cleaner-invoice-gate.ts.
    const payableUnits: PayableUnit[] = [
      ...jobs.map(job => ({
        kind: 'JOB' as const,
        id: job.id,
        locationId: job.locationId,
        locationName: job.location.client.name,
        period: format(new Date(job.date), 'yyyy-MM'),
      })),
      ...assignedAddOns.map(addOn => ({
        kind: 'ADDON' as const,
        id: addOn.id,
        locationId: addOn.job?.locationId ?? addOn.schedule?.locationId ?? '',
        locationName:
          addOn.job?.location?.client.name ?? addOn.schedule?.location?.client.name ?? 'an account',
        period: format(new Date(addOn.job?.date || addOn.createdAt), 'yyyy-MM'),
      })),
    ]
    const periodsBeingPaid = Array.from(new Set(payableUnits.map(u => u.period)))

    if (payableUnits.length > 0 && body.confirmNoInvoice !== true) {
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
          select: { locationId: true, period: true, jobId: true, addOnServiceId: true },
        }),
      ])

      const gate = checkInvoiceGate(
        payableUnits,
        receipts,
        new Set(matching.map(m => m.period)),
      )
      if (!gate.satisfied) {
        return NextResponse.json(
          {
            code: 'NO_MATCHING_CLEANER_INVOICE',
            error: `No cleaner invoice on file for ${describeGaps(gate.gaps)}. Record or resolve it first, or pay anyway.`,
            periods: gate.periods,
            gaps: gate.gaps,
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

    // Add-ons this cleaner performed on someone else's schedule settle on their
    // own. They used to be added straight to the payment total with no line and
    // no obligation, so nothing recorded them: the payment history could not
    // count them, undoing a clean on the same payment took their money with it,
    // and nothing ever unmarked one.
    const obligations = [
      ...buildObligations(payableJobs),
      ...buildAddOnObligations(assignedAddOns.map(addOn => ({
        id: addOn.id,
        description: addOn.description,
        subcontractorRate: addOn.subcontractorRate,
        date: addOn.job?.date ?? addOn.createdAt,
      }))),
    ]

    // Each line carries its own description and date. Deleting a clean used to
    // cascade the line away, leaving a payment with money and no record of what
    // it bought; the line now outlives the clean.
    const jobById = new Map(jobs.map(job => [job.id, job]))
    const addOnById = new Map(assignedAddOns.map(addOn => [addOn.id, addOn]))
    const paymentLineItems = obligationLines(obligations).map(line => {
      const job = line.jobId ? jobById.get(line.jobId) : undefined
      const addOn = line.addOnServiceId ? addOnById.get(line.addOnServiceId) : undefined
      const date = job?.date ?? addOn?.job?.date ?? addOn?.createdAt ?? null
      return {
        jobId: line.jobId,
        addOnServiceId: line.addOnServiceId,
        amount: line.amount,
        description: job
          ? paymentLineDescription({ name: job.location.client.name, date: job.date })
          : addOn
            ? paymentLineDescription({ name: addOn.description, date })
            : '',
        serviceDate: date,
        scheduleId: job?.scheduleId ?? null,
      }
    })

    const totalAmount = obligationsTotal(obligations)

    // Plain-English names for the 409 below, built while the jobs are in hand.
    const obligationLabels = new Map(
      obligations.map(obligation => {
        if (obligation.kind === 'ADDON') {
          const addOn = assignedAddOns.find(a => a.id === obligation.addOnServiceIds[0])
          return [obligation.key, addOn?.description ?? 'an add-on']
        }
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
              create: paymentLineItems,
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
        const addOnIdsToMark = coveredAddOnIds(obligations)
        if (addOnIdsToMark.length > 0) {
          await tx.addOnService.updateMany({
            where: { id: { in: addOnIdsToMark } },
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
    const body = await request.json().catch(() => ({}))
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

    const jobIds = strings(body?.jobIds)
    // Both spellings, for the same reason the POST accepts both: the Cleaners
    // page names this addOnServiceIds and the Payables page names it addOnIds.
    // Undo ignored add-ons entirely, so a performed add-on stayed marked paid
    // for good once it had been paid once.
    const requestedAddOnIds = Array.from(new Set([
      ...strings(body?.addOnIds),
      ...strings(body?.addOnServiceIds),
    ]))

    if (jobIds.length === 0 && requestedAddOnIds.length === 0) {
      return NextResponse.json(
        { error: 'jobIds or addOnIds must be a non-empty array' },
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
        schedule: { select: { subcontractorPayType: true } },
      },
    })

    const addOns = requestedAddOnIds.length > 0
      ? await prisma.addOnService.findMany({
          where: { id: { in: requestedAddOnIds }, subcontractorId: resolvedParams.id },
          select: { id: true },
        })
      : []

    if (jobs.length === 0 && addOns.length === 0) {
      return NextResponse.json(
        { error: 'No matching jobs or add-ons found for this subcontractor' },
        { status: 404 }
      )
    }

    const validJobIds = jobs.map(job => job.id)
    const validAddOnIds = addOns.map(addOn => addOn.id)

    // Undo reverses OBLIGATIONS, not the cleans the operator happened to tick.
    // A flat month is one obligation covering every clean in it, paid as one
    // amount, so unticking any one of them reverses the month. Reversing by
    // clicked job is what made undo asymmetric: unticking the first clean took
    // the money back while the other cleans stayed marked paid, and unticking
    // any other clean marked it unpaid while the payment still claimed to cover
    // it · a clean that was paid and unpaid at the same time.
    const obligationKeys = [
      ...obligationKeysForJobs(
        jobs.map(job => ({
          id: job.id,
          date: job.date,
          scheduleId: job.scheduleId,
          subcontractorRate: job.subcontractorRate,
          subcontractorPayType: job.schedule?.subcontractorPayType ?? null,
          addOnTotal: 0,
        }))
      ),
      ...obligationKeysForAddOns(validAddOnIds),
    ]

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
              addOnServiceId: true,
              paymentId: true,
              serviceDate: true,
              scheduleId: true,
              job: { select: { date: true, scheduleId: true } },
            },
          })
        : []

      const lineItemIdsToRemove = new Set<string>()
      const jobIdsToUnmark = new Set<string>()
      const addOnIdsToUnmark = new Set<string>()

      for (const row of coverage) {
        for (const item of items) {
          if (item.paymentId !== row.paymentId) continue
          // The line's own snapshot first, so this still matches after the
          // clean has been deleted. The job is the fallback for rows written
          // before the snapshot existed.
          const asCoverageLine = {
            jobId: item.jobId,
            addOnServiceId: item.addOnServiceId,
            serviceDate: item.serviceDate ?? item.job?.date ?? null,
            scheduleId: item.scheduleId ?? item.job?.scheduleId ?? null,
          }
          if (!lineBelongsToObligation(row, asCoverageLine)) continue
          lineItemIdsToRemove.add(item.id)
          if (item.jobId) jobIdsToUnmark.add(item.jobId)
          if (item.addOnServiceId) addOnIdsToUnmark.add(item.addOnServiceId)
        }
        // The work itself, even if its line item has since gone.
        if (row.kind === 'JOB') jobIdsToUnmark.add(row.obligationKey.slice('job:'.length))
        if (row.kind === 'ADDON') addOnIdsToUnmark.add(row.obligationKey.slice('addon:'.length))
      }

      // Payments written before obligations were recorded have no coverage rows.
      // Reverse those the old way, by line item, so their undo keeps working.
      const legacyJobIds = validJobIds.filter(id => !jobIdsToUnmark.has(id))
      const legacyAddOnIds = validAddOnIds.filter(id => !addOnIdsToUnmark.has(id))
      if (legacyJobIds.length > 0 || legacyAddOnIds.length > 0) {
        const legacyItems = await tx.subcontractorPaymentLineItem.findMany({
          where: {
            OR: [
              ...(legacyJobIds.length > 0 ? [{ jobId: { in: legacyJobIds } }] : []),
              ...(legacyAddOnIds.length > 0 ? [{ addOnServiceId: { in: legacyAddOnIds } }] : []),
            ],
          },
          select: { id: true, paymentId: true },
        })
        for (const item of legacyItems) {
          lineItemIdsToRemove.add(item.id)
          affectedPaymentIds.add(item.paymentId)
        }
        for (const id of legacyJobIds) jobIdsToUnmark.add(id)
        for (const id of legacyAddOnIds) addOnIdsToUnmark.add(id)
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

      const updatedJobs = jobIdsToUnmark.size > 0
        ? await tx.job.updateMany({
            where: { id: { in: Array.from(jobIdsToUnmark) } },
            data: { subcontractorPaid: false },
          })
        : { count: 0 }

      // Undo never touched these, so a performed add-on stayed marked paid even
      // after the payment that paid for it had been reversed.
      const updatedAddOns = addOnIdsToUnmark.size > 0
        ? await tx.addOnService.updateMany({
            where: { id: { in: Array.from(addOnIdsToUnmark) } },
            data: { subcontractorPaid: false },
          })
        : { count: 0 }

      return {
        unmarkedCount: updatedJobs.count + updatedAddOns.count,
        removedLineItemCount: lineItemIdsToRemove.size,
        affectedPaymentCount: affectedPaymentIds.size,
        reversedObligationKeys: coverage.map(row => row.obligationKey),
      }
    })

    revalidateSubcontractorPages(resolvedParams.id)

    return NextResponse.json({
      success: true,
      message: `Unchecked ${result.unmarkedCount} item(s).`,
      ...result,
    })
  } catch (error) {
    logger.error('Error unmarking payment jobs:', error)
    return handleApiError(error, 'Failed to unmark paid jobs')
  }
}
