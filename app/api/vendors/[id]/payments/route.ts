import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"
import { format } from "date-fns"
import { logger } from "@/lib/logger"
import { handleApiError } from "@/lib/api-error-handler"

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

async function requireMatchingVendorInvoice(
  vendorId: string,
  periodsBeingPaid: string[],
  confirmNoInvoice: boolean,
) {
  const periods = Array.from(new Set(periodsBeingPaid)).filter(Boolean)
  if (periods.length === 0 || confirmNoInvoice) return null

  const matching = await prisma.vendorInvoice.findMany({
    where: {
      vendorId,
      period: { in: periods },
      status: { in: ['MATCHED', 'RESOLVED'] },
    },
    select: { period: true },
  })
  const covered = new Set(matching.map((m) => m.period))
  const uncovered = periods.filter((period) => !covered.has(period))
  if (uncovered.length === 0) return null

  return NextResponse.json(
    {
      code: 'NO_MATCHING_VENDOR_INVOICE',
      error: `No matching vendor invoice on file for ${uncovered.join(', ')}. Record or resolve it first, or pay anyway.`,
      periods: uncovered,
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
        include: { job: { select: { date: true } } },
      }),
      prisma.job.findMany({
        where: {
          id: { in: jobIds },
          vendorId,
          vendorPaid: false,
          scheduleId: null,
        },
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
      [
        ...addOns.map((addOn) => format(new Date(addOn.job?.date || addOn.createdAt), 'yyyy-MM')),
        ...jobs.map((job) => format(new Date(job.date), 'yyyy-MM')),
      ],
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
              ...addOns.map(a => ({
                addOnServiceId: a.id,
                amount: a.subcontractorRate,
              })),
              ...jobs.map(job => ({
                jobId: job.id,
                amount: job.subcontractorRate,
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
          include: { job: { select: { date: true } } },
        }),
        prisma.job.findMany({
          where: {
            id: { in: jobIds },
            vendorId,
            vendorPaid: false,
            scheduleId: null,
          },
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
        [
          ...addOns.map((addOn) => format(new Date(addOn.job?.date || addOn.createdAt), 'yyyy-MM')),
          ...jobs.map((job) => format(new Date(job.date), 'yyyy-MM')),
        ],
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
                ...addOns.map(addon => ({
                  addOnServiceId: addon.id,
                  amount: addon.subcontractorRate,
                })),
                ...jobs.map(job => ({
                  jobId: job.id,
                  amount: job.subcontractorRate,
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
    const { jobIds } = await request.json().catch(() => ({ jobIds: [] }))

    if (!Array.isArray(jobIds) || jobIds.length === 0 || !jobIds.every(id => typeof id === 'string')) {
      return NextResponse.json({ error: 'jobIds must be a non-empty array' }, { status: 400 })
    }

    const jobs = await prisma.job.findMany({
      where: { id: { in: jobIds }, vendorId },
      select: { id: true },
    })
    if (jobs.length === 0) {
      return NextResponse.json({ error: 'No matching jobs for this vendor' }, { status: 404 })
    }
    const validJobIds = jobs.map(j => j.id)

    const result = await prisma.$transaction(async (tx) => {
      const lineItems = await tx.vendorPaymentLineItem.findMany({
        where: { jobId: { in: validJobIds } },
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

      const updated = await tx.job.updateMany({
        where: { id: { in: validJobIds } },
        data: { vendorPaid: false },
      })
      return { unmarkedCount: updated.count, removedLineItemCount: lineItems.length }
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('Error reverting vendor payment:', error)
    return handleApiError(error, 'Failed to undo the vendor payment')
  }
}
