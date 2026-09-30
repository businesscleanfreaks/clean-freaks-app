/**
 * Where an address is on a map, for the Clients map view.
 *
 * This used to ask Google only, behind GOOGLE_MAPS_API_KEY. The key was never
 * set, so no location ever got a position and the map stayed empty. It now
 * asks the US Census Bureau's geocoder, which is free and needs no key, and
 * still asks Google first if a key is ever set.
 *
 * No match is not an error: an address without a city or ZIP simply gets no
 * pin, and the map lists it as "not on the map" so it can be completed.
 */

export interface GeocodedCoords {
  lat: number
  lng: number
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
const GOOGLE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
/** A slow lookup must not hold up saving a location. */
const TIMEOUT_MS = 8000

const isCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** The first match in a Census geocoder reply, or null. Its coordinates are x = longitude, y = latitude. */
export function censusMatch(body: unknown): GeocodedCoords | null {
  const match = (body as { result?: { addressMatches?: Array<{ coordinates?: { x?: unknown; y?: unknown } }> } })
    ?.result?.addressMatches?.[0]
  const lat = match?.coordinates?.y
  const lng = match?.coordinates?.x
  return isCoord(lat, lng) ? { lat: lat as number, lng: lng as number } : null
}

/** The first match in a Google geocoding reply, or null. */
export function googleMatch(body: unknown): GeocodedCoords | null {
  const reply = body as { status?: string; results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }> }
  if (reply?.status !== 'OK') return null
  const location = reply.results?.[0]?.geometry?.location
  return isCoord(location?.lat, location?.lng) ? { lat: location!.lat as number, lng: location!.lng as number } : null
}

async function ask(fetchImpl: Fetch, url: string, read: (body: unknown) => GeocodedCoords | null) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return read(await res.json())
  } catch {
    return null
  }
}

/** Where this address is, or null when it cannot be found. Never throws. */
export async function geocodeAddress(address: string, fetchImpl: Fetch = fetch): Promise<GeocodedCoords | null> {
  const query = address.trim()
  if (!query) return null

  const key = process.env.GOOGLE_MAPS_API_KEY
  if (key) {
    const found = await ask(fetchImpl, `${GOOGLE_URL}?address=${encodeURIComponent(query)}&key=${key}`, googleMatch)
    if (found) return found
  }

  return ask(
    fetchImpl,
    `${CENSUS_URL}?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`,
    censusMatch,
  )
}
