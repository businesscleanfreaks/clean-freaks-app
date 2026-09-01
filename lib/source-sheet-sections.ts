/**
 * Finding the sections of the source-of-truth spreadsheet.
 *
 * The sheet is one grid holding several blocks: the active recurring clients
 * first, then a labelled run of non-recurring work · past cleans, cancelled
 * accounts, trials that never closed. The blocks are separated by label rows
 * sitting in the Client column, not by anything structural.
 *
 * This used to be handled by hardcoded row numbers ("rows 2 to 31 are the
 * active clients"). That is silently wrong the moment a client is added: the
 * new row falls outside the window, the sync skips it without an error, and
 * the app is missing an account nobody knows to look for. Worse, inserting a
 * row anywhere near the top shifts every row below it and the window then
 * covers the wrong records entirely.
 *
 * So the sections are found by reading the rows instead of counting them.
 *
 * Pure: no Prisma, no filesystem.
 */

export interface SheetRow {
  /** 1-based row number as the spreadsheet shows it. Reporting only. */
  row?: number
  [column: string]: unknown
}

/**
 * Columns that mean a row describes real work.
 *
 * A label row has a Client cell and nothing else. A client row has at least
 * one of these · that difference is what separates them.
 */
const SUBSTANTIVE_COLUMNS = [
  "Cleaner Assigned",
  "Frequency",
  "Client Price",
  "Cleaner Payout",
  "Facility Address",
  "Start Date",
  "Pay Type - Client",
  "Pay Type to Cleaner",
  "Main Point of Contact",
  "Time Window",
  "Trial Date (if applicable)",
]

/**
 * Wording that marks the start of a non-active block.
 *
 * Deliberately narrow. A row is only treated as a label when it BOTH matches
 * one of these AND carries no real data · anything else is treated as a
 * client row, because misreading a client as a label would push every row
 * after it into the wrong section. An unrecognised stub row is reported by
 * the caller as a client it could not find, which is visible and harmless.
 */
const SECTION_PATTERNS = [
  /non[-\s]?recurring/i,
  /cancell?ed/i,
  /trial/i,
  /past cleans/i,
  /need(s)? to be tracked/i,
  /didn'?t close/i,
  /one[-\s]?off/i,
]

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim()

/** True when nothing in the row says it describes real work. */
function hasNoRealData(row: SheetRow): boolean {
  return SUBSTANTIVE_COLUMNS.every(column => !text(row[column]))
}

export type RowKind = "header" | "blank" | "section" | "data"

export interface ClassifiedRow<T extends SheetRow = SheetRow> {
  kind: RowKind
  row: T
  sourceRow: number | null
  /** The label text, for a section row. */
  label?: string
}

/**
 * What one row is.
 *
 * The header is recognised by the Client cell literally reading "Client",
 * which happens when an export includes the header line as data.
 */
export function classifyRow<T extends SheetRow>(row: T): ClassifiedRow<T> {
  const sourceRow = typeof row.row === "number" ? row.row : null
  const client = text(row.Client)

  if (client.toLowerCase() === "client") return { kind: "header", row, sourceRow }
  if (!client) return { kind: hasNoRealData(row) ? "blank" : "data", row, sourceRow }

  if (hasNoRealData(row)) {
    const isLabel = SECTION_PATTERNS.some(p => p.test(client)) || client.endsWith(":")
    if (isLabel) return { kind: "section", row, sourceRow, label: client }
  }

  return { kind: "data", row, sourceRow }
}

export interface SheetSections<T extends SheetRow = SheetRow> {
  /** Active recurring clients: everything before the first label row. */
  active: T[]
  /** Everything after it · past, cancelled and trial work. */
  nonRecurring: T[]
  /** The labels found, so a dry run can show where the split happened. */
  sections: { label: string; sourceRow: number | null }[]
  /** Blank and header rows, counted rather than listed. */
  skipped: number
}

/**
 * Split the sheet into its blocks.
 *
 * Rows keep their order. A blank row does not end a section · spreadsheets are
 * full of them, and treating one as a terminator would drop everything below
 * the first stray gap, which is the same class of bug as the fixed row window.
 */
export function splitSections<T extends SheetRow>(rows: T[]): SheetSections<T> {
  const active: T[] = []
  const nonRecurring: T[] = []
  const sections: SheetSections<T>["sections"] = []
  let skipped = 0
  let pastFirstLabel = false

  for (const raw of rows) {
    const classified = classifyRow(raw)

    switch (classified.kind) {
      case "header":
      case "blank":
        skipped++
        break
      case "section":
        pastFirstLabel = true
        sections.push({ label: classified.label as string, sourceRow: classified.sourceRow })
        break
      case "data":
        (pastFirstLabel ? nonRecurring : active).push(raw)
        break
    }
  }

  return { active, nonRecurring, sections, skipped }
}

/**
 * An explicit "2-31" style override, for the case where detection gets it
 * wrong and the sync still has to run.
 */
export function parseRowRange(value: string | undefined): { start: number; end: number } | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+)\s*-\s*(\d+)$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  return end >= start ? { start, end } : null
}

/** Keep only rows inside an explicit range. */
export function withinRange<T extends SheetRow>(rows: T[], range: { start: number; end: number }): T[] {
  return rows.filter(r => typeof r.row === "number" && r.row >= range.start && r.row <= range.end)
}
