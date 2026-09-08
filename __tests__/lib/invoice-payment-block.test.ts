import { describe, it, expect } from "vitest"
import {
  buildPaymentBlock,
  isUndecidedPayMethod,
  normalizePayMethod,
  printsNoPaymentSection,
} from "@/lib/invoice-payment-block"
import { DEFAULT_FOOTER_TEMPLATES, resolveInvoiceFooter } from "@/lib/billing-sections"

const business = {
  paymentEmail: "admin@thecleanfreaks.co",
  legalName: "Shiloh Pro Cleaning Services",
  dba: "(DBA The Clean Freaks)",
  mailingAddress: "1240 Abbot Kinney Blvd, Venice, CA 90291",
}

/** The block as the real invoice builds it, footer resolved by method. */
const blockFor = (payMethod: string | null) =>
  buildPaymentBlock({ ...business, payMethod, templates: DEFAULT_FOOTER_TEMPLATES })

describe("normalizePayMethod", () => {
  it("accepts the four methods in any casing", () => {
    expect(normalizePayMethod("zelle")).toBe("ZELLE")
    expect(normalizePayMethod(" Check ")).toBe("CHECK")
    expect(normalizePayMethod("PORTAL")).toBe("PORTAL")
  })

  it("returns null for anything else", () => {
    expect(normalizePayMethod("venmo")).toBeNull()
    expect(normalizePayMethod("")).toBeNull()
    expect(normalizePayMethod(null)).toBeNull()
  })
})

describe("buildPaymentBlock", () => {
  it("prints Zelle details only for a Zelle client", () => {
    const block = blockFor("ZELLE")
    expect(block.details[0]).toEqual({ label: "Zelle", value: "admin@thecleanfreaks.co" })
    expect(block.details[1]).toMatchObject({ label: "Full name", value: "Shiloh Pro Cleaning Services" })
    expect(block.instructions).toContain("Zelle")
  })

  it("never shows the Zelle address to a client who does not pay by Zelle", () => {
    // The bug this replaces: both the PDF and the preview hardcoded "Zelle"
    // and our Zelle address on every invoice, whatever the client's method.
    for (const method of ["ACH", "CHECK", "PORTAL", null]) {
      const printed = JSON.stringify(blockFor(method))
      expect(printed).not.toContain("admin@thecleanfreaks.co")
    }
  })

  it("gives a cheque client an address, not an email", () => {
    const block = blockFor("CHECK")
    expect(block.details[0]).toMatchObject({ label: "Mail a cheque to" })
    expect(block.details[0].value).toContain("Abbot Kinney")
  })

  it("prints nothing at all for a portal client", () => {
    // They pay through their own AP system; our details invite a second
    // payment, and the PORTAL template is a note written for Josh.
    const block = blockFor("PORTAL")
    expect(printsNoPaymentSection(block)).toBe(true)
    expect(block.showFeeNotice).toBe(false)
  })

  it("never leaks the internal portal note onto a client's invoice", () => {
    const internal = DEFAULT_FOOTER_TEMPLATES.PORTAL
    expect(internal).toContain("No payment info printed")
    // Even handed that note directly, the block refuses to print it.
    const block = buildPaymentBlock({ ...business, payMethod: "PORTAL", templates: DEFAULT_FOOTER_TEMPLATES })
    expect(JSON.stringify(block)).not.toContain("No payment info printed")
  })

  it("omits the details column when the method is unknown", () => {
    const block = blockFor(null)
    expect(block.title).toBeNull()
    expect(block.details).toEqual([])
  })

  it("still prints a generic note when the method is unknown", () => {
    const block = buildPaymentBlock({ ...business, payMethod: null, genericNote: "Thank you for your business" })
    expect(block.instructions).toBe("Thank you for your business")
    expect(block.details).toEqual([])
  })

  it("carries the DBA line under the legal name", () => {
    expect(blockFor("ZELLE").details[1].sub).toBe("(DBA The Clean Freaks)")
  })

  it("drops the name row when there is nothing to attach it to", () => {
    // No email on file for a Zelle client: print no half-finished details.
    const block = buildPaymentBlock({ ...business, paymentEmail: "", payMethod: "ZELLE" })
    expect(block.details).toEqual([])
    expect(block.title).toBeNull()
  })

  it("treats blank instructions as nothing to print", () => {
    const block = buildPaymentBlock({ ...business, payMethod: "ACH", genericNote: "   " })
    expect(block.instructions).toBeNull()
  })
})

describe("the business default", () => {
  it("is used when the client has no method of their own", () => {
    // Every client's payMethod is currently empty, so without this the fix
    // would print no way to pay on any invoice.
    const block = buildPaymentBlock({
      ...business, payMethod: null, fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES,
    })
    expect(block.details[0]).toMatchObject({ label: "Zelle" })
  })

  it("never overrides a client who has one", () => {
    const block = buildPaymentBlock({
      ...business, payMethod: "PORTAL", fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES,
    })
    expect(printsNoPaymentSection(block)).toBe(true)
    expect(JSON.stringify(block)).not.toContain("admin@thecleanfreaks.co")
  })

  it("prints no details when neither is set", () => {
    const block = buildPaymentBlock({ ...business, payMethod: null, fallbackMethod: null })
    expect(block.details).toEqual([])
  })
})

/**
 * The values actually in the client table on 2026-09-08, with their counts.
 * These are what the invoice has to get right, not the enum names.
 */
describe("the values really in the database", () => {
  const LIVE_VALUES: [string | null, number][] = [
    ["Zelle", 16],
    ["TBD", 6],
    [null, 6],
    ["Direct Deposit (Client-Controlled)", 3],
    ["Direct Deposit via Quickbooks (Client-Controlled)", 1],
    ["Check", 1],
  ]

  it("reads each one as the method it describes", () => {
    expect(normalizePayMethod("Zelle")).toBe("ZELLE")
    expect(normalizePayMethod("Check")).toBe("CHECK")
    // "Client-controlled" means they push the payment from their own system.
    expect(normalizePayMethod("Direct Deposit (Client-Controlled)")).toBe("PORTAL")
    expect(normalizePayMethod("Direct Deposit via Quickbooks (Client-Controlled)")).toBe("PORTAL")
    expect(normalizePayMethod("TBD")).toBeNull()
  })

  it("reads a plain direct deposit as ACH, not as a portal", () => {
    expect(normalizePayMethod("Direct Deposit")).toBe("ACH")
    expect(normalizePayMethod("ACH")).toBe("ACH")
  })

  it("keeps our Zelle address off every invoice that is not a Zelle account", () => {
    // The four client-controlled accounts are the ones this was getting wrong:
    // they went down the default path and were told to pay by Zelle.
    for (const [value] of LIVE_VALUES) {
      const block = buildPaymentBlock({
        ...business, payMethod: value, fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES,
      })
      const printed = JSON.stringify(block)
      const shouldShowZelle = normalizePayMethod(value) === "ZELLE" || value === null
      expect(printed.includes("admin@thecleanfreaks.co")).toBe(shouldShowZelle)
    }
  })

  it("prints nothing for the client-controlled accounts", () => {
    for (const value of ["Direct Deposit (Client-Controlled)", "Direct Deposit via Quickbooks (Client-Controlled)"]) {
      const block = buildPaymentBlock({ ...business, payMethod: value, fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES })
      expect(printsNoPaymentSection(block)).toBe(true)
    }
  })

  it("does not guess a method for the six marked TBD", () => {
    // Someone recorded that this is open. The house default must not override
    // that the way it does for a field nobody has filled in.
    expect(isUndecidedPayMethod("TBD")).toBe(true)
    const block = buildPaymentBlock({ ...business, payMethod: "TBD", fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES })
    expect(block.details).toEqual([])
    // The preview printed "Pay by Zelle" under an empty details column here,
    // because the note was resolved separately with a forced method.
    expect(block.instructions ?? "").not.toContain("Zelle")
  })

  it("still falls back for the six with an empty field", () => {
    expect(isUndecidedPayMethod(null)).toBe(false)
    const block = buildPaymentBlock({ ...business, payMethod: null, fallbackMethod: "ZELLE", templates: DEFAULT_FOOTER_TEMPLATES })
    expect(block.details[0]).toMatchObject({ label: "Zelle" })
  })
})
