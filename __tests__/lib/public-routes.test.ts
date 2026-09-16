import { describe, it, expect } from "vitest"
import { isPublicInvoicePdfRequest } from "@/lib/public-routes"

const req = (over: Partial<Parameters<typeof isPublicInvoicePdfRequest>[0]> = {}) =>
  isPublicInvoicePdfRequest({
    method: "GET",
    pathname: "/api/invoices/abc-123/generate-pdf",
    hasToken: true,
    ...over,
  })

describe("the public invoice PDF exemption", () => {
  it("lets a client download their own invoice", () => {
    // The whole point: this used to redirect the client to our staff login.
    expect(req()).toBe(true)
  })

  it("does not exempt PDF generation", () => {
    // POST creates the invoice record. It stays behind the session.
    expect(req({ method: "POST" })).toBe(false)
  })

  it("does not exempt a request with no token", () => {
    // That is a staff request without a session; it should still go to login.
    expect(req({ hasToken: false })).toBe(false)
  })

  it("exempts nothing else under invoices", () => {
    // The audit's warning: do not broadly exempt the invoice APIs.
    for (const pathname of [
      "/api/invoices/abc-123",
      "/api/invoices/abc-123/send-email",
      "/api/invoices/abc-123/finalize",
      "/api/invoices/abc-123/mark-sent",
      "/api/invoices/candidates",
      "/api/invoices/abc-123/generate-pdf/extra",
      "/api/invoices/abc-123/payment",
    ]) {
      expect(req({ pathname })).toBe(false)
    }
  })

  it("cannot be widened by extra path segments", () => {
    expect(req({ pathname: "/api/invoices/a/b/generate-pdf" })).toBe(false)
  })

  it("does not match a lookalike path elsewhere", () => {
    expect(req({ pathname: "/api/clients/abc/generate-pdf" })).toBe(false)
    expect(req({ pathname: "/generate-pdf" })).toBe(false)
  })

  it("accepts the method in any casing", () => {
    expect(req({ method: "get" })).toBe(true)
  })
})
