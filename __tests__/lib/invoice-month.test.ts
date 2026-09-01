import { describe, it, expect } from "vitest"
import { invoiceWorkspaceMonth } from "@/lib/invoice-month"

describe("invoiceWorkspaceMonth", () => {
  it("uses the month the work happened in, not the day it was billed", () => {
    // Josh's bug: an August invoice written in September opened on September,
    // where its row is not, so the workspace showed the wrong month.
    expect(invoiceWorkspaceMonth({
      billingPeriodStart: new Date("2026-08-01T07:00:00.000Z"),
      dateCreated: new Date("2026-09-02T18:00:00.000Z"),
    })).toBe("2026-08")
  })

  it("works the other way round too", () => {
    // Written in August for September work.
    expect(invoiceWorkspaceMonth({
      billingPeriodStart: new Date("2026-09-01T07:00:00.000Z"),
      dateCreated: new Date("2026-08-25T18:00:00.000Z"),
    })).toBe("2026-09")
  })

  it("falls back to the created date for older invoices with no period", () => {
    // Every invoice written before billing periods were recorded.
    expect(invoiceWorkspaceMonth({
      billingPeriodStart: null,
      dateCreated: new Date("2026-08-05T12:00:00.000Z"),
    })).toBe("2026-08")
  })

  it("reads the first of the month as that month", () => {
    // Local accessors in a timezone behind UTC would say July here.
    expect(invoiceWorkspaceMonth({ billingPeriodStart: "2026-08-01T00:00:00.000Z" })).toBe("2026-08")
  })

  it("accepts strings as well as dates", () => {
    expect(invoiceWorkspaceMonth({ dateCreated: "2026-12-31T23:00:00.000Z" })).toBe("2026-12")
  })

  it("returns null when there is nothing to read, so the caller can default", () => {
    expect(invoiceWorkspaceMonth({})).toBeNull()
    expect(invoiceWorkspaceMonth({ billingPeriodStart: null, dateCreated: null })).toBeNull()
    expect(invoiceWorkspaceMonth({ dateCreated: "not a date" })).toBeNull()
  })
})
