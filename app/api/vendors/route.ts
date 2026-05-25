import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"

export const dynamic = 'force-dynamic'

const createVendorSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// GET — list all vendors with owed amounts
export async function GET() {
  try {
    await requireAuth()

    const vendors = await prisma.vendor.findMany({
      orderBy: { name: 'asc' },
      include: {
        addOnServices: {
          select: {
            id: true,
            subcontractorRate: true,
            description: true,
            vendorPaid: true,
            createdAt: true,
            vendorPaymentLineItems: {
              select: {
                payment: {
                  select: {
                    id: true,
                    datePaid: true,
                  },
                },
              },
            },
            job: {
              select: {
                id: true,
                date: true,
                status: true,
                location: {
                  select: {
                    client: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
            schedule: {
              select: {
                id: true,
                location: {
                  select: {
                    client: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { datePaid: 'desc' },
          select: {
            id: true,
            datePaid: true,
            totalAmount: true,
            lineItems: {
              select: { id: true },
            },
          },
        },
      },
    })

    const result = vendors.map(vendor => {
      const unpaidAddOns = vendor.addOnServices.filter(addon => !addon.vendorPaid)
      const owedAmount = unpaidAddOns.reduce(
        (sum, addon) => sum + addon.subcontractorRate,
        0
      )
      const lastPayment = vendor.payments[0] || null

      return {
        ...vendor,
        createdAt: vendor.createdAt.toISOString(),
        updatedAt: vendor.updatedAt.toISOString(),
        owedAmount,
        unpaidAddOns: unpaidAddOns.length,
        lastPayment: lastPayment
          ? {
              ...lastPayment,
              datePaid: lastPayment.datePaid.toISOString(),
            }
          : null,
        payments: vendor.payments.map(payment => ({
          ...payment,
          datePaid: payment.datePaid.toISOString(),
        })),
        addOnServices: vendor.addOnServices.map(addon => ({
          ...addon,
          createdAt: addon.createdAt.toISOString(),
          job: addon.job
            ? {
                ...addon.job,
                date: addon.job.date.toISOString(),
              }
            : null,
          paidDate: addon.vendorPaymentLineItems[0]?.payment?.datePaid
            ? addon.vendorPaymentLineItems[0].payment.datePaid.toISOString()
            : null,
          vendorPaymentLineItems: undefined,
        })),
      }
    })

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=59',
      },
    })
  } catch (error) {
    console.error('Vendors list error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch vendors' },
      { status: 500 }
    )
  }
}

// POST — create vendor
export async function POST(request: Request) {
  try {
    await requireAuth()
    const body = await request.json()

    const result = createVendorSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const vendor = await prisma.vendor.create({
      data: {
        name: result.data.name,
        phone: result.data.phone || null,
        email: result.data.email || null,
        notes: result.data.notes || null,
      },
    })

    return NextResponse.json(vendor, { status: 201 })
  } catch (error) {
    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A vendor with this name already exists' },
        { status: 409 }
      )
    }
    console.error('Create vendor error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create vendor' },
      { status: 500 }
    )
  }
}
