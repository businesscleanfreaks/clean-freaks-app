import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { revalidateClientPages } from '@/lib/revalidate'
import { handleApiError } from '@/lib/api-error-handler'
import { geocodeAddress } from '@/lib/geocode'
import { logger } from '@/lib/logger'
import { newClientRecords, validateNewClient, type NewClientInput } from '@/lib/new-client'

/**
 * The Add Client modal's save: the client, its first location, its primary
 * contact (and a billing inbox when invoices go elsewhere), and the prospect
 * it came from, all in one transaction. Either the whole client exists or
 * none of it does. What gets written is decided in lib/new-client.ts.
 */
export async function POST(request: Request) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as NewClientInput
    const problems = validateNewClient(body ?? { name: '' })
    if (problems.length > 0) {
      return NextResponse.json({ error: problems[0].message, problems }, { status: 400 })
    }

    const records = newClientRecords(body)

    // Looked up before the transaction: a slow map service must not hold a
    // database transaction open. No key, or no match, just means no map pin.
    let coords: { lat: number; lng: number } | null = null
    if (records.location) {
      try {
        coords = await geocodeAddress(records.location.address)
      } catch (error) {
        logger.warn('[clients/create] geocoding failed', error)
      }
    }

    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          ...records.client,
          locations: records.location
            ? {
                create: {
                  ...records.location,
                  latitude: coords?.lat,
                  longitude: coords?.lng,
                },
              }
            : undefined,
          contacts: records.contacts.length > 0 ? { create: records.contacts } : undefined,
        },
        select: { id: true, name: true, locations: { select: { id: true } } },
      })

      if (records.sourceProspectId) {
        // updateMany so a prospect that has since been removed, or already
        // converted, does not fail the client.
        await tx.prospect.updateMany({
          where: { id: records.sourceProspectId, convertedClientId: null },
          data: {
            convertedClientId: created.id,
            status: 'WON',
            stage: 'WON',
            nextActionType: null,
            nextActionDueAt: null,
            nextActionNote: null,
          },
        })
      }

      return created
    })

    revalidateClientPages(client.id)

    return NextResponse.json(
      { id: client.id, name: client.name, locationId: client.locations[0]?.id ?? null },
      { status: 201 },
    )
  } catch (error) {
    return handleApiError(error, 'Failed to create client')
  }
}
