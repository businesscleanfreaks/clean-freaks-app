"use client"

import { Fragment, useMemo } from "react"

// Mirrors lib/regenerate-schedule-jobs.ts ScheduleChangeDiffResult (kept local so
// this client component never imports the prisma-backed server lib).
export type DiffKind = "added" | "removed" | "modified" | "kept"
export interface DiffRow {
  iso: string
  kind: DiffKind
  cleaner: string | null
  clientRate: number | null
  protectedJob: boolean
}
export interface ScheduleDiff {
  rows: DiffRow[]
  addedCount: number
  removedCount: number
  modifiedCount: number
  keptCount: number
  windowFrom: string
  windowTo: string
}

const KIND_STYLE: Record<DiffKind, { dot: string; label: string; text: string }> = {
  added: { dot: "#10B981", label: "Added", text: "#047857" },
  removed: { dot: "#F43F5E", label: "Removed", text: "#BE123C" },
  modified: { dot: "#F59E0B", label: "Updated", text: "#B45309" },
  kept: { dot: "#D4D4D8", label: "Unchanged", text: "#71717A" },
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z")
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function fmtMoney(n: number | null): string {
  return n == null ? "" : "$" + Math.round(n).toLocaleString()
}

/**
 * Renders the per-date diff of a proposed schedule change (added / removed /
 * modified / unchanged cleans) with a "today" divider, so the operator sees
 * exactly what the change does before applying it.
 */
export function ScheduleDiffPreview({ diff }: { diff: ScheduleDiff | null | undefined }) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const rows = diff?.rows || []
  const firstFutureIdx = useMemo(() => rows.findIndex((r) => r.iso >= todayIso), [rows, todayIso])

  if (!diff || rows.length === 0) {
    return <p className="text-[12px] text-zinc-400">No cleans scheduled in this window.</p>
  }

  const noChanges = diff.addedCount === 0 && diff.removedCount === 0 && diff.modifiedCount === 0

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
        {diff.addedCount > 0 && <span style={{ color: "#047857" }}>+{diff.addedCount} added</span>}
        {diff.removedCount > 0 && <span style={{ color: "#BE123C" }}>−{diff.removedCount} removed</span>}
        {diff.modifiedCount > 0 && <span style={{ color: "#B45309" }}>{diff.modifiedCount} updated</span>}
        {noChanges && <span className="text-zinc-500">No clean changes in this window</span>}
      </div>

      <div className="max-h-[260px] overflow-y-auto rounded-md border border-zinc-100">
        {rows.map((r, i) => {
          const st = KIND_STYLE[r.kind]
          return (
            <Fragment key={`${r.iso}-${i}`}>
              {i === firstFutureIdx && firstFutureIdx > 0 && (
                <div className="flex items-center gap-2 px-3 py-1">
                  <span className="h-px flex-1" style={{ background: "#E4E4E7" }} />
                  <span className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">Today</span>
                  <span className="h-px flex-1" style={{ background: "#E4E4E7" }} />
                </div>
              )}
              <div
                className="flex items-center gap-2.5 border-t border-zinc-50 px-3 py-1.5 text-[12px] first:border-t-0"
                style={{ opacity: r.kind === "kept" ? 0.65 : 1 }}
              >
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: st.dot }} />
                <span
                  className="w-[88px] flex-shrink-0 text-zinc-700"
                  style={{ textDecoration: r.kind === "removed" ? "line-through" : "none" }}
                >
                  {fmtDate(r.iso)}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-500">{r.cleaner || "Unassigned"}</span>
                {r.clientRate != null && <span className="flex-shrink-0 font-mono text-[11px] text-zinc-600">{fmtMoney(r.clientRate)}</span>}
                {r.protectedJob && (
                  <span className="flex-shrink-0 rounded bg-zinc-100 px-1 text-[9px] font-semibold uppercase text-zinc-500" title="Invoiced/paid — won't change">
                    locked
                  </span>
                )}
                <span className="w-[58px] flex-shrink-0 text-right text-[10px] font-semibold uppercase" style={{ color: st.text }}>
                  {st.label}
                </span>
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
