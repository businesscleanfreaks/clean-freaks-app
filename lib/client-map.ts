/**
 * What the Clients map shows: a pin for every location with a map position,
 * and the locations without one, so they can be found and their address
 * completed rather than silently missing from the map.
 *
 * One pin per location, not per client: a client with two sites is in two
 * places, often with two different cleaners.
 *
 * Pure: no React, no Leaflet.
 */

export interface MappableLocation {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
}

export interface MappableClient {
  id: string
  name: string
  locations: MappableLocation[]
}

type LocationOf<C extends MappableClient> = C["locations"][number]

export interface MapPlacement<C extends MappableClient> {
  client: C
  location: LocationOf<C>
  lat: number
  lng: number
  /** The client's name, plus the site's when the client has more than one. */
  label: string
}

const placed = <L extends MappableLocation>(loc: L): loc is L & { latitude: number; longitude: number } =>
  typeof loc.latitude === "number" && typeof loc.longitude === "number" &&
  Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)

export function placeOnMap<C extends MappableClient>(clients: readonly C[]): {
  pins: MapPlacement<C>[]
  unplaced: Array<{ client: C; location: LocationOf<C> }>
} {
  const pins: MapPlacement<C>[] = []
  const unplaced: Array<{ client: C; location: LocationOf<C> }> = []
  for (const client of clients) {
    const several = client.locations.length > 1
    for (const location of client.locations as LocationOf<C>[]) {
      if (!placed(location)) {
        unplaced.push({ client, location })
        continue
      }
      const site = location.name.trim()
      const label = several && site && site !== client.name ? `${client.name} · ${site}` : client.name
      pins.push({ client, location, lat: location.latitude, lng: location.longitude, label })
    }
  }
  return { pins, unplaced }
}
