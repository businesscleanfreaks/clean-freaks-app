import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { updateLocationSchema } from '@/lib/validations'
import { revalidateLocationPages, revalidateSchedulePages } from '@/lib/revalidate'
import { logger } from '@/lib/logger'

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const validationResult = updateLocationSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    const location = await prisma.location.update({
      where: { id: params.id },
      data: validationResult.data,
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
