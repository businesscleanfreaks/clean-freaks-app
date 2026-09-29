import { describe, it, expect } from "vitest"
import { cleanerFileKind, cleanerFileUploadProblem, cleanerFileUrl } from "@/lib/cleaner-files"

describe("which file is meant", () => {
  it("is the W-9 only when asked for by name, otherwise the photo", () => {
    expect(cleanerFileKind("w9")).toBe("w9")
    for (const other of ["photo", "W9", "", null, undefined]) expect(cleanerFileKind(other)).toBe("photo")
  })
})

describe("what can be uploaded", () => {
  it("takes a picture as the photo, and a picture or a PDF as the W-9", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(cleanerFileUploadProblem("photo", { size: 150_000, type })).toBeNull()
      expect(cleanerFileUploadProblem("w9", { size: 150_000, type })).toBeNull()
    }
    expect(cleanerFileUploadProblem("w9", { size: 150_000, type: "application/pdf" })).toBeNull()
  })

  it("refuses a PDF as the photo, other files, empty files and anything over 5MB", () => {
    expect(cleanerFileUploadProblem("photo", { size: 1000, type: "application/pdf" })).toBe("Upload an image")
    expect(cleanerFileUploadProblem("w9", { size: 1000, type: "text/plain" })).toBe("Upload a PDF or an image")
    expect(cleanerFileUploadProblem("photo", { size: 0, type: "image/png" })).toContain("empty")
    expect(cleanerFileUploadProblem("w9", { size: 5 * 1024 * 1024 + 1, type: "application/pdf" })).toContain("over 5MB")
  })
})

describe("the URL a page shows a file by", () => {
  it("is null when there is no file", () => {
    expect(cleanerFileUrl("s1", "photo", null)).toBeNull()
    expect(cleanerFileUrl("s1", "photo", undefined)).toBeNull()
  })

  it("carries the file's last change, so a replaced photo is a new URL", () => {
    const first = cleanerFileUrl("s1", "photo", new Date("2026-09-29T10:00:00Z"))
    const second = cleanerFileUrl("s1", "photo", "2026-09-29T10:05:00.000Z")
    expect(first).toBe(`/api/cleaners/s1/files?kind=photo&v=${Date.parse("2026-09-29T10:00:00Z")}`)
    expect(second).not.toBe(first)
  })
})
