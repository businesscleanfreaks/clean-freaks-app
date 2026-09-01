"use client"

import { useRef, useState } from "react"
import {
  LEDGER_COLUMNS,
  moveColumn,
  nextSort,
  type ColumnKey,
  type SortDir,
} from "@/lib/ledger-columns"

/**
 * The ledger's column headings: click to sort, drag to reorder.
 *
 * Both live on the same pointer gesture, the way the design has it — a press
 * that never moves is a sort, a press that travels is a drag. That means one
 * unambiguous target per heading instead of a separate grip nobody finds.
 */
export function LedgerHeader({ order, sort, onSort, onReorder, children }: {
  order: ColumnKey[]
  sort: { key: ColumnKey; dir: SortDir }
  onSort: (next: { key: ColumnKey; dir: SortDir }) => void
  onReorder: (next: ColumnKey[]) => void
  /** The leading select-all checkbox. */
  children: React.ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ key: ColumnKey; x: number; y: number; insertIdx: number } | null>(null)

  // Held in a ref, not state: the move handler reads them every frame and must
  // not be re-bound mid-gesture.
  const gesture = useRef<{
    key: ColumnKey
    startX: number
    moved: boolean
    centers: number[]
    edges: { left: number; right: number }[]
    wrapLeft: number
    insertIdx: number
  } | null>(null)


  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (!g.moved && Math.abs(e.clientX - g.startX) < 4) return
    g.moved = true
    g.insertIdx = g.centers.filter(c => c < e.clientX).length
    setDrag({ key: g.key, x: e.clientX, y: e.clientY, insertIdx: g.insertIdx })
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
    setDrag(null)
    if (!g) return
    if (!g.moved) onSort(nextSort(sort, g.key))
    else onReorder(moveColumn(order, g.key, g.insertIdx))
  }

  const start = (e: React.PointerEvent, key: ColumnKey) => {
    // Measure once at the start: the columns do not move under the cursor
    // while dragging, so re-reading them every frame would only cost work.
    const cells = Array.from(rowRef.current?.querySelectorAll<HTMLElement>("[data-col]") ?? [])
    const edges = cells
      .map(el => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right }
      })
      .sort((a, b) => a.left - b.left)
    gesture.current = {
      key,
      startX: e.clientX,
      moved: false,
      centers: edges.map(r => (r.left + r.right) / 2),
      edges,
      insertIdx: 0,
      wrapLeft: rowRef.current?.getBoundingClientRect().left ?? 0,
    }
    document.body.style.userSelect = "none"
    document.body.style.cursor = "grabbing"
    // Capture on the element itself: binding window listeners from an effect
    // missed a pointerup that arrived before React had re-rendered, so the
    // first click after mount never sorted.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* unsupported */ }
  }

  const ord: Record<string, number> = { check: 0, action: 99 }
  order.forEach((k, i) => { ord[k] = i + 1 })

  return (
    <div
      ref={rowRef}
      className="relative grid items-center gap-3 border-b border-[#eef0f3] bg-[#fbfcfd] px-5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]"
      style={{ gridTemplateColumns: `18px ${order.map(k => LEDGER_COLUMNS[k].width).join(" ")} 132px` }}
    >
      <div style={{ order: 0 }}>{children}</div>

      {order.map(key => {
        const meta = LEDGER_COLUMNS[key]
        const active = sort.key === key
        return (
          <button
            key={key}
            type="button"
            data-col={key}
            onPointerDown={e => start(e, key)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onLostPointerCapture={onPointerUp}
            aria-label={`Sort by ${meta.label.toLowerCase()}`}
            className="flex touch-none select-none items-center gap-1 uppercase transition-opacity"
            style={{
              order: ord[key],
              cursor: "grab",
              justifyContent: meta.align === "right" ? "flex-end" : meta.align === "center" ? "center" : "flex-start",
              // Matches the cell's padding so the label stays over its numbers.
              paddingRight: meta.align === "right" ? 16 : undefined,
              opacity: drag?.key === key ? 0.25 : 1,
              color: active ? "#475467" : undefined,
            }}
          >
            {meta.label}
            {active && <span aria-hidden>{sort.dir > 0 ? "↑" : "↓"}</span>}
          </button>
        )
      })}

      <span style={{ order: 99 }} className="text-right">Action</span>

      {/* The column travels with the cursor; the bar shows where it lands. */}
      {drag && (() => {
        const g = gesture.current
        const edges = g?.edges ?? []
        let x = 0
        if (edges.length) {
          const i = drag.insertIdx
          if (i <= 0) x = edges[0].left
          else if (i >= edges.length) x = edges[edges.length - 1].right
          else x = (edges[i - 1].right + edges[i].left) / 2
        }
        return (
          <>
            <span
              aria-hidden
              className="pointer-events-none fixed z-[200] rounded-[7px] bg-white px-2.5 py-[5px] text-[10.5px] font-extrabold uppercase tracking-[0.05em]"
              style={{
                left: drag.x + 14,
                top: drag.y - 12,
                color: "#15793f",
                border: "1px solid #15793f",
                boxShadow: "0 8px 22px rgba(15,60,35,0.22)",
              }}
            >
              {LEDGER_COLUMNS[drag.key].label}
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-1.5 top-1.5 z-50 w-[2.5px] rounded-[2px]"
              style={{
                left: x - (g?.wrapLeft ?? 0),
                background: "#15793f",
                boxShadow: "0 0 0 2px rgba(21,121,63,0.15)",
              }}
            />
          </>
        )
      })()}
    </div>
  )
}
