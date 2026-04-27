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
          where: { vendorPaid: false },
          select: {
            id: true,
            subcontractorRate: true,
            description: true,
            createdAt: true,
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
          take: 1,
          select: {
            id: true,
            datePaid: true,
            totalAmount: true,
          },
        },
      },
    })

    const result = vendors.map(vendor => {
      const owedAmount = vendor.addOnServices.reduce(
        (sum, addon) => sum + addon.subcontractorRate,
        0
      )
      const lastPayment = vendor.payments[0] || null

      return {
        ...vendor,
        createdAt: vendor.createdAt.toISOString(),
        updatedAt: vendor.updatedAt.toISOString(),
        owedAmount,
        unpaidAddOns: vendor.addOnServices.length,
        lastPayment: lastPayment
          ? {
              ...lastPayment,
              datePaid: lastPayment.datePaid.toISOString(),
            }
          : null,
      }
    })

    return NextResponse.json(result)
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
