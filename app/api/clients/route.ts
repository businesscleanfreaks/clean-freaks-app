import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { revalidateClientPages } from '@/lib/revalidate'
import { createClientSchema } from '@/lib/validations'
import { handleApiError, createErrorResponse } from '@/lib/api-error-handler'
import { parseDateOnlyForStorage } from '@/lib/date-only'

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      include: {
        locations: {
          include: {
            schedules: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    })
    return NextResponse.json(clients, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    })
  } catch (error) {
    return handleApiError(error, 'Failed to fetch clients')
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = createClientSchema.safeParse(body)
    if (!validationResult.success) {
      return createErrorResponse(
        validationResult.error.errors[0].message,
        400,
        'VALIDATION_ERROR'
      )
    }
    
    const { locations, startDate, sourceProspectId, ...clientData } = validationResult.data

    const client = await prisma.client.create({
      data: {
        ...clientData,
        startDate: parseDateOnlyForStorage(startDate),
        locations: locations
          ? {
              create: locations.map((loc: { name: string; address: string }) => ({
                name: loc.name,
                address: loc.address,
              })),
            }
          : undefined,
      },
      include: {
        locations: true,
      },
    })

    if (sourceProspectId) {
      await prisma.prospect.update({
        where: { id: sourceProspectId },
        data: {
          convertedClientId: client.id,
          status: 'WON',
          stage: 'WON',
          nextActionType: null,
          nextActionDueAt: null,
          nextActionNote: null,
        },
      }).catch(() => null)
    }

    // Revalidate all client-related pages
    revalidateClientPages(client.id)

    return NextResponse.json(client, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'Failed to create client')
  }
}
