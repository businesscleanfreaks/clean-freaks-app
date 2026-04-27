import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"

const createPaymentSchema = z.object({
  addOnServiceIds: z.array(z.string()).min(1, 'At least one add-on service required'),
  datePaid: z.string().optional(),
  notes: z.string().optional().nullable(),
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
