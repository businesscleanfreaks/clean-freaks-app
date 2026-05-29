import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { z } from "zod"

export const dynamic = 'force-dynamic'

const vendorContactSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
})

const createVendorSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  zelle: z.string().optional().nullable(),
  services: z.array(z.string()).optional(),
  contacts: z.array(vendorContactSchema).optional(),
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

      // Multi-contact support with back-compat: fall back to legacy phone/email
      // when no structured contacts have been saved yet.
      const rawContacts = Array.isArray(vendor.contacts)
        ? (vendor.contacts as Array<{ name?: string; phone?: string; email?: string }>)
        : []
      const contacts = rawContacts.length > 0
        ? rawContacts.map(c => ({ name: c.name || '', phone: c.phone || '', email: c.email || '' }))
        : (vendor.phone || vendor.email)
          ? [{ name: '', phone: vendor.phone || '', email: vendor.email || '' }]
          : []

      return {
        ...vendor,
        contacts,
        services: vendor.services || [],
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

    const cleanContacts = (result.data.contacts || [])
      .map(c => ({ name: c.name || '', phone: c.phone || '', email: c.email || '' }))
      .filter(c => c.name || c.phone || c.email)

    const vendor = await prisma.vendor.create({
      data: {
        name: result.data.name,
        phone: result.data.phone || null,
        email: result.data.email || null,
        zelle: result.data.zelle || null,
        services: result.data.services || [],
        contacts: cleanContacts.length > 0 ? cleanContacts : undefined,
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
