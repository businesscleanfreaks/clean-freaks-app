/**
 * Reading a spreadsheet of expenses into the shape the app stores.
 *
 * Pure: no Prisma, no filesystem, no clock. Every judgement this file makes is
 * a pure function of the row, which is what makes an import auditable — the
 * plan you look at in a dry run is the plan that runs.
 *
 * The rules that matter here are about NOT losing money data:
 *  - A row's identity comes from its content, never its position. Insert a
 *    line at the top of the sheet and every row below it shifts; the expense
 *    it describes has not changed.
 *  - Genuine repeats survive. Two $14 parking charges on the same day are two
 *    expenses, not one counted twice, so identity carries an occurrence number.
 *  - Anything ambiguous is REPORTED, not guessed. A row that cannot be read
 *    with confidence goes on a list for a human rather than into the books.
 */

/** The categories the app stores. Mirrors `expenseCategoryEnum` in validations. */
export const EXPENSE_CATEGORIES = [
  "RENT", "INSURANCE", "SOFTWARE_SUBSCRIPTIONS", "OFFICE_SUPPLIES",
  "UTILITIES", "PHONE_INTERNET", "PROFESSIONAL_FEES",
  "SUBCONTRACTOR_PAYMENTS", "CLEANING_SUPPLIES", "EQUIPMENT",
  "VEHICLE_FUEL", "VEHICLE_MAINTENANCE", "MARKETING_ADVERTISING",
  "TRAVEL", "MEALS_ENTERTAINMENT", "OTHER",
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export type RawRow = Record<string, unknown>

export interface ParsedExpense {
  /** Stable identity of the sheet row. See `expenseSourceKey`. */
  sourceKey: string
  sourceName: string
  /** yyyy-MM-dd. */
  date: string
  amount: number
  description: string
  category: ExpenseCategory | null
  type: "FIXED" | "VARIABLE" | null
  vendor: string | null
  notes: string | null
  /**
   * Cleaner pay is already tracked as subcontractor payments. A row that is
   * also an expense line in the sheet would be counted twice against profit,
   * so it is flagged and the expenses view filters it out.
   */
  isCleanerPay: boolean
  /** 1-based row in the source, for reporting only. Never part of identity. */
  sourceRow: number | null
}

export interface RowProblem {
  sourceRow: number | null
  reason: string
  /** What was in the row, so the report can show it without re-reading the file. */
  values: Record<string, string>
}

/* -------------------------------------------------------------------------- */
/* Column headers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Headers people actually use, lowercased. A sheet kept by hand over years
 * rarely uses one spelling throughout, and guessing wrong on the amount column
 * is worse than failing loudly.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "trans date", "day", "posted", "posted date", "when"],
  amount: ["amount", "cost", "total", "price", "debit", "spend", "paid", "charge", "value"],
  description: ["description", "desc", "memo", "details", "detail", "item", "expense", "what", "name", "notes/description"],
  vendor: ["vendor", "payee", "merchant", "paid to", "supplier", "company", "who"],
  category: ["category", "cat", "type of expense", "expense type", "bucket"],
  type: ["fixed or variable", "fixed/variable", "f/v", "cost type"],
  notes: ["notes", "note", "comment", "comments", "remarks"],
}

const lower = (value: unknown) => String(value ?? "").trim().toLowerCase()

/**
 * Match the sheet's headers to the fields we need.
 *
 * Returns the header string found for each field, or null. The caller decides
 * whether a missing field is fatal — date and amount are, the rest are not.
 */
export function detectColumns(headers: string[]): Record<string, string | null> {
  const found: Record<string, string | null> = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    found[field] =
      headers.find(h => aliases.includes(lower(h))) ??
      // Fall back to a header that merely contains the alias ("Amount (USD)").
      headers.find(h => aliases.some(a => lower(h).includes(a))) ??
      null
  }
  return found
}

/* -------------------------------------------------------------------------- */
/* Values                                                                     */
/* -------------------------------------------------------------------------- */

export interface MoneyValue {
  amount: number
  /** True when the sheet wrote it as a credit: "(45.00)" or "-45.00". */
  isCredit: boolean
}

/**
 * Money as written by a human or exported by a bank.
 *
 * Accounting parentheses and a leading minus both mean the money came back.
 * That is reported rather than silently flipped to a positive expense, which
 * would overstate spending by twice the refund.
 */
export function parseMoney(value: unknown): MoneyValue | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null

  const parenthesised = /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[()\s$,]/g, "").replace(/USD/gi, "")
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null

  const isCredit = parenthesised || parsed < 0
  return { amount: Math.abs(parsed), isCredit }
}

/**
 * Excel keeps dates as days since 1899-12-30. A five-digit number in a date
 * column is that, not a year.
 */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null
  const ms = Math.round(serial) * 86400000
  const d = new Date(Date.UTC(1899, 11, 30) + ms)
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

const isoDate = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]

/** Two-digit years: 90 means 1990, 26 means 2026. */
const expandYear = (y: number) => (y >= 100 ? y : y >= 90 ? 1900 + y : 2000 + y)

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const probe = new Date(y, m - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null
  return isoDate(y, m, d)
}

/**
 * A date as a sheet might hold it: ISO, US slashes, a written month, or an
 * Excel serial number.
 *
 * US order (month first) is assumed for ambiguous slash dates because that is
 * what the business writes. `13/04/2026` is unambiguous and read as
 * day-first; `04/13/2026` likewise as month-first.
 */
export function parseSheetDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  const raw = String(value ?? "").trim()
  if (!raw) return null

  if (/^\d+(\.\d+)?$/.test(raw)) return fromExcelSerial(Number(raw))

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (slash) {
    const a = Number(slash[1])
    const b = Number(slash[2])
    const y = expandYear(Number(slash[3]))
    // Month-first unless that is impossible.
    return a > 12 ? validDate(y, b, a) : validDate(y, a, b)
  }

  // "Aug 1, 2026", "1 Aug 2026", "August 1 2026"
  const named = raw.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim()
  const monthIndex = MONTH_NAMES.findIndex(m => named.includes(m))
  if (monthIndex >= 0) {
    const numbers = named.match(/\d+/g)?.map(Number) ?? []
    const day = numbers.find(n => n >= 1 && n <= 31)
    const year = numbers.find(n => n >= 1990 || (n >= 90 && n <= 99))
    if (day && year) return validDate(expandYear(year), monthIndex + 1, day)
  }

  return null
}

/** Collapse whitespace and case so the same text always keys the same way. */
export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Trim and collapse whitespace, keeping the sheet's own capitalisation. */
export function cleanText(value: unknown): string {
  return String(value ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim()
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The stable identity of one spreadsheet row.
 *
 * Readable rather than hashed on purpose. A hash short enough to be tidy is
 * short enough to collide, and collisions here silently merge two real
 * expenses into one. A composite string cannot collide, and when something
 * looks wrong the key itself tells you which row it came from.
 *
 * `occurrence` separates rows that are genuinely identical: two $14 parking
 * charges on the same day are two expenses. It is assigned by position among
 * the identical rows, so it is stable as long as those rows keep their order
 * relative to each other.
 */
export function expenseSourceKey(input: {
  sourceName: string
  date: string
  amount: number
  description: string
  vendor?: string | null
  occurrence: number
}): string {
  return [
    normalizeText(input.sourceName),
    input.date,
    input.amount.toFixed(2),
    normalizeText(input.description),
    normalizeText(input.vendor ?? ""),
    String(input.occurrence),
  ].join("|")
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/** Category names as a person would write them, mapped to what we store. */
const CATEGORY_SYNONYMS: Record<string, ExpenseCategory> = {
  rent: "RENT", lease: "RENT", office: "RENT",
  insurance: "INSURANCE", liability: "INSURANCE", "workers comp": "INSURANCE",
  software: "SOFTWARE_SUBSCRIPTIONS", subscription: "SOFTWARE_SUBSCRIPTIONS",
  subscriptions: "SOFTWARE_SUBSCRIPTIONS", saas: "SOFTWARE_SUBSCRIPTIONS", app: "SOFTWARE_SUBSCRIPTIONS",
  "office supplies": "OFFICE_SUPPLIES", supplies: "CLEANING_SUPPLIES",
  "cleaning supplies": "CLEANING_SUPPLIES", chemicals: "CLEANING_SUPPLIES",
  utilities: "UTILITIES", electric: "UTILITIES", water: "UTILITIES", gas_bill: "UTILITIES",
  phone: "PHONE_INTERNET", internet: "PHONE_INTERNET", mobile: "PHONE_INTERNET", cell: "PHONE_INTERNET",
  legal: "PROFESSIONAL_FEES", accounting: "PROFESSIONAL_FEES", accountant: "PROFESSIONAL_FEES",
  bookkeeping: "PROFESSIONAL_FEES", "professional fees": "PROFESSIONAL_FEES", cpa: "PROFESSIONAL_FEES",
  payroll: "SUBCONTRACTOR_PAYMENTS", cleaner: "SUBCONTRACTOR_PAYMENTS",
  "cleaner pay": "SUBCONTRACTOR_PAYMENTS", subcontractor: "SUBCONTRACTOR_PAYMENTS",
  labor: "SUBCONTRACTOR_PAYMENTS", "1099": "SUBCONTRACTOR_PAYMENTS",
  equipment: "EQUIPMENT", vacuum: "EQUIPMENT", machine: "EQUIPMENT", tools: "EQUIPMENT",
  fuel: "VEHICLE_FUEL", gas: "VEHICLE_FUEL", gasoline: "VEHICLE_FUEL", mileage: "VEHICLE_FUEL",
  "vehicle maintenance": "VEHICLE_MAINTENANCE", "car repair": "VEHICLE_MAINTENANCE",
  maintenance: "VEHICLE_MAINTENANCE", "oil change": "VEHICLE_MAINTENANCE",
  marketing: "MARKETING_ADVERTISING", advertising: "MARKETING_ADVERTISING",
  ads: "MARKETING_ADVERTISING", seo: "MARKETING_ADVERTISING", website: "MARKETING_ADVERTISING",
  travel: "TRAVEL", flight: "TRAVEL", hotel: "TRAVEL", parking: "TRAVEL",
  meals: "MEALS_ENTERTAINMENT", food: "MEALS_ENTERTAINMENT", lunch: "MEALS_ENTERTAINMENT",
  entertainment: "MEALS_ENTERTAINMENT", coffee: "MEALS_ENTERTAINMENT",
  other: "OTHER", misc: "OTHER", miscellaneous: "OTHER",
}

/**
 * The category the sheet asked for, if it can be recognised.
 *
 * Only reads the sheet's own category column. It does NOT try to infer a
 * category from a vendor name: "Amazon" is office supplies one week and
 * cleaning supplies the next, and a wrong category is harder to spot than a
 * blank one. Uncategorised is a valid, visible state in the app.
 */
export function parseCategory(value: unknown): ExpenseCategory | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const upper = raw.toUpperCase().replace(/[^A-Z]+/g, "_")
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(upper)) return upper as ExpenseCategory

  if (CATEGORY_SYNONYMS[raw]) return CATEGORY_SYNONYMS[raw]

  // Longest synonym first, so "cleaning supplies" wins over "supplies".
  const hit = Object.keys(CATEGORY_SYNONYMS)
    .sort((a, b) => b.length - a.length)
    .find(key => raw.includes(key))
  return hit ? CATEGORY_SYNONYMS[hit] : null
}

export function parseType(value: unknown): "FIXED" | "VARIABLE" | null {
  const raw = normalizeText(value)
  if (!raw) return null
  if (raw.startsWith("f")) return "FIXED"
  if (raw.startsWith("v")) return "VARIABLE"
  return null
}

/**
 * Whether this row is cleaner pay, which the app already tracks as
 * subcontractor payments.
 *
 * Importing it as a plain expense as well would count the same money twice
 * against profit. Matching is on the category and on known cleaner names,
 * supplied by the caller rather than looked up here.
 */
export function looksLikeCleanerPay(
  fields: { category: ExpenseCategory | null; description: string; vendor: string | null },
  cleanerNames: string[],
): boolean {
  if (fields.category === "SUBCONTRACTOR_PAYMENTS") return true

  const haystack = `${normalizeText(fields.description)} ${normalizeText(fields.vendor)}`
  return cleanerNames.some(name => {
    const n = normalizeText(name)
    // Require a real name, not an initial, before matching on it.
    return n.length >= 4 && haystack.includes(n)
  })
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

export interface ParseOptions {
  /** Names the sheet is known by, e.g. "2026 expenses". Part of every key. */
  sourceName: string
  columns: Record<string, string | null>
  /** Active cleaner names, for the double-counting check. */
  cleanerNames?: string[]
  /**
   * Import refunds as negative amounts. Off by default: the app's own expense
   * form rejects amounts at or below zero, so an imported credit would be a
   * row nobody can edit.
   */
  allowCredits?: boolean
}

type RowResult =
  | { ok: true; expense: Omit<ParsedExpense, "sourceKey"> }
  | { ok: false; problem: RowProblem }

/** A row's readable values, for the problem report. */
function valuesOf(row: RawRow, columns: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [field, header] of Object.entries(columns)) {
    if (header && row[header] != null && String(row[header]).trim()) {
      out[field] = cleanText(row[header])
    }
  }
  return out
}

/**
 * One sheet row as an expense, or a stated reason it could not be read.
 *
 * Everything that cannot be established with confidence becomes a problem for
 * a person to look at. Money that lands in the books by guesswork is worse
 * than money that never lands at all, because nobody goes looking for it.
 */
export function parseExpenseRow(row: RawRow, sourceRow: number | null, options: ParseOptions): RowResult {
  const { columns } = options
  const values = valuesOf(row, columns)
  const problem = (reason: string): RowResult => ({ ok: false, problem: { sourceRow, reason, values } })

  const dateCell = columns.date ? row[columns.date] : null
  const date = parseSheetDate(dateCell)
  if (!date) {
    return problem(
      cleanText(dateCell) ? `date not understood: "${cleanText(dateCell)}"` : "no date",
    )
  }

  const money = parseMoney(columns.amount ? row[columns.amount] : null)
  if (!money) {
    const cell = cleanText(columns.amount ? row[columns.amount] : "")
    return problem(cell ? `amount not understood: "${cell}"` : "no amount")
  }
  if (money.amount === 0) return problem("amount is zero")
  if (money.isCredit && !options.allowCredits) {
    return problem(`credit or refund of ${money.amount.toFixed(2)} · needs a decision`)
  }

  const description = cleanText(columns.description ? row[columns.description] : "")
  const vendor = cleanText(columns.vendor ? row[columns.vendor] : "") || null
  if (!description && !vendor) return problem("no description or vendor")

  const category = parseCategory(columns.category ? row[columns.category] : null)

  return {
    ok: true,
    expense: {
      sourceName: options.sourceName,
      date,
      amount: money.isCredit ? -money.amount : money.amount,
      // Falling back to the vendor keeps the row identifiable on screen; the
      // app requires a description and an empty one would fail validation.
      description: description || (vendor as string),
      category,
      type: parseType(columns.type ? row[columns.type] : null),
      vendor,
      notes: cleanText(columns.notes ? row[columns.notes] : "") || null,
      isCleanerPay: looksLikeCleanerPay(
        { category, description, vendor },
        options.cleanerNames ?? [],
      ),
      sourceRow,
    },
  }
}

export interface SheetResult {
  expenses: ParsedExpense[]
  problems: RowProblem[]
}

/**
 * A whole sheet.
 *
 * Rows keep their order, which is what makes occurrence numbering stable:
 * identical rows are numbered by the order they appear, so re-importing an
 * unchanged sheet produces exactly the same keys.
 *
 * `isRecurring` is deliberately never set here. In the app a recurring expense
 * means a standing monthly cost that applies to every month from its date
 * onward — so a sheet listing the same subscription once per month would, if
 * imported as recurring, charge it once per month PER ROW. Imported rows are
 * the ledger of what was actually spent; Josh marks the standing ones himself.
 */
export function parseExpenseSheet(
  rows: RawRow[],
  sourceRows: (number | null)[],
  options: ParseOptions,
): SheetResult {
  const expenses: ParsedExpense[] = []
  const problems: RowProblem[] = []
  const seen = new Map<string, number>()

  rows.forEach((row, index) => {
    const result = parseExpenseRow(row, sourceRows[index] ?? null, options)
    if (!result.ok) {
      problems.push(result.problem)
      return
    }

    const base = {
      sourceName: result.expense.sourceName,
      date: result.expense.date,
      amount: Math.abs(result.expense.amount),
      description: result.expense.description,
      vendor: result.expense.vendor,
    }
    const identity = expenseSourceKey({ ...base, occurrence: 0 })
    const occurrence = (seen.get(identity) ?? 0) + 1
    seen.set(identity, occurrence)

    expenses.push({
      ...result.expense,
      sourceKey: expenseSourceKey({ ...base, occurrence }),
    })
  })

  return { expenses, problems }
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** An expense already in the database that came from an import. */
export interface ExistingExpense {
  id: string
  sourceKey: string
  date: string
  amount: number
  description: string
  category: string | null
  vendor: string | null
}

export interface ImportPlan {
  create: ParsedExpense[]
  /** Rows whose sheet values no longer match what is stored. */
  changed: { existing: ExistingExpense; incoming: ParsedExpense; fields: string[] }[]
  unchanged: number
  /**
   * Imported expenses whose row is no longer in the sheet. Reported, never
   * deleted: the row may have been moved to another tab, and money that
   * vanishes from the books without a decision is the worst outcome here.
   */
  missingFromSheet: ExistingExpense[]
  problems: RowProblem[]
  totals: { sheet: number; toCreate: number; existing: number }
}

/**
 * What an import would do, without doing any of it.
 *
 * This is the whole point of the dry run: the numbers below are the numbers
 * that will be written, so they can be checked against the sheet's own total
 * before anything touches the database.
 */
export function planExpenseImport(
  parsed: SheetResult,
  existing: ExistingExpense[],
): ImportPlan {
  const byKey = new Map(existing.map(e => [e.sourceKey, e]))
  const create: ParsedExpense[] = []
  const changed: ImportPlan["changed"] = []
  const seenKeys = new Set<string>()
  let unchanged = 0

  for (const incoming of parsed.expenses) {
    seenKeys.add(incoming.sourceKey)
    const match = byKey.get(incoming.sourceKey)
    if (!match) {
      create.push(incoming)
      continue
    }

    const fields: string[] = []
    // The key is built from date, amount, description and vendor, so a change
    // to any of those makes a NEW key rather than showing up here. What can
    // differ is the categorisation, which the key deliberately ignores.
    if ((match.category ?? null) !== (incoming.category ?? null)) fields.push("category")
    if (fields.length) changed.push({ existing: match, incoming, fields })
    else unchanged++
  }

  return {
    create,
    changed,
    unchanged,
    missingFromSheet: existing.filter(e => !seenKeys.has(e.sourceKey)),
    problems: parsed.problems,
    totals: {
      sheet: round(parsed.expenses.reduce((sum, e) => sum + e.amount, 0)),
      toCreate: round(create.reduce((sum, e) => sum + e.amount, 0)),
      existing: round(existing.reduce((sum, e) => sum + e.amount, 0)),
    },
  }
}

const round = (n: number) => Math.round(n * 100) / 100
