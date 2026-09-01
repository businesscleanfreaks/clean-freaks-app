/**
 * Reading CSV exported from a spreadsheet.
 *
 * Splitting on commas is wrong the moment a description contains one, and
 * "Depot, Home" quietly becoming two columns shifts every value after it in
 * that row. This follows RFC 4180: quoted fields may contain commas, newlines
 * and doubled quotes.
 *
 * Pure and dependency-free.
 */

/** Split CSV text into rows of raw cell strings. */
export function parseCsvRows(text: string): string[][] {
  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of
  // the first header, so "Date" would not match the header "﻿Date".
  const input = text.replace(/^﻿/, "")

  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let i = 0

  const endField = () => { row.push(field); field = "" }
  const endRow = () => { endField(); rows.push(row); row = [] }

  while (i < input.length) {
    const char = input[i]

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"') { quoted = true; i++; continue }
    if (char === ",") { endField(); i++; continue }
    if (char === "\r") { i++; continue }
    if (char === "\n") { endRow(); i++; continue }

    field += char
    i++
  }

  // A trailing newline should not produce a final empty row.
  if (field !== "" || row.length > 0) endRow()

  return rows
}

/**
 * CSV text as objects keyed by the header row.
 *
 * Returns the headers separately because callers need them to work out which
 * column is which, and because a duplicate or blank header is worth seeing.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; sourceRows: number[] } {
  const raw = parseCsvRows(text)
  if (raw.length === 0) return { headers: [], rows: [], sourceRows: [] }

  const headers = raw[0].map(h => h.trim())
  const rows: Record<string, string>[] = []
  const sourceRows: number[] = []

  raw.slice(1).forEach((cells, index) => {
    // Skip rows that are entirely empty: spreadsheets are full of them, and a
    // blank row is not a problem worth reporting.
    if (cells.every(c => c.trim() === "")) return

    const row: Record<string, string> = {}
    headers.forEach((header, column) => { row[header] = cells[column] ?? "" })
    rows.push(row)
    // 1-based, and the header is row 1, so the first data row is row 2 —
    // matching what the spreadsheet shows down its left edge.
    sourceRows.push(index + 2)
  })

  return { headers, rows, sourceRows }
}
