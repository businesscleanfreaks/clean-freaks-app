import { describe, it, expect } from "vitest"
import {
  buildDocumentRows,
  buildInvoiceDocument,
  cleanDescription,
  documentDate,
  flatRateRowDescription,
  type InvoiceDocumentInput,
} from "@/lib/invoice-document"

const base: InvoiceDocumentInput = {
  businessName: "The Clean Freaks",
  businessPhone: "(323) 746-0324",
  clientName: "Dordick Law Corporation",
  clientAddress: "1122 Wilshire Boulevard, Los Angeles, CA 90017",
  invoiceNumber: "INV-2026-131",
  issuedDate: "2026-06-25T12:00:00.000Z",
  dueDate: "2026-07-07T12:00:00.000Z",
  total: 1507.5,
  monthLabel: "June 2026",
}

const visit = (id: string, amount: number, date: string) => ({
  id, description: `Cleaning - Bad Ladder - ${date}`, amount, jobId: `job-${id}`, serviceDate: date,
})

describe("cleanDescription", () => {
  it("strips the trailing date range the builder appends", () => {
    expect(cleanDescription("Monthly Cleaning — Dordick Law — Sep 1 – Sep 30, 2026"))
      .toBe("Monthly Cleaning · Dordick Law")
  })

  it("strips a single trailing date", () => {
    expect(cleanDescription("Cleaning - Acme - Sep 3")).toBe("Cleaning - Acme")
  })

  it("leaves no em or en dashes behind", () => {
    // Josh's copy rule for the whole app.
    const out = cleanDescription("Carpet shampoo — deep clean")
    expect(out).not.toMatch(/[—–]/)
    expect(out).toBe("Carpet shampoo · deep clean")
  })

  it("leaves an ordinary description alone", () => {
    expect(cleanDescription("Carpet shampoo")).toBe("Carpet shampoo")
  })

  it("collapses stray whitespace", () => {
    expect(cleanDescription("  Window   cleaning  ")).toBe("Window cleaning")
  })
})

describe("documentDate", () => {
  it("formats the way the design writes dates", () => {
    expect(documentDate("2026-06-25T12:00:00.000Z")).toBe("Jun 25, 2026")
  })

  it("returns null rather than an Invalid Date", () => {
    expect(documentDate(null)).toBeNull()
    expect(documentDate("not a date")).toBeNull()
  })
})

describe("flatRateRowDescription", () => {
  it("names the site and its address", () => {
    expect(flatRateRowDescription({ name: "Long Beach Gym", address: "420 Grand Ave" }))
      .toBe("Monthly Cleaning Services for Long Beach Gym (420 Grand Ave)")
  })

  it("does not repeat the name as its own address", () => {
    expect(flatRateRowDescription({ name: "Long Beach Gym", address: "Long Beach Gym" }))
      .toBe("Monthly Cleaning Services for Long Beach Gym")
  })

  it("copes with no address", () => {
    expect(flatRateRowDescription({ name: "Long Beach Gym" }))
      .toBe("Monthly Cleaning Services for Long Beach Gym")
  })
})

describe("flat-rate rows", () => {
  const flat: InvoiceDocumentInput = {
    ...base,
    billingType: "FLAT_RATE",
    total: 2050,
    locations: [
      { name: "1440 23rd Street Condominiums", address: "1440 23rd St" },
      { name: "Main office", address: "12 Grand Ave" },
    ],
  }

  it("lists one row per location", () => {
    const rows = buildDocumentRows(flat)
    expect(rows).toHaveLength(2)
    expect(rows[0].description).toBe("Monthly Cleaning Services for 1440 23rd Street Condominiums (1440 23rd St)")
  })

  it("prices none of them", () => {
    // The monthly price is not split per location; the total carries it.
    for (const row of buildDocumentRows(flat)) {
      expect(row.quantity).toBeNull()
      expect(row.rate).toBeNull()
      expect(row.amount).toBeNull()
    }
  })

  it("still says what it covers with no location list", () => {
    const rows = buildDocumentRows({ ...flat, locations: [], lineItems: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toContain("Monthly Cleaning Services")
  })
})

describe("per-clean rows", () => {
  const perClean: InvoiceDocumentInput = {
    ...base,
    billingType: "PER_CLEAN",
    total: 1507.5,
    lineItems: [
      visit("1", 167.5, "2026-06-02"),
      visit("2", 167.5, "2026-06-05"),
      visit("3", 167.5, "2026-06-09"),
      visit("4", 167.5, "2026-06-12"),
      visit("5", 167.5, "2026-06-16"),
      visit("6", 167.5, "2026-06-19"),
      visit("7", 167.5, "2026-06-23"),
      visit("8", 167.5, "2026-06-26"),
      visit("9", 167.5, "2026-06-30"),
    ],
  }

  it("collapses the month's visits into one row", () => {
    // Not one row per visit: the design's example is exactly this line.
    const rows = buildDocumentRows(perClean)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      description: "Scheduled cleans",
      quantity: "9",
      rate: "$167.50",
      amount: "$1,507.50",
    })
  })

  it("keeps an add-on as its own row", () => {
    const rows = buildDocumentRows({
      ...perClean,
      lineItems: [
        ...(perClean.lineItems ?? []),
        { id: "a1", description: "Carpet shampoo — deep clean", amount: 150, addOnServiceId: "add-1" },
      ],
    })
    expect(rows).toHaveLength(2)
    expect(rows[1].description).toBe("Carpet shampoo · deep clean")
  })

  it("marks a credit so it can be coloured", () => {
    const rows = buildDocumentRows({
      ...perClean,
      lineItems: [{ id: "c1", description: "Proration credit", amount: -167.5 }],
    })
    expect(rows[0].negative).toBe(true)
  })

  it("falls back to one priced row when there are no line items", () => {
    const rows = buildDocumentRows({ ...perClean, lineItems: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe("$1,507.50")
  })
})

describe("buildInvoiceDocument", () => {
  it("builds the header the design asks for", () => {
    const doc = buildInvoiceDocument(base)
    expect(doc.wordmark).toBe("THE CLEAN FREAKS")
    expect(doc.title).toBe("INVOICE")
  })

  it("stacks invoice number, date and due date", () => {
    expect(buildInvoiceDocument(base).meta).toEqual([
      { label: "INVOICE #", value: "INV-2026-131" },
      { label: "DATE", value: "Jun 25, 2026" },
      { label: "DUE DATE", value: "Jul 7, 2026" },
    ])
  })

  it("omits a meta row rather than printing a blank one", () => {
    const doc = buildInvoiceDocument({ ...base, invoiceNumber: null, dueDate: null })
    expect(doc.meta.map(m => m.label)).toEqual(["DATE"])
  })

  it("never says Draft anywhere", () => {
    // The client is not sent a draft, so the word has no business on their copy.
    const printed = JSON.stringify(buildInvoiceDocument({ ...base, invoiceNumber: null }))
    expect(printed).not.toMatch(/draft/i)
  })

  it("shows the total above the table and again below it", () => {
    const doc = buildInvoiceDocument(base)
    expect(doc.totalDue).toBe("$1,507.50")
    expect(doc.total).toBe("$1,507.50")
    expect(doc.totalLabel).toBe("Total")
  })

  it("uses the design's four columns", () => {
    expect(buildInvoiceDocument(base).columns).toEqual({
      description: "DESCRIPTION", quantity: "QTY", rate: "RATE", amount: "AMOUNT",
    })
  })

  it("puts the thank-you left and the phone right", () => {
    expect(buildInvoiceDocument(base).footer).toEqual({
      left: "Thank you for your business",
      right: "(323) 746-0324",
    })
  })

  it("drops the phone rather than printing an empty right side", () => {
    expect(buildInvoiceDocument({ ...base, businessPhone: null }).footer.right).toBeNull()
  })
})
