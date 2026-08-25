/**
 * Ledger column layout, ordering and sorting.
 *
 * The design lets the VA drag the columns into the order they think in and
 * click a heading to sort by it — both remembered between visits, because a
 * layout you have to rebuild every morning is worse than no layout at all.
 *
 * Pure: no React, no DOM beyond localStorage, so the ordering and comparator
 * rules are testable on their own.
 */

import type { LedgerRow, LedgerStatus } from "./invoice-ledger"

export type ColumnKey = "client" | "type" | "amount" | "status" | "due"
export type SortDir = 1 | -1

export interface ColumnMeta {
  label: string
  align: "left" | "center" | "right"
  /** CSS grid track. */
  width: string
}

export const LEDGER_COLUMNS: Record<ColumnKey, ColumnMeta> = {
  client: { label: "Client", align: "left", width: "minmax(200px,1fr)" },
  type: { label: "Type", align: "left", width: "104px" },
  amount: { label: "Amount", align: "right", width: "110px" },
  status: { label: "Status", align: "left", width: "136px" },
  due: { label: "Payment due", align: "left", width: "120px" },
}

export const DEFAULT_COL_ORDER: ColumnKey[] = ["client", "type", "amount", "status", "due"]

const STORAGE_KEY = "cf-ledger-col-order"

/**
 * A stored order is only used when it is a permutation of the current column
 * set. Anything else — an older release's columns, a hand-edited entry — falls
 * back to the default rather than rendering a table with a missing column.
 */
export function parseColOrder(raw: string | null): ColumnKey[] {
  if (!raw) return DEFAULT_COL_ORDER
  try {
    const a = JSON.parse(raw)
    if (!Array.isArray(a) || a.length !== DEFAULT_COL_ORDER.length) return DEFAULT_COL_ORDER
    if (!DEFAULT_COL_ORDER.every(k => a.includes(k))) return DEFAULT_COL_ORDER
    return a as ColumnKey[]
  } catch {
    return DEFAULT_COL_ORDER
  }
}

export function loadColOrder(): ColumnKey[] {
  if (typeof window === "undefined") return DEFAULT_COL_ORDER
  try {
    return parseColOrder(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_COL_ORDER
  }
}

export function saveColOrder(order: ColumnKey[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    /* quota / disabled */
  }
}

/**
 * Moves `key` to slot `insertIdx`, where the index counts gaps in the ORIGINAL
 * row — dropping a column to the right of where it started lands one slot
 * earlier once it is lifted out.
 */
export function moveColumn(order: ColumnKey[], key: ColumnKey, insertIdx: number): ColumnKey[] {
  const from = order.indexOf(key)
  if (from < 0) return order
  const next = order.slice()
  next.splice(from, 1)
  let to = from < insertIdx ? insertIdx - 1 : insertIdx
  to = Math.max(0, Math.min(next.length, to))
  next.splice(to, 0, key)
  return next
}

/** Clicking the active column flips it; clicking another starts it ascending. */
export function nextSort(
  current: { key: ColumnKey; dir: SortDir },
  key: ColumnKey,
): { key: ColumnKey; dir: SortDir } {
  if (current.key === key) return { key, dir: (current.dir === 1 ? -1 : 1) as SortDir }
  return { key, dir: 1 }
}

/**
 * Where each status sits when sorting by status: the order the work actually
 * needs doing, not alphabetical. Late money first, settled money last.
 */
const STATUS_RANK: Record<LedgerStatus, number> = {
  "Payment late": 0,
  "To send": 1,
  "Sent: Unpaid": 2,
  Scheduled: 3,
  "Sent: Paid": 4,
  // Nothing to action and no money expected through the app: last.
  "Billed externally": 5,
}

/**
 * A row with no due date is treated as infinitely far off, so ascending order
 * puts it after everything that has a real date — you sort by due date to find
 * what is owed soonest, and "no date yet" is never that.
 */
function dueValue(row: LedgerRow): number {
  if (!row.dateDue) return Number.MAX_SAFE_INTEGER
  const t = new Date(row.dateDue).getTime()
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
}

export function sortRows(rows: LedgerRow[], key: ColumnKey, dir: SortDir): LedgerRow[] {
  const byClient = (a: LedgerRow, b: LedgerRow) => a.clientName.localeCompare(b.clientName)
  return rows.slice().sort((a, b) => {
    let r = 0
    if (key === "amount") r = a.totalAmount - b.totalAmount
    else if (key === "client") r = byClient(a, b)
    else if (key === "due") r = dueValue(a) - dueValue(b)
    else if (key === "type") r = a.kind.localeCompare(b.kind) || byClient(a, b)
    else if (key === "status") {
      r = (STATUS_RANK[a.ledgerStatus] - STATUS_RANK[b.ledgerStatus]) || byClient(a, b)
    }
    return r * dir
  })
}

/** The full grid template: checkbox, the ordered columns, then the action. */
export function gridTemplate(order: ColumnKey[]): string {
  return `18px ${order.map(k => LEDGER_COLUMNS[k].width).join(" ")} 132px`
}
