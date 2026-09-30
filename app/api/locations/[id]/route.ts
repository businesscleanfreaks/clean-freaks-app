import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { updateLocationSchema } from '@/lib/validations'
import { revalidateLocationPages, revalidateSchedulePages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { geocodeAddress } from '@/lib/geocode'

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await request.json()
    const validationResult = updateLocationSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    const data = validationResult.data

    // A changed address gets its map position looked up again, and so does an
    // address saved without one. If it can't be found the old position is
    // cleared, so the Clients map never pins the old place.
    let position: { latitude: number | null; longitude: number | null } | undefined
    if (data.address !== undefined) {
      const current = await prisma.location.findUnique({
        where: { id: params.id },
        select: { address: true, latitude: true, longitude: true },
      })
      const moved = current && current.address.trim() !== data.address.trim()
      const unplaced = current && (current.latitude == null || current.longitude == null)
      if (moved || unplaced) {
        const found = await geocodeAddress(data.address)
        position = found ? { latitude: found.lat, longitude: found.lng } : moved ? { latitude: null, longitude: null } : undefined
      }
    }

    const location = await prisma.location.update({
      where: { id: params.id },
      data: { ...data, ...position },
      include: { client: true },
    })

    revalidateSchedulePages(location.clientId)

    return NextResponse.json(location)
  } catch (error) {
    logger.error('Error updating location:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update location' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    // Get location with client info before deleting
    const location = await prisma.location.findUnique({
      where: { id: params.id },
      include: {
        client: true,
      },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Location not found' },
        { status: 404 }
      )
    }

    // Check if location has any invoiced or paid jobs before deletion
    // Jobs that aren't invoiced or paid will be automatically deleted (cascade)
    const invoicedJobCount = await prisma.job.count({
      where: {
        locationId: params.id,
        invoiced: true,
      },
    })

    const paidJobCount = await prisma.job.count({
      where: {
        locationId: params.id,
        subcontractorPaid: true,
      },
    })

    if (invoicedJobCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete location. This location has ${invoicedJobCount} invoiced job(s). Please delete the associated invoices first.`
        },
        { status: 400 }
      )
    }

    if (paidJobCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete location. This location has ${paidJobCount} job(s) that have been paid to subcontractors. Please handle those payments first.`
        },
        { status: 400 }
      )
    }

    await prisma.location.delete({
      where: { id: params.id },
    })

    // Revalidate all location-related pages
    revalidateLocationPages(location.client.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting location:', error)
    // Provide more helpful error message
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete location'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
