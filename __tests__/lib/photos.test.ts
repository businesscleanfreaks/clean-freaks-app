import { describe, it, expect } from "vitest"
import { fitWithin, isPhotoOwner, photoUploadProblem, photoUrl } from "@/lib/photos"

describe("what can be uploaded as a photo", () => {
  it("takes a JPG, PNG, WebP or GIF under 5MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(photoUploadProblem({ size: 150_000, type })).toBeNull()
    }
  })

  it("refuses other files, empty files and anything over 5MB", () => {
    expect(photoUploadProblem({ size: 1000, type: "application/pdf" })).toContain("JPG, PNG or WebP")
    expect(photoUploadProblem({ size: 1000, type: "image/heic" })).toContain("JPG, PNG or WebP")
    expect(photoUploadProblem({ size: 0, type: "image/png" })).toContain("empty")
    expect(photoUploadProblem({ size: 5 * 1024 * 1024 + 1, type: "image/png" })).toContain("over 5MB")
  })
})

describe("the photo URL a page shows", () => {
  it("is null when there is no photo", () => {
    expect(photoUrl("client", "c1", null)).toBeNull()
    expect(photoUrl("client", "c1", undefined)).toBeNull()
  })

  it("carries the photo's last change, so a replaced photo is a new URL", () => {
    const first = photoUrl("location", "l1", new Date("2026-09-29T10:00:00Z"))
    const second = photoUrl("location", "l1", "2026-09-29T10:05:00.000Z")
    expect(first).toBe(`/api/photos/location/l1?v=${Date.parse("2026-09-29T10:00:00Z")}`)
    expect(second).not.toBe(first)
  })
})

describe("who can own a photo", () => {
  it("is a client, a location or a contact", () => {
    expect(["client", "location", "contact", "cleaner", ""].filter(isPhotoOwner)).toEqual(["client", "location", "contact"])
  })
})

describe("shrinking a picture", () => {
  it("fits the longer side, keeping the shape", () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 })
    expect(fitWithin(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 })
  })

  it("never enlarges a small picture", () => {
    expect(fitWithin(640, 480, 1200)).toEqual({ width: 640, height: 480 })
  })
})
