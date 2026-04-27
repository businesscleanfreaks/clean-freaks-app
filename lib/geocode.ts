/** Geocoding helper — converts addresses to lat/lng coordinates */

interface GeocodedCoords {
  lat: number
  lng: number
}

/**
 * Geocode an address string to coordinates.
 * Uses the Google Maps Geocoding API if GOOGLE_MAPS_API_KEY is set,
 * otherwise returns null (coordinates can be added manually).
 */
export async function geocodeAddress(address: string): Promise<GeocodedCoords | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) return null

    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.[0]) return null

    const { lat, lng } = data.results[0].geometry.location
    return { lat, lng }
  } catch {
    return null
  }
}
