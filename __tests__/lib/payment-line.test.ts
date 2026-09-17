import { describe, it, expect } from "vitest"
import { paymentLineDescription } from "@/lib/payment-line"

describe("what a payment line says it paid for", () => {
  it("names the account and the day", () => {
    expect(paymentLineDescription({ name: "Bigco Offices", date: "2026-09-02T12:00:00.000Z" }))
      .toBe("Bigco Offices \u00b7 Sep 2, 2026")
  })

  it("reads the date in the stored day, not the day before", () => {
    // Job dates are stored at noon UTC precisely so they cannot slide a day.
    expect(paymentLineDescription({ name: "Acme", date: "2026-09-01T12:00:00.000Z" }))
      .toContain("Sep 1, 2026")
  })

  it("falls back to the account alone when there is no date", () => {
    expect(paymentLineDescription({ name: "Bigco Offices", date: null })).toBe("Bigco Offices")
  })

  it("survives a date that will not parse", () => {
    // A description is a record, not a calculation. It must never throw and
    // lose the line it was describing.
    expect(paymentLineDescription({ name: "Bigco Offices", date: "not a date" })).toBe("Bigco Offices")
  })

  it("gives the date alone rather than nothing when the name is missing", () => {
    expect(paymentLineDescription({ name: "  ", date: "2026-09-02T12:00:00.000Z" })).toBe("Sep 2, 2026")
  })

  it("trims a padded name", () => {
    expect(paymentLineDescription({ name: "  Acme  ", date: null })).toBe("Acme")
  })
})
