import { describe, expect, it } from "vitest"
import { placeOnMap } from "@/lib/client-map"

const loc = (id: string, name: string, at: [number, number] | null) => ({
  id, name, latitude: at ? at[0] : null, longitude: at ? at[1] : null,
})

describe("what the Clients map shows", () => {
  it("pins every placed location, one per site, named by the client", () => {
    const { pins, unplaced } = placeOnMap([
      { id: "c1", name: "Oakwood Pilates", locations: [loc("l1", "Oakwood Pilates", [34.08, -118.29])] },
      { id: "c2", name: "Harborview Dental", locations: [loc("l2", "Silver Lake", [34.09, -118.27]), loc("l3", "Echo Park", [34.07, -118.26])] },
    ])
    expect(pins.map(p => [p.location.id, p.label])).toEqual([
      ["l1", "Oakwood Pilates"],
      ["l2", "Harborview Dental · Silver Lake"],
      ["l3", "Harborview Dental · Echo Park"],
    ])
    expect(unplaced).toEqual([])
  })

  it("lists the locations with no position instead of dropping them", () => {
    const client = { id: "c1", name: "Rajiv Menon", locations: [loc("l1", "Home", null), loc("l2", "Office", [34.1, -118.3])] }
    const { pins, unplaced } = placeOnMap([client])
    expect(pins.map(p => p.location.id)).toEqual(["l2"])
    expect(unplaced.map(u => [u.client.id, u.location.id])).toEqual([["c1", "l1"]])
  })

  it("does not pin a half position, and skips clients with no locations", () => {
    const { pins, unplaced } = placeOnMap([
      { id: "c1", name: "A", locations: [{ id: "l1", name: "A", latitude: 34.1, longitude: null }] },
      { id: "c2", name: "B", locations: [] },
    ])
    expect(pins).toEqual([])
    expect(unplaced.map(u => u.location.id)).toEqual(["l1"])
  })
})
