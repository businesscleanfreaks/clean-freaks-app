/**
 * Giving existing locations a map position.
 *
 * Positions come from the address when a location is saved (lib/geocode.ts),
 * but until 2026-09 the lookup never ran, so every location was saved without
 * one and the Clients map was empty. This fills them in once, and can be run
 * again later: it only ever touches locations that have no position, so a
 * position already there is never changed.
 */

import type { PrismaClient } from '@prisma/client'
import { geocodeAddress, type GeocodedCoords } from './geocode'

export interface PositionFillResult {
  placed: Array<{ id: string; client: string; location: string }>
  /** Addresses the lookup could not find: usually missing a city or ZIP. */
  notFound: Array<{ id: string; client: string; location: string; address: string }>
}

export async function fillMissingPositions(
  db: Pick<PrismaClient, 'location'>,
  opts: { apply: boolean; geocode?: (address: string) => Promise<GeocodedCoords | null> },
): Promise<PositionFillResult> {
  const geocode = opts.geocode ?? geocodeAddress
  const missing = await db.location.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: { id: true, name: true, address: true, client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const result: PositionFillResult = { placed: [], notFound: [] }
  // One at a time: it is a free public service, and there are only dozens.
  for (const loc of missing) {
    const found = await geocode(loc.address)
    const row = { id: loc.id, client: loc.client.name, location: loc.name }
    if (!found) {
      result.notFound.push({ ...row, address: loc.address })
      continue
    }
    if (opts.apply) {
      // Still only where there is no position, in case one was set meanwhile.
      await db.location.updateMany({
        where: { id: loc.id, OR: [{ latitude: null }, { longitude: null }] },
        data: { latitude: found.lat, longitude: found.lng },
      })
    }
    result.placed.push(row)
  }
  return result
}
