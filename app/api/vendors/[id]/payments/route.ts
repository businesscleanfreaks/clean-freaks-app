import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"
import { format } from "date-fns"
import { logger } from "@/lib/logger"
import { handleApiError } from "@/lib/api-error-handler"
import { paymentLineDescription } from '@/lib/payment-line'
import { checkInvoiceGate, describeGaps, type PayableUnit } from '@/lib/cleaner-invoice-gate'

export const dynamic = 'force-dynamic'

const createPaymentSchema = z.object({
  addOnServiceIds: z.array(z.string()).optional().default([]),
  jobIds: z.array(z.string()).optional().default([]),
  datePaid: z.string().optional(),
  notes: z.string().optional().nullable(),
  confirmNoInvoice: z.boolean().optional().default(false),
}).refine((value) => value.addOnServiceIds.length + value.jobIds.length > 0, {
  message: 'At least one add-on service or job is required',
  path: ['addOnServiceIds'],
})

const updatePaymentStateSchema = z.object({
  addOnServiceIds: z.array(z.string()).optional().default([]),
  jobIds: z.array(z.string()).optional().default([]),
  vendorPaid: z.boolean(),
  confirmNoInvoice: z.boolean().optional().default(false),
}).refine((value) => value.addOnServiceIds.length + value.jobIds.length > 0, {
  message: 'At least one add-on service or job is required',
  path: ['addOnServiceIds'],
})

/** A vendor's work as the pay-gate needs to see it. */
type VendorWork = {
  createdAt: Date
  job?: { date: Date; locationId: string; location: { client: { name: string } } } | null
  schedule?: { locationId: string; location: { client: { name: string } } } | null
}

/**
 * The work a vendor payment covers, one unit each.
 *
 * A one-off clean is its own unit and belongs to its own account; an add-on
 * belongs to the account of the clean or schedule it sits on.
 */
function vendorPayableUnits(
  addOns: ReadonlyArray<VendorWork & { id: string }>,
  jobs: ReadonlyArray<{ id: string; date: Date; locationId: string; location: { client: { name: string } } }>,
): PayableUnit[] {
  return [
    ...jobs.map((job) => ({
      kind: 'JOB' as const,
      id: job.id,
      locationId: job.locationId,
      locationName: job.location.client.name,
      period: format(new Date(job.date), 'yyyy-MM'),
    })),
    ...addOns.map((addOn) => ({
      kind: 'ADDON' as const,
      id: addOn.id,
      locationId: addOn.job?.locationId ?? addOn.schedule?.locationId ?? '',
      locationName:
        addOn.job?.location.client.name ?? addOn.schedule?.location.client.name ?? 'an account',
      period: format(new Date(addOn.job?.date || addOn.createdAt), 'yyyy-MM'),
    })),
  ]
}

/**
 * Don't pay a vendor for work they haven't billed us for.
 *
 * Two shapes of evidence count, and this only ever read the first:
 *
 *  - a MATCHED or RESOLVED VendorInvoice, which is one invoice per vendor per
 *    month and so covers that whole month;
 *  - a receipt recorded on the Cleaners page, which is per ACCOUNT and
 *    optionally per clean or add-on. The receipt endpoint takes `?payee=vendor`
 *    and the page both records and displays these · but this gate ignored them,
 *    so ticking a vendor's invoice changed nothing and the payment was still
 *    refused with "no matching vendor invoice on file".
 *
 * Scoped to the work, not the month, for the same reason the cleaner gate is:
 * one account's invoice must not release payment for another account.
 */
async function requireMatchingVendorInvoice(
  vendorId: string,
  units: PayableUnit[],
  confirmNoInvoice: boolean,
) {
  if (units.length === 0 || confirmNoInvoice) return null
  const periods = Array.from(new Set(units.map((u) => u.period))).filter(Boolean)
  if (periods.length === 0) return null

  const [matching, receipts] = await Promise.all([
    prisma.vendorInvoice.findMany({
      where: {
        vendorId,
        period: { in: periods },
        status: { in: ['MATCHED', 'RESOLVED'] },
      },
      select: { period: true },
    }),
    prisma.cleanerInvoiceReceipt.findMany({
      where: { vendorId, period: { in: periods } },
      select: { locationId: true, period: true, jobId: true, addOnServiceId: true },
    }),
  ])

  const gate = checkInvoiceGate(units, receipts, new Set(matching.map((m) => m.period)))
  if (gate.satisfied) return null

  return NextResponse.json(
    {
      code: 'NO_MATCHING_VENDOR_INVOICE',
      error: `No vendor invoice on file for ${describeGaps(gate.gaps)}. Record or resolve it first, or pay anyway.`,
      periods: gate.periods,
      gaps: gate.gaps,
    },
    { status: 409 },
  )
}

// POST — record vendor payment
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id: vendorId } = await params
    const body = await request.json()

    const result = createPaymentSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const { addOnServiceIds, jobIds, datePaid, notes, confirmNoInvoice } = result.data

    // Get unpaid add-on services for this vendor
    const [addOns, jobs] = await Promise.all([
      prisma.addOnService.findMany({
        where: {
          id: { in: addOnServiceIds },
          vendorId,
          vendorPaid: false,
        },
        include: {
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
      }),
      prisma.job.findMany({
        where: {
          id: { in: jobIds },
          vendorId,
          vendorPaid: false,
          scheduleId: null,
        },
          include: { location: { select: { client: { select: { name: true } } } } },
      }),
    ])

    if (addOns.length === 0 && jobs.length === 0) {
      return NextResponse.json(
        { error: 'No valid unpaid add-on services or jobs found for this vendor' },
        { status: 400 }
      )
    }

    if (addOns.length < addOnServiceIds.length) {
      const foundIds = new Set(addOns.map(addon => addon.id))
      const missing = addOnServiceIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `${missing.length} add-on(s) already paid or not found`, alreadyPaidAddOnIds: missing },
        { status: 409 }
      )
    }

    if (jobs.length < jobIds.length) {
      const foundIds = new Set(jobs.map(job => job.id))
      const missing = jobIds.filter(id => !foundIds.has(id))
      return NextResponse.json(
        { error: `${missing.length} job(s) already paid or not found`, alreadyPaidJobIds: missing },
        { status: 409 }
      )
    }

    const gate = await requireMatchingVendorInvoice(
      vendorId,
      vendorPayableUnits(addOns, jobs),
      confirmNoInvoice,
    )
    if (gate) return gate

    const totalAmount =
      addOns.reduce((sum, a) => sum + a.subcontractorRate, 0) +
      jobs.reduce((sum, job) => sum + job.subcontractorRate, 0)

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.vendorPayment.create({
        data: {
          vendorId,
          datePaid: datePaid ? new Date(datePaid + 'T12:00:00') : new Date(),
          totalAmount,
          notes: notes || null,
          lineItems: {
            create: [
              // Each line describes itself, so deleting the clean or the add-on
              // no longer takes the record of the payment with it.
              ...addOns.map(a => ({
                addOnServiceId: a.id,
                amount: a.subcontractorRate,
                description: paymentLineDescription({
                  name: a.description,
                  date: a.job?.date ?? a.createdAt,
                }),
                serviceDate: a.job?.date ?? a.createdAt,
              })),
              ...jobs.map(job => ({
                jobId: job.id,
                amount: job.subcontractorRate,
                description: paymentLineDescription({
                  name: job.location.client.name,
                  date: job.date,
                }),
                serviceDate: job.date,
              })),
            ],
          },
        },
        include: {
          lineItems: {
            include: {
              addOnService: true,
            },
          },
        },
      })

      // Mark add-on services as vendor-paid
      if (addOns.length > 0) {
        await tx.addOnService.updateMany({
          where: { id: { in: addOns.map(addon => addon.id) }, vendorId },
          data: { vendorPaid: true },
        })
      }

      if (jobs.length > 0) {
        await tx.job.updateMany({
          where: { id: { in: jobs.map(job => job.id) }, vendorId },
          data: { vendorPaid: true },
        })
      }

      return newPayment
    })

    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    console.error('Vendor payment error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record payment' },
      { status: 500 }
    )
  }
}

// PATCH — mark/unmark vendor add-ons as paid
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id: vendorId } = await params
    const body = await request.json()

    const result = updatePaymentStateSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const { addOnServiceIds, jobIds, vendorPaid, confirmNoInvoice } = result.data

    if (vendorPaid) {
      const [addOns, jobs] = await Promise.all([
        prisma.addOnService.findMany({
          where: {
            id: { in: addOnServiceIds },
            vendorId,
            vendorPaid: false,
          },
          include: {
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
        }),
        prisma.job.findMany({
          where: {
            id: { in: jobIds },
            vendorId,
            vendorPaid: false,
            scheduleId: null,
          },
              include: { location: { select: { client: { select: { name: true } } } } },
        }),
      ])

      if (addOns.length === 0 && jobs.length === 0) {
        return NextResponse.json(
          { error: 'No valid unpaid add-on services or jobs found for this vendor' },
          { status: 400 }
        )
      }

      const gate = await requireMatchingVendorInvoice(
        vendorId,
        vendorPayableUnits(addOns, jobs),
        confirmNoInvoice,
      )
      if (gate) return gate

      const totalAmount =
        addOns.reduce((sum, addon) => sum + addon.subcontractorRate, 0) +
        jobs.reduce((sum, job) => sum + job.subcontractorRate, 0)

      await prisma.$transaction(async (tx) => {
        await tx.vendorPayment.create({
          data: {
            vendorId,
            datePaid: new Date(),
            totalAmount,
            notes: null,
            lineItems: {
              create: [
                // Each line describes itself, so deleting the clean or the add-on
                // no longer takes the record of the payment with it.
                ...addOns.map(addon => ({
                  addOnServiceId: addon.id,
                  amount: addon.subcontractorRate,
                  description: paymentLineDescription({
                    name: addon.description,
                    date: addon.job?.date ?? addon.createdAt,
                  }),
                  serviceDate: addon.job?.date ?? addon.createdAt,
                })),
                ...jobs.map(job => ({
                  jobId: job.id,
                  amount: job.subcontractorRate,
                  description: paymentLineDescription({
                    name: job.location.client.name,
                    date: job.date,
                  }),
                  serviceDate: job.date,
                })),
              ],
            },
          },
        })

        if (addOns.length > 0) {
          await tx.addOnService.updateMany({
            where: { id: { in: addOns.map(addon => addon.id) }, vendorId },
            data: { vendorPaid: true },
          })
        }

        if (jobs.length > 0) {
          await tx.job.updateMany({
            where: { id: { in: jobs.map(job => job.id) }, vendorId },
            data: { vendorPaid: true },
          })
        }
      })

      return NextResponse.json({ success: true })
    }

    await prisma.$transaction(async (tx) => {
      const lineItems = await tx.vendorPaymentLineItem.findMany({
        where: {
          OR: [
            { addOnServiceId: { in: addOnServiceIds }, addOnService: { vendorId } },
            { jobId: { in: jobIds }, job: { vendorId } },
          ],
        },
        include: {
          payment: {
            include: {
              lineItems: true,
            },
          },
        },
      })

      for (const lineItem of lineItems) {
        if (lineItem.payment.lineItems.length <= 1) {
          await tx.vendorPayment.delete({
            where: { id: lineItem.payment.id },
          })
        } else {
          await tx.vendorPaymentLineItem.delete({
            where: { id: lineItem.id },
          })
          await tx.vendorPayment.update({
            where: { id: lineItem.payment.id },
            data: {
              totalAmount: Math.max(0, lineItem.payment.totalAmount - lineItem.amount),
            },
          })
        }
      }

      await tx.addOnService.updateMany({
        where: { id: { in: addOnServiceIds }, vendorId },
        data: { vendorPaid: false },
      })

      await tx.job.updateMany({
        where: { id: { in: jobIds }, vendorId },
        data: { vendorPaid: false },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Vendor payment update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update vendor payment state' },
      { status: 500 }
    )
  }
}

/**
 * Undo a vendor payment — the mirror of the subcontractor one, so the batch-pay
 * Undo works for every payee on the Cleaners page rather than silently doing
 * nothing for vendors.
 *
 * Removes the line items for these jobs, re-totals or deletes the payments they
 * belonged to, and puts the work back to unpaid.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id: vendorId } = await params
    const body = await request.json().catch(() => ({}))
    const jobIds: string[] = Array.isArray(body?.jobIds) ? body.jobIds.filter((x: unknown) => typeof x === 'string') : []
    const addOnServiceIds: string[] = Array.isArray(body?.addOnServiceIds)
      ? body.addOnServiceIds.filter((x: unknown) => typeof x === 'string')
      : []

    if (jobIds.length === 0 && addOnServiceIds.length === 0) {
      return NextResponse.json(
        { error: 'Pass at least one job or add-on to undo' },
        { status: 400 },
      )
    }

    const [jobs, addOns] = await Promise.all([
      jobIds.length
        ? prisma.job.findMany({ where: { id: { in: jobIds }, vendorId }, select: { id: true } })
        : Promise.resolve([]),
      addOnServiceIds.length
        ? prisma.addOnService.findMany({
            where: { id: { in: addOnServiceIds }, vendorId },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])
    if (jobs.length === 0 && addOns.length === 0) {
      return NextResponse.json({ error: 'No matching work for this vendor' }, { status: 404 })
    }
    const validJobIds = jobs.map(j => j.id)
    const validAddOnIds = addOns.map(a => a.id)

    const result = await prisma.$transaction(async (tx) => {
      const lineItems = await tx.vendorPaymentLineItem.findMany({
        where: {
          OR: [
            ...(validJobIds.length ? [{ jobId: { in: validJobIds } }] : []),
            ...(validAddOnIds.length ? [{ addOnServiceId: { in: validAddOnIds } }] : []),
          ],
        },
        select: { id: true, paymentId: true },
      })
      const affected = Array.from(new Set(lineItems.map(i => i.paymentId)))

      if (lineItems.length > 0) {
        await tx.vendorPaymentLineItem.deleteMany({
          where: { id: { in: lineItems.map(i => i.id) } },
        })
      }

      for (const paymentId of affected) {
        const remaining = await tx.vendorPaymentLineItem.findMany({
          where: { paymentId },
          select: { amount: true },
        })
        if (remaining.length === 0) {
          await tx.vendorPayment.delete({ where: { id: paymentId } })
        } else {
          await tx.vendorPayment.update({
            where: { id: paymentId },
            data: { totalAmount: remaining.reduce((s, i) => s + i.amount, 0) },
          })
        }
      }

      const [updatedJobs, updatedAddOns] = await Promise.all([
        validJobIds.length
          ? tx.job.updateMany({ where: { id: { in: validJobIds } }, data: { vendorPaid: false } })
          : Promise.resolve({ count: 0 }),
        validAddOnIds.length
          ? tx.addOnService.updateMany({
              where: { id: { in: validAddOnIds } },
              data: { vendorPaid: false },
            })
          : Promise.resolve({ count: 0 }),
      ])
      return {
        unmarkedCount: updatedJobs.count + updatedAddOns.count,
        removedLineItemCount: lineItems.length,
      }
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('Error reverting vendor payment:', error)
    return handleApiError(error, 'Failed to undo the vendor payment')
  }
}
