import { describe, it, expect } from "vitest"
import {
  DEFAULT_COL_ORDER,
  gridTemplate,
  moveColumn,
  nextSort,
  parseColOrder,
  sortRows,
  type ColumnKey,
} from "@/lib/ledger-columns"
import type { LedgerRow } from "@/lib/invoice-ledger"

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: "i1",
  invoiceNumber: "INV-1",
  clientName: "Acme",
  totalAmount: 100,
  dateDue: "2026-08-10",
  status: "SENT",
  ledgerStatus: "Sent: Unpaid",
  statusLabel: "Sent: Unpaid",
  kind: "Per clean",
  ...over,
} as LedgerRow)

describe("parseColOrder", () => {
  it("keeps a valid saved order", () => {
    expect(parseColOrder('["due","client","type","amount","status"]'))
      .toEqual(["due", "client", "type", "amount", "status"])
  })

  it("falls back when a column is missing · never render a table short a column", () => {
    expect(parseColOrder('["client","type","amount","status"]')).toEqual(DEFAULT_COL_ORDER)
  })

  it("falls back on an unknown column from an older release", () => {
    expect(parseColOrder('["client","type","amount","status","cleaner"]')).toEqual(DEFAULT_COL_ORDER)
  })

  it("falls back on junk and on nothing saved", () => {
    expect(parseColOrder("not json")).toEqual(DEFAULT_COL_ORDER)
    expect(parseColOrder(null)).toEqual(DEFAULT_COL_ORDER)
  })
})

describe("moveColumn", () => {
  const order: ColumnKey[] = ["client", "type", "amount", "status", "due"]

  it("drags a column to the front", () => {
    expect(moveColumn(order, "due", 0)).toEqual(["due", "client", "type", "amount", "status"])
  })

  it("drags a column to the end", () => {
    expect(moveColumn(order, "client", 5)).toEqual(["type", "amount", "status", "due", "client"])
  })

  it("accounts for the lifted column when moving right", () => {
    // Dropping "client" into gap 2 lands it between type and amount, not after.
    expect(moveColumn(order, "client", 2)).toEqual(["type", "client", "amount", "status", "due"])
  })

  it("is a no-op when dropped where it already is", () => {
    expect(moveColumn(order, "amount", 2)).toEqual(order)
  })

  it("ignores a column that is not in the order", () => {
    expect(moveColumn(["client", "type"] as ColumnKey[], "due", 0)).toEqual(["client", "type"])
  })
})

describe("nextSort", () => {
  it("flips direction on the column already sorted", () => {
    expect(nextSort({ key: "client", dir: 1 }, "client")).toEqual({ key: "client", dir: -1 })
    expect(nextSort({ key: "client", dir: -1 }, "client")).toEqual({ key: "client", dir: 1 })
  })

  it("starts a new column ascending, whichever way the last one pointed", () => {
    expect(nextSort({ key: "client", dir: -1 }, "amount")).toEqual({ key: "amount", dir: 1 })
  })
})

describe("sortRows", () => {
  it("sorts by amount both ways", () => {
    const rows = [row({ id: "a", totalAmount: 300 }), row({ id: "b", totalAmount: 100 })]
    expect(sortRows(rows, "amount", 1).map(r => r.id)).toEqual(["b", "a"])
    expect(sortRows(rows, "amount", -1).map(r => r.id)).toEqual(["a", "b"])
  })

  it("puts late money first when sorting by status", () => {
    const rows = [
      row({ id: "paid", ledgerStatus: "Sent: Paid" }),
      row({ id: "late", ledgerStatus: "Payment late" }),
      row({ id: "tosend", ledgerStatus: "To send" }),
    ]
    expect(sortRows(rows, "status", 1).map(r => r.id)).toEqual(["late", "tosend", "paid"])
  })

  it("sorts undated rows after real due dates", () => {
    const rows = [row({ id: "none", dateDue: null }), row({ id: "soon", dateDue: "2026-08-01" })]
    expect(sortRows(rows, "due", 1).map(r => r.id)).toEqual(["soon", "none"])
  })

  it("treats an unparseable date as undated rather than sorting it first", () => {
    const rows = [row({ id: "bad", dateDue: "whenever" }), row({ id: "soon", dateDue: "2026-08-01" })]
    expect(sortRows(rows, "due", 1).map(r => r.id)).toEqual(["soon", "bad"])
  })

  it("breaks ties by client so equal rows keep a stable, readable order", () => {
    const rows = [
      row({ id: "z", clientName: "Zed", ledgerStatus: "To send" }),
      row({ id: "a", clientName: "Acme", ledgerStatus: "To send" }),
    ]
    expect(sortRows(rows, "status", 1).map(r => r.id)).toEqual(["a", "z"])
  })

  it("does not mutate the input", () => {
    const rows = [row({ id: "a", totalAmount: 300 }), row({ id: "b", totalAmount: 100 })]
    sortRows(rows, "amount", 1)
    expect(rows.map(r => r.id)).toEqual(["a", "b"])
  })
})

describe("gridTemplate", () => {
  it("brackets the ordered columns with the checkbox and the action", () => {
    expect(gridTemplate(["amount", "client", "type", "status", "due"]))
      .toBe("18px 126px minmax(200px,1fr) 104px 136px 120px 132px")
  })
})
