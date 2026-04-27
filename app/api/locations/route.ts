import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createLocationSchema } from '@/lib/validations'
import { geocodeAddress } from '@/lib/geocode'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = createLocationSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      )
    }

    // Try to geocode the address
    let latitude: number | undefined
    let longitude: number | undefined
    
    try {
      const coords = await geocodeAddress(validationResult.data.address)
      if (coords) {
        latitude = coords.lat
        longitude = coords.lng
      }
    } catch (geoError) {
      logger.warn('Geocoding failed, continuing without coordinates:', geoError)
    }

    const location = await prisma.location.create({
      data: {
        clientId: validationResult.data.clientId,
        name: validationResult.data.name,
        address: validationResult.data.address,
        accessInfo: validationResult.data.accessInfo || null,
        latitude,
        longitude,
      },
    })

    return NextResponse.json(location, { status: 201 })
  } catch (error) {
    logger.error('Error creating location:', error)
    return NextResponse.json(
      { error: 'Failed to create location' },
      { status: 500 }
    )
  }
}
