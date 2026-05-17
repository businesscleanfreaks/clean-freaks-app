import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"

export const dynamic = 'force-dynamic'

const createPaymentSchema = z.object({
  addOnServiceIds: z.array(z.string()).min(1, 'At least one add-on service required'),
  datePaid: z.string().optional(),
  notes: z.string().optional().nullable(),
})

const updatePaymentStateSchema = z.object({
  addOnServiceIds: z.array(z.string()).min(1, 'At least one add-on service required'),
  vendorPaid: z.boolean(),
})

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

    const { addOnServiceIds, datePaid, notes } = result.data

    // Get unpaid add-on services for this vendor
    const addOns = await prisma.addOnService.findMany({
      where: {
        id: { in: addOnServiceIds },
        vendorId,
        vendorPaid: false,
      },
    })

    if (addOns.length === 0) {
      return NextResponse.json(
        { error: 'No valid unpaid add-on services found for this vendor' },
        { status: 400 }
      )
    }

    const totalAmount = addOns.reduce((sum, a) => sum + a.subcontractorRate, 0)

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.vendorPayment.create({
        data: {
          vendorId,
          datePaid: datePaid ? new Date(datePaid + 'T12:00:00') : new Date(),
          totalAmount,
          notes: notes || null,
          lineItems: {
            create: addOns.map(a => ({
              addOnServiceId: a.id,
              amount: a.subcontractorRate,
            })),
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
      await tx.addOnService.updateMany({
        where: { id: { in: addOnServiceIds } },
        data: { vendorPaid: true },
      })

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

    const { addOnServiceIds, vendorPaid } = result.data

    if (vendorPaid) {
      const addOns = await prisma.addOnService.findMany({
        where: {
          id: { in: addOnServiceIds },
          vendorId,
          vendorPaid: false,
        },
      })

      if (addOns.length === 0) {
        return NextResponse.json(
          { error: 'No valid unpaid add-on services found for this vendor' },
          { status: 400 }
        )
      }

      const totalAmount = addOns.reduce((sum, addon) => sum + addon.subcontractorRate, 0)

      await prisma.$transaction(async (tx) => {
        await tx.vendorPayment.create({
          data: {
            vendorId,
            datePaid: new Date(),
            totalAmount,
            notes: null,
            lineItems: {
              create: addOns.map(addon => ({
                addOnServiceId: addon.id,
                amount: addon.subcontractorRate,
              })),
            },
          },
        })

        await tx.addOnService.updateMany({
          where: { id: { in: addOns.map(addon => addon.id) }, vendorId },
          data: { vendorPaid: true },
        })
      })

      return NextResponse.json({ success: true })
    }

    await prisma.$transaction(async (tx) => {
      const lineItems = await tx.vendorPaymentLineItem.findMany({
        where: {
          addOnServiceId: { in: addOnServiceIds },
          addOnService: { vendorId },
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
