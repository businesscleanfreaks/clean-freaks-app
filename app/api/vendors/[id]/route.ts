import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"

// GET — vendor detail with unpaid add-ons + payment history
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        addOnServices: {
          include: {
            job: {
              include: {
                location: { include: { client: true } },
              },
            },
            schedule: {
              include: {
                location: { include: { client: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        payments: {
          include: {
            lineItems: {
              include: {
                addOnService: true,
              },
            },
          },
          orderBy: { datePaid: 'desc' },
        },
      },
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    return NextResponse.json(vendor)
  } catch (error) {
    console.error('Vendor detail error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch vendor' },
      { status: 500 }
    )
  }
}

// PATCH — update vendor
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await request.json()

    const allowedFields = ['name', 'phone', 'email', 'zelle', 'notes', 'isActive']
    const data: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) data[field] = body[field]
    }

    // services: array of service-type strings
    if ('services' in body && Array.isArray(body.services)) {
      data.services = body.services.filter((s: unknown) => typeof s === 'string')
    }

    // contacts: array of { name, phone, email }, blanks dropped
    if ('contacts' in body) {
      const raw = Array.isArray(body.contacts) ? body.contacts : []
      data.contacts = raw
        .map((c: { name?: string; phone?: string; email?: string }) => ({
          name: c?.name || '',
          phone: c?.phone || '',
          email: c?.email || '',
        }))
        .filter((c: { name: string; phone: string; email: string }) => c.name || c.phone || c.email)
    }

    const vendor = await prisma.vendor.update({
      where: { id },
      data,
    })

    return NextResponse.json(vendor)
  } catch (error) {
    console.error('Vendor update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update vendor' },
      { status: 500 }
    )
  }
}

// DELETE — permanently delete vendor (only if no linked history)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
    const { id } = await params

    // Safety check: count linked records
    const [addOnCount, paymentCount] = await Promise.all([
      prisma.addOnService.count({ where: { vendorId: id } }),
      prisma.vendorPayment.count({ where: { vendorId: id } }),
    ])

    const totalLinked = addOnCount + paymentCount

    if (totalLinked > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete: this vendor has linked history',
          details: {
            addOnServices: addOnCount,
            payments: paymentCount,
          },
        },
        { status: 409 }
      )
    }

    await prisma.vendor.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Vendor delete error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete vendor' },
      { status: 500 }
    )
  }
}
