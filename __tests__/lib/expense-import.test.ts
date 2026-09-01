import { describe, it, expect } from "vitest"
import {
  detectColumns,
  expenseSourceKey,
  looksLikeCleanerPay,
  parseCategory,
  parseExpenseRow,
  parseExpenseSheet,
  parseMoney,
  parseSheetDate,
  parseType,
  planExpenseImport,
  type ExistingExpense,
  type ParseOptions,
} from "@/lib/expense-import"

const columns = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  vendor: "Vendor",
  category: "Category",
  type: null,
  notes: null,
}

const opts = (over: Partial<ParseOptions> = {}): ParseOptions => ({
  sourceName: "2026 expenses",
  columns,
  ...over,
})

describe("parseMoney", () => {
  it("reads money as people write it", () => {
    expect(parseMoney("$1,234.56")).toEqual({ amount: 1234.56, isCredit: false })
    expect(parseMoney("45")).toEqual({ amount: 45, isCredit: false })
    expect(parseMoney(" 99.99 USD ")).toEqual({ amount: 99.99, isCredit: false })
    expect(parseMoney(120)).toEqual({ amount: 120, isCredit: false })
  })

  it("treats parentheses and minus as a credit, not a spend", () => {
    // Flipping a refund to a positive expense overstates spending by twice it.
    expect(parseMoney("(45.00)")).toEqual({ amount: 45, isCredit: true })
    expect(parseMoney("-45.00")).toEqual({ amount: 45, isCredit: true })
  })

  it("refuses what it cannot read rather than guessing zero", () => {
    expect(parseMoney("")).toBeNull()
    expect(parseMoney("n/a")).toBeNull()
    expect(parseMoney("about $50")).toBeNull()
    expect(parseMoney(null)).toBeNull()
  })
})

describe("parseSheetDate", () => {
  it("reads the formats a sheet actually holds", () => {
    expect(parseSheetDate("2026-08-01")).toBe("2026-08-01")
    expect(parseSheetDate("8/1/2026")).toBe("2026-08-01")
    expect(parseSheetDate("08/01/26")).toBe("2026-08-01")
    expect(parseSheetDate("Aug 1, 2026")).toBe("2026-08-01")
    expect(parseSheetDate("1 August 2026")).toBe("2026-08-01")
    expect(parseSheetDate(new Date(2026, 7, 1))).toBe("2026-08-01")
  })

  it("reads an Excel serial number as a date, not a year", () => {
    // 46235 days from 1899-12-30.
    expect(parseSheetDate("46235")).toBe("2026-08-01")
  })

  it("falls back to day-first only when month-first is impossible", () => {
    expect(parseSheetDate("13/04/2026")).toBe("2026-04-13")
    expect(parseSheetDate("04/13/2026")).toBe("2026-04-13")
  })

  it("rejects dates that do not exist", () => {
    expect(parseSheetDate("2026-02-31")).toBeNull()
    expect(parseSheetDate("13/13/2026")).toBeNull()
    expect(parseSheetDate("sometime in May")).toBeNull()
    expect(parseSheetDate("")).toBeNull()
  })
})

describe("detectColumns", () => {
  it("finds the headers under their common names", () => {
    const found = detectColumns(["Transaction Date", "Payee", "Debit", "Memo"])
    expect(found.date).toBe("Transaction Date")
    expect(found.vendor).toBe("Payee")
    expect(found.amount).toBe("Debit")
    expect(found.description).toBe("Memo")
  })

  it("matches a header that carries extra wording", () => {
    expect(detectColumns(["Amount (USD)"]).amount).toBe("Amount (USD)")
  })

  it("reports a missing column rather than picking the wrong one", () => {
    expect(detectColumns(["Date", "Description"]).amount).toBeNull()
  })
})

describe("parseCategory", () => {
  it("takes the stored names as they are", () => {
    expect(parseCategory("CLEANING_SUPPLIES")).toBe("CLEANING_SUPPLIES")
    expect(parseCategory("cleaning supplies")).toBe("CLEANING_SUPPLIES")
  })

  it("understands how a person writes them", () => {
    expect(parseCategory("Software")).toBe("SOFTWARE_SUBSCRIPTIONS")
    expect(parseCategory("Gas")).toBe("VEHICLE_FUEL")
    expect(parseCategory("Accountant")).toBe("PROFESSIONAL_FEES")
  })

  it("prefers the more specific name", () => {
    // "cleaning supplies" contains "supplies"; the longer match must win.
    expect(parseCategory("Cleaning Supplies - Q3")).toBe("CLEANING_SUPPLIES")
  })

  it("leaves it blank when it does not know", () => {
    expect(parseCategory("zzz")).toBeNull()
    expect(parseCategory("")).toBeNull()
  })
})

describe("parseType", () => {
  it("reads fixed and variable", () => {
    expect(parseType("Fixed")).toBe("FIXED")
    expect(parseType("v")).toBe("VARIABLE")
    expect(parseType("")).toBeNull()
  })
})

describe("looksLikeCleanerPay", () => {
  it("catches the category", () => {
    expect(looksLikeCleanerPay(
      { category: "SUBCONTRACTOR_PAYMENTS", description: "August", vendor: null }, [],
    )).toBe(true)
  })

  it("catches a cleaner named in the row", () => {
    expect(looksLikeCleanerPay(
      { category: null, description: "Payment to Maggie Quevedo", vendor: null },
      ["Maggie Quevedo", "Ana Lina"],
    )).toBe(true)
  })

  it("does not match on something too short to be a name", () => {
    expect(looksLikeCleanerPay(
      { category: null, description: "Cab fare", vendor: null }, ["Ana"],
    )).toBe(false)
  })

  it("leaves ordinary expenses alone", () => {
    expect(looksLikeCleanerPay(
      { category: "CLEANING_SUPPLIES", description: "Mops", vendor: "Home Depot" },
      ["Maggie Quevedo"],
    )).toBe(false)
  })
})

describe("parseExpenseRow", () => {
  const row = {
    Date: "8/1/2026", Amount: "$120.50",
    Description: "Vacuum bags", Vendor: "Home Depot", Category: "Cleaning supplies",
  }

  it("reads a good row", () => {
    const result = parseExpenseRow(row, 4, opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.expense).toMatchObject({
      date: "2026-08-01",
      amount: 120.5,
      description: "Vacuum bags",
      vendor: "Home Depot",
      category: "CLEANING_SUPPLIES",
      isCleanerPay: false,
      sourceRow: 4,
    })
  })

  it("says why a row could not be read", () => {
    const bad = parseExpenseRow({ ...row, Date: "whenever" }, 4, opts())
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.problem.reason).toContain("date not understood")
    // The report carries the row's values so it can be shown without the file.
    expect(bad.problem.values.description).toBe("Vacuum bags")
  })

  it("reports a credit instead of booking it as spending", () => {
    const credit = parseExpenseRow({ ...row, Amount: "(30.00)" }, 4, opts())
    expect(credit.ok).toBe(false)
    if (credit.ok) return
    expect(credit.problem.reason).toContain("credit or refund")
  })

  it("imports a credit as negative when asked", () => {
    const credit = parseExpenseRow({ ...row, Amount: "(30.00)" }, 4, opts({ allowCredits: true }))
    expect(credit.ok).toBe(true)
    if (!credit.ok) return
    expect(credit.expense.amount).toBe(-30)
  })

  it("rejects a zero", () => {
    const zero = parseExpenseRow({ ...row, Amount: "0" }, 4, opts())
    expect(zero.ok).toBe(false)
  })

  it("falls back to the vendor when there is no description", () => {
    const result = parseExpenseRow({ ...row, Description: "" }, 4, opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The app requires a description; an empty one would fail validation.
    expect(result.expense.description).toBe("Home Depot")
  })

  it("refuses a row with neither a description nor a vendor", () => {
    const result = parseExpenseRow({ ...row, Description: "", Vendor: "" }, 4, opts())
    expect(result.ok).toBe(false)
  })
})

describe("expenseSourceKey", () => {
  const base = {
    sourceName: "2026 expenses", date: "2026-08-01", amount: 120.5,
    description: "Vacuum bags", vendor: "Home Depot", occurrence: 1,
  }

  it("is stable across capitalisation and spacing", () => {
    expect(expenseSourceKey(base)).toBe(
      expenseSourceKey({ ...base, description: "  VACUUM   Bags " }),
    )
  })

  it("separates genuinely repeated rows", () => {
    expect(expenseSourceKey(base)).not.toBe(expenseSourceKey({ ...base, occurrence: 2 }))
  })

  it("changes when the money changes", () => {
    expect(expenseSourceKey(base)).not.toBe(expenseSourceKey({ ...base, amount: 120.51 }))
  })
})

describe("parseExpenseSheet", () => {
  const rows = [
    { Date: "8/1/2026", Amount: "14.00", Description: "Parking", Vendor: "", Category: "Travel" },
    { Date: "8/1/2026", Amount: "14.00", Description: "Parking", Vendor: "", Category: "Travel" },
    { Date: "8/2/2026", Amount: "oops", Description: "Mystery", Vendor: "", Category: "" },
  ]

  it("keeps two identical rows as two expenses", () => {
    const { expenses } = parseExpenseSheet(rows, [2, 3, 4], opts())
    expect(expenses).toHaveLength(2)
    expect(expenses[0].sourceKey).not.toBe(expenses[1].sourceKey)
    expect(expenses.reduce((s, e) => s + e.amount, 0)).toBe(28)
  })

  it("produces the same keys when the same sheet is read again", () => {
    const first = parseExpenseSheet(rows, [2, 3, 4], opts())
    const again = parseExpenseSheet(rows, [2, 3, 4], opts())
    expect(again.expenses.map(e => e.sourceKey)).toEqual(first.expenses.map(e => e.sourceKey))
  })

  it("keeps keys stable when rows shift position in the sheet", () => {
    const first = parseExpenseSheet(rows, [2, 3, 4], opts())
    // Someone inserts a line at the top; every row number below it moves.
    const shifted = parseExpenseSheet(rows, [9, 10, 11], opts())
    expect(shifted.expenses.map(e => e.sourceKey)).toEqual(first.expenses.map(e => e.sourceKey))
  })

  it("sets aside the rows it could not read", () => {
    const { problems } = parseExpenseSheet(rows, [2, 3, 4], opts())
    expect(problems).toHaveLength(1)
    expect(problems[0].sourceRow).toBe(4)
  })

  it("never marks an imported row as recurring", () => {
    // A recurring expense applies to EVERY month from its date onward, so a
    // sheet listing a subscription monthly would multiply if imported that way.
    const { expenses } = parseExpenseSheet(rows, [2, 3, 4], opts())
    expect(expenses.every(e => !("isRecurring" in e))).toBe(true)
  })
})

describe("planExpenseImport", () => {
  const sheet = parseExpenseSheet(
    [
      { Date: "8/1/2026", Amount: "100", Description: "Mops", Vendor: "Depot", Category: "Cleaning supplies" },
      { Date: "8/2/2026", Amount: "50", Description: "Ads", Vendor: "Meta", Category: "Marketing" },
    ],
    [2, 3],
    opts(),
  )

  const asExisting = (index: number, over: Partial<ExistingExpense> = {}): ExistingExpense => ({
    id: `e${index}`,
    sourceKey: sheet.expenses[index].sourceKey,
    date: sheet.expenses[index].date,
    amount: sheet.expenses[index].amount,
    description: sheet.expenses[index].description,
    category: sheet.expenses[index].category,
    vendor: sheet.expenses[index].vendor,
    ...over,
  })

  it("creates everything on a first import", () => {
    const plan = planExpenseImport(sheet, [])
    expect(plan.create).toHaveLength(2)
    expect(plan.totals.toCreate).toBe(150)
    expect(plan.totals.sheet).toBe(150)
  })

  it("creates nothing on a second import of the same sheet", () => {
    // The whole reason the source key exists.
    const plan = planExpenseImport(sheet, [asExisting(0), asExisting(1)])
    expect(plan.create).toHaveLength(0)
    expect(plan.unchanged).toBe(2)
    expect(plan.totals.toCreate).toBe(0)
  })

  it("adds only what is new", () => {
    const plan = planExpenseImport(sheet, [asExisting(0)])
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0].description).toBe("Ads")
  })

  it("reports a recategorised row instead of a duplicate", () => {
    const plan = planExpenseImport(sheet, [asExisting(0, { category: "OTHER" }), asExisting(1)])
    expect(plan.create).toHaveLength(0)
    expect(plan.changed).toHaveLength(1)
    expect(plan.changed[0].fields).toEqual(["category"])
  })

  it("reports rows that left the sheet without deleting them", () => {
    const stale: ExistingExpense = {
      id: "gone", sourceKey: "2026 expenses|2026-07-01|9.00|old thing||1",
      date: "2026-07-01", amount: 9, description: "Old thing", category: null, vendor: null,
    }
    const plan = planExpenseImport(sheet, [asExisting(0), asExisting(1), stale])
    expect(plan.missingFromSheet).toEqual([stale])
    // Money never disappears from the books without a person deciding.
    expect(plan.create).toHaveLength(0)
  })

  it("gives the totals needed to check against the sheet", () => {
    const plan = planExpenseImport(sheet, [asExisting(0)])
    expect(plan.totals).toEqual({ sheet: 150, toCreate: 50, existing: 100 })
  })
})
