import { describe, it, expect } from "vitest"
import {
  NEVER_PUBLIC_FIELDS,
  PUBLIC_INVOICE_SELECT,
  type PublicInvoice,
} from "@/lib/public-invoice"

/** Every key named anywhere in a nested Prisma select. */
function selectedKeys(node: unknown, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return found
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "select" || key === "orderBy") {
      if (key === "select") selectedKeys(value, found)
      continue
    }
    found.add(key)
    if (value && typeof value === "object") selectedKeys(value, found)
  }
  return found
}

describe("the public invoice select", () => {
  const keys = selectedKeys(PUBLIC_INVOICE_SELECT)

  it("names every field the invoice page renders", () => {
    for (const field of [
      "id", "invoiceNumber", "dateCreated", "totalAmount",
      "status", "pdfUrl", "showPaymentOptions", "name", "billingType",
      "description", "amount", "serviceDate",
    ]) {
      expect(keys.has(field)).toBe(true)
    }
  })

  it("names nothing a client must not read", () => {
    // The page used to `include` the whole record and hand it to a client
    // component, which serialises it into the page for anyone with the link:
    // the client's gate codes and alarm details, our internal account notes,
    // and what we pay the cleaner. None of it was ever displayed.
    for (const field of NEVER_PUBLIC_FIELDS) {
      expect(keys.has(field)).toBe(false)
    }
  })

  it("exposes no location record at all", () => {
    // Access codes live on Location. The invoice does not need one.
    expect(keys.has("locations")).toBe(false)
    expect(keys.has("location")).toBe(false)
  })

  it("exposes no job record at all", () => {
    // subcontractorRate is the cleaner's pay, i.e. the margin on the invoice
    // the client is holding.
    expect(keys.has("job")).toBe(false)
    expect(keys.has("subcontractorRate")).toBe(false)
  })

  it("uses select rather than include, so new columns are not published by default", () => {
    // An include grows with the schema. A select only returns what is named,
    // so adding a sensitive column cannot start leaking it silently.
    const serialised = JSON.stringify(PUBLIC_INVOICE_SELECT)
    expect(serialised).not.toContain('"include"')
  })
})

describe("the public invoice shape", () => {
  it("compiles with only the allowed fields", () => {
    // If someone widens PublicInvoice to the full record again, this stops
    // describing the real contract and the test above is what fails.
    const invoice: PublicInvoice = {
      id: "inv-1",
      invoiceNumber: "INV-2026-001",
      dateCreated: "2026-09-01T12:00:00.000Z",
      totalAmount: 290,
      status: "SENT",
      pdfUrl: null,
      showPaymentOptions: true,
      client: { name: "Design Studio VOID", billingType: "PER_CLEAN" },
      lineItems: [
        { id: "li-1", description: "Cleaning services", amount: 145, serviceDate: null, jobId: null, addOnServiceId: null },
      ],
    }
    expect(Object.keys(invoice.client)).toEqual(["name", "billingType"])
    expect(JSON.stringify(invoice)).not.toMatch(/accessInfo|subcontractorRate|scopeNotes/)
  })
})
