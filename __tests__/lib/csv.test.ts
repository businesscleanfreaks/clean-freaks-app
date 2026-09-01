import { describe, it, expect } from "vitest"
import { parseCsv, parseCsvRows } from "@/lib/csv"

describe("parseCsvRows", () => {
  it("reads plain rows", () => {
    expect(parseCsvRows("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]])
  })

  it("keeps a comma inside a quoted field", () => {
    // Splitting on commas here would shift every later column in the row.
    expect(parseCsvRows('Date,Vendor,Amount\n8/1,"Depot, Home",50'))
      .toEqual([["Date", "Vendor", "Amount"], ["8/1", "Depot, Home", "50"]])
  })

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsvRows('a,"line one\nline two",c'))
      .toEqual([["a", "line one\nline two", "c"]])
  })

  it("reads a doubled quote as one quote", () => {
    expect(parseCsvRows('a,"He said ""hi""",c'))
      .toEqual([["a", 'He said "hi"', "c"]])
  })

  it("handles Windows line endings", () => {
    expect(parseCsvRows("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]])
  })

  it("does not invent a row from a trailing newline", () => {
    expect(parseCsvRows("a,b\n1,2\n")).toHaveLength(2)
  })

  it("keeps empty fields in place", () => {
    expect(parseCsvRows("a,,c")).toEqual([["a", "", "c"]])
  })
})

describe("parseCsv", () => {
  it("keys cells by header", () => {
    const { headers, rows } = parseCsv("Date,Amount\n8/1/2026,50")
    expect(headers).toEqual(["Date", "Amount"])
    expect(rows).toEqual([{ Date: "8/1/2026", Amount: "50" }])
  })

  it("strips the BOM Excel writes", () => {
    // Left in place, the first header becomes "﻿Date" and never matches.
    const { headers } = parseCsv("﻿Date,Amount\n8/1/2026,50")
    expect(headers[0]).toBe("Date")
  })

  it("numbers rows the way the spreadsheet does", () => {
    const { sourceRows } = parseCsv("Date,Amount\n8/1,1\n8/2,2")
    expect(sourceRows).toEqual([2, 3])
  })

  it("skips blank rows without counting them as data", () => {
    const { rows, sourceRows } = parseCsv("Date,Amount\n8/1,1\n,\n8/3,3")
    expect(rows).toHaveLength(2)
    // The surviving rows keep their true position in the sheet.
    expect(sourceRows).toEqual([2, 4])
  })

  it("fills in short rows rather than dropping columns", () => {
    const { rows } = parseCsv("Date,Amount,Vendor\n8/1,50")
    expect(rows[0]).toEqual({ Date: "8/1", Amount: "50", Vendor: "" })
  })

  it("survives an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], sourceRows: [] })
  })
})
