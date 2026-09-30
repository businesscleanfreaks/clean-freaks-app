import { afterEach, describe, expect, it, vi } from "vitest"
import { censusMatch, geocodeAddress, googleMatch } from "@/lib/geocode"

// Shapes of the two services' replies, trimmed to what is read.
const census = (x: number, y: number) => ({ result: { addressMatches: [{ coordinates: { x, y }, matchedAddress: "200 N SPRING ST, LOS ANGELES, CA, 90012" }] } })
const censusNone = { result: { addressMatches: [] } }
const google = (lat: number, lng: number) => ({ status: "OK", results: [{ geometry: { location: { lat, lng } } }] })

const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("reading a lookup reply", () => {
  it("takes the Census match's y as latitude and x as longitude", () => {
    expect(censusMatch(census(-118.2456, 34.0516))).toEqual({ lat: 34.0516, lng: -118.2456 })
  })

  it("finds nothing in an empty or odd reply", () => {
    expect(censusMatch(censusNone)).toBeNull()
    expect(censusMatch({})).toBeNull()
    expect(censusMatch(null)).toBeNull()
    expect(censusMatch({ result: { addressMatches: [{ coordinates: { x: "a", y: 34 } }] } })).toBeNull()
  })

  it("reads Google's only when it says OK", () => {
    expect(googleMatch(google(34.05, -118.24))).toEqual({ lat: 34.05, lng: -118.24 })
    expect(googleMatch({ status: "ZERO_RESULTS", results: [] })).toBeNull()
    expect(googleMatch({ status: "REQUEST_DENIED" })).toBeNull()
  })
})

describe("looking an address up", () => {
  it("asks the free Census lookup when there is no Google key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "")
    const fetchImpl = vi.fn(() => reply(census(-118.2456, 34.0516)))
    expect(await geocodeAddress("200 N Spring St, Los Angeles, CA 90012", fetchImpl)).toEqual({ lat: 34.0516, lng: -118.2456 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("geocoding.geo.census.gov")
  })

  it("asks Google first when a key is set, and the Census when Google finds nothing", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key")
    const found = vi.fn(() => reply(google(34.1, -118.3)))
    expect(await geocodeAddress("1 Main St, Burbank, CA", found)).toEqual({ lat: 34.1, lng: -118.3 })
    expect(found).toHaveBeenCalledTimes(1)

    const fallback = vi.fn()
      .mockImplementationOnce(() => reply({ status: "ZERO_RESULTS", results: [] }))
      .mockImplementationOnce(() => reply(census(-118.3, 34.1)))
    expect(await geocodeAddress("1 Main St, Burbank, CA", fallback)).toEqual({ lat: 34.1, lng: -118.3 })
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it("never throws: a failed, refused or empty lookup is just no position", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "")
    expect(await geocodeAddress("Main office", () => reply(censusNone))).toBeNull()
    expect(await geocodeAddress("1 Main St, LA", () => reply({}, false))).toBeNull()
    expect(await geocodeAddress("1 Main St, LA", () => Promise.reject(new Error("offline")))).toBeNull()
    const neverCalled = vi.fn()
    expect(await geocodeAddress("   ", neverCalled)).toBeNull()
    expect(neverCalled).not.toHaveBeenCalled()
  })
})
