import { describe, it, expect } from "vitest"
import { safeRedirectPath, DEFAULT_REDIRECT } from "@/lib/safe-redirect"

describe("where a login may send you", () => {
  it("allows a path inside the app", () => {
    expect(safeRedirectPath("/invoices")).toBe("/invoices")
    expect(safeRedirectPath("/clients/abc?tab=schedule")).toBe("/clients/abc?tab=schedule")
  })

  it("refuses another site", () => {
    // The reported defect: the raw param went to router.push, so a login link
    // could land the user on someone else's page just as they signed in.
    expect(safeRedirectPath("https://evil.example/invoices")).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath("http://evil.example")).toBe(DEFAULT_REDIRECT)
  })

  it("refuses a protocol-relative URL, which looks like a path but is not", () => {
    expect(safeRedirectPath("//evil.example/invoices")).toBe(DEFAULT_REDIRECT)
  })

  it("refuses the backslash variant browsers normalise into one", () => {
    expect(safeRedirectPath("/" + String.fromCharCode(92) + "evil.example")).toBe(DEFAULT_REDIRECT)
  })

  it("refuses a javascript: destination", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe(DEFAULT_REDIRECT)
  })

  it("refuses anything not rooted at a slash", () => {
    expect(safeRedirectPath("invoices")).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath("evil.example/invoices")).toBe(DEFAULT_REDIRECT)
  })

  it("refuses a value carrying a newline or control character", () => {
    expect(safeRedirectPath("/invoices\nLocation: https://evil.example")).toBe(DEFAULT_REDIRECT)
  })

  it("falls back to home for nothing at all", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath("")).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath("   ")).toBe(DEFAULT_REDIRECT)
  })
})
