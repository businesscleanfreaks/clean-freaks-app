import { describe, it, expect } from "vitest"
import {
  classifyRow,
  parseRowRange,
  splitSections,
  withinRange,
  type SheetRow,
} from "@/lib/source-sheet-sections"

/** A client row as the sheet holds one. */
const client = (name: string, row: number, over: Partial<SheetRow> = {}): SheetRow => ({
  row,
  Client: name,
  "Cleaner Assigned": "Maggie",
  Frequency: "Weekly",
  "Client Price": "$1,000",
  ...over,
})

/** A label row: text in the Client column and nothing else. */
const label = (text: string, row: number): SheetRow => ({ row, Client: text })

const blank = (row: number): SheetRow => ({ row, Client: "" })

describe("classifyRow", () => {
  it("recognises a client row", () => {
    expect(classifyRow(client("Dordick Law", 2)).kind).toBe("data")
  })

  it("recognises the section labels this sheet uses", () => {
    expect(classifyRow(label("Non-Recurring", 33)).kind).toBe("section")
    expect(classifyRow(label("Canceled: past cleans that need to be tracked", 40)).kind).toBe("section")
    expect(classifyRow(label("Trial, didn't close them:", 44)).kind).toBe("section")
  })

  it("recognises anything ending in a colon as a label", () => {
    expect(classifyRow(label("Some new section:", 50)).kind).toBe("section")
  })

  it("recognises a header row left in the export", () => {
    expect(classifyRow({ row: 1, Client: "Client" }).kind).toBe("header")
  })

  it("recognises a blank row", () => {
    expect(classifyRow(blank(32)).kind).toBe("blank")
  })

  it("treats a client whose name matches a label word as a client, not a label", () => {
    // "Trial Attorneys LLC" has real data, so it is a client despite the word.
    expect(classifyRow(client("Trial Attorneys LLC", 12)).kind).toBe("data")
  })

  it("treats an unrecognised bare name as a client, not a label", () => {
    // Misreading a client as a label would push every row after it into the
    // wrong section. An unmatched client is reported by the caller instead.
    expect(classifyRow({ row: 20, Client: "Some New Client" }).kind).toBe("data")
  })

  it("needs only one substantive column to count as real work", () => {
    expect(classifyRow({ row: 20, Client: "Stub", "Facility Address": "1 Main St" }).kind).toBe("data")
  })
})

describe("splitSections", () => {
  /** The sheet's shape: clients, a gap, the label, then the past work. */
  const sheet: SheetRow[] = [
    { row: 1, Client: "Client" },
    client("Dordick Law", 2),
    client("PINOK STUDIO", 3),
    client("OG Slimes", 4),
    blank(5),
    label("Non-Recurring", 6),
    client("Old Gym", 7),
    label("Trial, didn't close them:", 8),
    client("Never Closed Co", 9),
  ]

  it("splits on the label rather than on a row number", () => {
    const result = splitSections(sheet)
    expect(result.active.map(r => r.Client)).toEqual(["Dordick Law", "PINOK STUDIO", "OG Slimes"])
    expect(result.nonRecurring.map(r => r.Client)).toEqual(["Old Gym", "Never Closed Co"])
  })

  it("reports where it split, so a dry run can be checked", () => {
    const result = splitSections(sheet)
    expect(result.sections).toEqual([
      { label: "Non-Recurring", sourceRow: 6 },
      { label: "Trial, didn't close them:", sourceRow: 8 },
    ])
  })

  it("counts the header and blank rows rather than importing them", () => {
    expect(splitSections(sheet).skipped).toBe(2)
  })

  it("picks up clients added past the old row-31 window", () => {
    // The bug this replaces: rows below the hardcoded window were skipped
    // silently, with no error and nothing on screen to notice.
    const grown = [
      ...Array.from({ length: 40 }, (_, i) => client(`Client ${i + 1}`, i + 2)),
      label("Non-Recurring", 42),
      client("Old Gym", 43),
    ]
    const result = splitSections(grown)
    expect(result.active).toHaveLength(40)
    expect(result.active.at(-1)?.Client).toBe("Client 40")
    expect(result.nonRecurring).toHaveLength(1)
  })

  it("survives a blank row in the middle of the client block", () => {
    // A stray gap must not terminate the section the way a row window would.
    const gapped = [client("A", 2), blank(3), client("B", 4), label("Non-Recurring", 5), client("C", 6)]
    const result = splitSections(gapped)
    expect(result.active.map(r => r.Client)).toEqual(["A", "B"])
    expect(result.nonRecurring.map(r => r.Client)).toEqual(["C"])
  })

  it("is unaffected by rows shifting position", () => {
    const shifted: SheetRow[] = sheet.map(r => ({ ...r, row: (r.row as number) + 25 }))
    expect(splitSections(shifted).active.map(r => r.Client))
      .toEqual(splitSections(sheet).active.map(r => r.Client))
  })

  it("treats a sheet with no labels as all active", () => {
    const result = splitSections([client("A", 2), client("B", 3)])
    expect(result.active).toHaveLength(2)
    expect(result.nonRecurring).toHaveLength(0)
  })

  it("handles an empty sheet without inventing rows", () => {
    expect(splitSections([])).toEqual({ active: [], nonRecurring: [], sections: [], skipped: 0 })
  })
})

describe("parseRowRange", () => {
  it("reads the override", () => {
    expect(parseRowRange("2-31")).toEqual({ start: 2, end: 31 })
    expect(parseRowRange(" 34 - 46 ")).toEqual({ start: 34, end: 46 })
  })

  it("rejects nonsense rather than half-applying it", () => {
    expect(parseRowRange("31-2")).toBeNull()
    expect(parseRowRange("rows 2 to 31")).toBeNull()
    expect(parseRowRange(undefined)).toBeNull()
  })
})

describe("withinRange", () => {
  it("keeps only the rows inside the window", () => {
    const rows = [client("A", 2), client("B", 31), client("C", 32)]
    expect(withinRange(rows, { start: 2, end: 31 }).map(r => r.Client)).toEqual(["A", "B"])
  })
})
