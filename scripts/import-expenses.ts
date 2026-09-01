/**
 * Import expenses from a spreadsheet export.
 *
 *   npx tsx scripts/import-expenses.ts expenses.csv                 # dry run
 *   npx tsx scripts/import-expenses.ts expenses.csv --apply         # write
 *   npx tsx scripts/import-expenses.ts expenses.csv --name "2026"   # label
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply, so the plan can be
 * checked against the sheet's own total before any money reaches the books.
 *
 * Re-runnable: every imported row carries a `sourceKey` derived from its
 * content, so importing the same sheet twice adds nothing the second time.
 * See lib/expense-import.ts for how identity is decided.
 *
 * Options:
 *   --apply            write to the database
 *   --name <label>     what to call this sheet (default: the file name)
 *   --year 2026        import only that calendar year
 *   --from / --to      an explicit yyyy-MM-dd window instead of --year
 *   --update-changed   also apply category changes to rows already imported
 *   --allow-credits    import refunds as negative amounts
 *   --json             machine-readable output instead of the report
 */

import fs from "fs"
import path from "path"
import { PrismaClient } from "@prisma/client"
import { parseCsv } from "../lib/csv"
import {
  detectColumns,
  parseExpenseSheet,
  planExpenseImport,
  type ExistingExpense,
  type ImportPlan,
  type RawRow,
} from "../lib/expense-import"

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const valueOf = (flag: string) => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}

const APPLY = has("--apply")
const UPDATE_CHANGED = has("--update-changed")
const ALLOW_CREDITS = has("--allow-credits")
const AS_JSON = has("--json")

const filePath = args.find(a => !a.startsWith("--") && /\.(csv|json)$/i.test(a))

/**
 * Josh, 2026-09-01: import this year only. A window is applied rather than the
 * sheet being trimmed, so the same file can be re-run for a wider range later
 * without re-importing what is already in.
 */
const YEAR = valueOf("--year")
const FROM = valueOf("--from") ?? (YEAR ? `${YEAR}-01-01` : undefined)
const TO = valueOf("--to") ?? (YEAR ? `${YEAR}-12-31` : undefined)

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" })

/** Read the file into rows plus the row numbers the spreadsheet shows. */
function readSource(file: string): { headers: string[]; rows: RawRow[]; sourceRows: number[] } {
  const text = fs.readFileSync(file, "utf8")

  if (file.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text.replace(/^﻿/, "")) as RawRow[]
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of rows")
    const headers = Array.from(new Set(parsed.flatMap(r => Object.keys(r))))
    return {
      headers,
      rows: parsed,
      // Honour an explicit row number if the export carries one.
      sourceRows: parsed.map((r, i) => Number(r.row ?? r.Row ?? i + 2)),
    }
  }

  const csv = parseCsv(text)
  return { headers: csv.headers, rows: csv.rows, sourceRows: csv.sourceRows }
}

function report(plan: ImportPlan, sourceName: string, columns: Record<string, string | null>) {
  const line = (s = "") => console.log(s)

  line()
  line(`${APPLY ? "APPLYING" : "DRY RUN"} · ${sourceName}`)
  if (FROM || TO) line(`Date window: ${FROM ?? "anything"} to ${TO ?? "anything"}`)
  line("=".repeat(60))

  line()
  line("Columns found:")
  for (const [field, header] of Object.entries(columns)) {
    line(`  ${field.padEnd(12)} ${header ?? "— not found —"}`)
  }

  line()
  line(`Rows read from the sheet   ${plan.create.length + plan.changed.length + plan.unchanged}`)
  line(`  new, will be added       ${plan.create.length}   ${money(plan.totals.toCreate)}`)
  line(`  already imported         ${plan.unchanged}`)
  line(`  recategorised in sheet   ${plan.changed.length}`)
  line(`  could not be read        ${plan.problems.length}`)
  line()
  line(`Sheet total (in the window)  ${money(plan.totals.sheet)}`)
  if (plan.outsideRange.count) {
    line(`Outside the date window      ${money(plan.outsideRange.total)}  (${plan.outsideRange.count} rows)`)
    // The two add up to the sheet's own total, which is how you check the
    // import read the whole file rather than stopping partway.
    line(`  the two together           ${money(plan.totals.sheet + plan.outsideRange.total)}`)
  }
  line(`Already in the app           ${money(plan.totals.existing)}`)

  if (plan.problems.length) {
    line()
    line(`ROWS NEEDING A LOOK (${plan.problems.length}) · none of these were imported`)
    line("-".repeat(60))
    for (const p of plan.problems.slice(0, 40)) {
      const detail = Object.entries(p.values).map(([k, v]) => `${k}=${v}`).join("  ")
      line(`  row ${String(p.sourceRow ?? "?").padStart(4)}  ${p.reason}`)
      if (detail) line(`            ${detail}`)
    }
    if (plan.problems.length > 40) line(`  … and ${plan.problems.length - 40} more`)
  }

  if (plan.changed.length) {
    line()
    line(`RECATEGORISED IN THE SHEET (${plan.changed.length})`)
    line("-".repeat(60))
    for (const c of plan.changed.slice(0, 20)) {
      line(`  ${c.existing.date}  ${c.existing.description}`)
      line(`            ${c.existing.category ?? "—"} → ${c.incoming.category ?? "—"}`)
    }
    if (!UPDATE_CHANGED) line("  (pass --update-changed to apply these)")
  }

  if (plan.missingFromSheet.length) {
    line()
    line(`IN THE APP BUT NOT IN THIS SHEET (${plan.missingFromSheet.length})`)
    line("-".repeat(60))
    line("  Nothing is deleted. These may live on another tab, or the row may")
    line("  have been edited in the sheet since it was imported.")
    for (const e of plan.missingFromSheet.slice(0, 20)) {
      line(`  ${e.date}  ${money(e.amount).padStart(12)}  ${e.description}`)
    }
    if (plan.missingFromSheet.length > 20) line(`  … and ${plan.missingFromSheet.length - 20} more`)
  }

  const cleanerPay = plan.create.filter(e => e.isCleanerPay)
  if (cleanerPay.length) {
    line()
    line(`CLEANER PAY (${cleanerPay.length}) · ${money(cleanerPay.reduce((s, e) => s + e.amount, 0))}`)
    line("-".repeat(60))
    line("  Flagged as cleaner pay and kept out of the expenses view, because")
    line("  the app already counts this money as subcontractor payments.")
    line("  Counting it twice would understate profit.")
  }

  const uncategorised = plan.create.filter(e => !e.category).length
  if (uncategorised) {
    line()
    line(`${uncategorised} of the new rows have no category and will import as uncategorised.`)
  }

  line()
  if (!APPLY) {
    line("Nothing was written. Re-run with --apply to import.")
  }
  line()
}

async function main() {
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-expenses.ts <file.csv|file.json> [--apply]")
    process.exit(1)
  }
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)

  const sourceName = valueOf("--name") ?? path.basename(filePath).replace(/\.[^.]+$/, "")
  const { headers, rows, sourceRows } = readSource(filePath)
  const columns = detectColumns(headers)

  if (!columns.date || !columns.amount) {
    console.error(`\nCould not find the ${!columns.date ? "date" : "amount"} column.`)
    console.error(`Headers in the file: ${headers.join(", ")}`)
    console.error("\nRename the column in the sheet, or add its name to COLUMN_ALIASES")
    console.error("in lib/expense-import.ts.")
    process.exit(1)
  }

  // Supplied rather than looked up inside the parser so the rules stay pure.
  const cleanerNames = (await prisma.subcontractor.findMany({ select: { name: true } })).map(c => c.name)

  const parsed = parseExpenseSheet(rows, sourceRows, {
    sourceName,
    columns,
    cleanerNames,
    allowCredits: ALLOW_CREDITS,
    from: FROM,
    to: TO,
  })

  const existingRows = await prisma.expense.findMany({
    where: { sourceName },
    select: { id: true, sourceKey: true, date: true, amount: true, description: true, category: true, vendor: true },
  })
  const existing: ExistingExpense[] = existingRows
    .filter((e): e is typeof e & { sourceKey: string } => !!e.sourceKey)
    .map(e => ({
      id: e.id,
      sourceKey: e.sourceKey,
      date: e.date.toISOString().slice(0, 10),
      amount: e.amount,
      description: e.description,
      category: e.category,
      vendor: e.vendor,
    }))

  const plan = planExpenseImport(parsed, existing)

  if (AS_JSON) {
    console.log(JSON.stringify({ mode: APPLY ? "applied" : "dry-run", sourceName, columns, plan }, null, 2))
  } else {
    report(plan, sourceName, columns)
  }

  if (!APPLY) return

  let created = 0
  for (const expense of plan.create) {
    await prisma.expense.create({
      data: {
        // Stored at midday so a timezone shift cannot move it to the day
        // before, which would put an expense in the wrong month at a boundary.
        date: new Date(`${expense.date}T12:00:00`),
        amount: expense.amount,
        description: expense.description.slice(0, 500),
        category: expense.category,
        type: expense.type,
        vendor: expense.vendor?.slice(0, 200) ?? null,
        notes: expense.notes?.slice(0, 2000) ?? null,
        isRecurring: false,
        isCleanerPay: expense.isCleanerPay,
        sourceKey: expense.sourceKey,
        sourceName: expense.sourceName,
      },
    })
    created++
  }

  let updated = 0
  if (UPDATE_CHANGED) {
    for (const change of plan.changed) {
      await prisma.expense.update({
        where: { id: change.existing.id },
        data: { category: change.incoming.category },
      })
      updated++
    }
  }

  console.log(`Imported ${created} expense${created === 1 ? "" : "s"}${updated ? `, updated ${updated}` : ""}.`)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
