"use client"

import { useState } from "react"
import useSWR from "swr"
import type { HistoryMonth, HistoryTag, VisitStatus } from "@/lib/client-history"
import { C } from "./ui"
import { cleanerHex } from "./profile-locations"

/**
 * History (Client Profile Main.dc.html · HISTORY): one section per month,
 * visits per cleaner, and only what was unusual listed under it. Built by
 * lib/client-history.ts from the records; routine cleans are not events.
 */

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error("failed"))))

type Filter = "all" | "changes" | "extras" | "notes"
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["changes", "Changes"], ["extras", "One-time services"], ["notes", "Notes"]]
const passes = (tag: HistoryTag, f: Filter) =>
  f === "all" || (f === "changes" && (tag === "CHANGE" || tag === "RATE")) || (f === "extras" && tag === "EXTRA") || (f === "notes" && tag === "NOTE")

const TAG_STYLE: Record<HistoryTag, { bg: string; fg: string; label: string }> = {
  CHANGE: { bg: "#fdf0df", fg: "#b45309", label: "Change" },
  RATE: { bg: "#fdf0df", fg: "#b45309", label: "Rate" },
  EXTRA: { bg: "#eef2fb", fg: "#3b5bdb", label: "Extra" },
  NOTE: { bg: "#f3efe6", fg: "#8a7d5e", label: "Note" },
}

const VISIT_STYLE: Record<VisitStatus, { fg: string; fw: number }> = {
  Done: { fg: "#1f8a5b", fw: 600 },
  Skipped: { fg: "#b45309", fw: 700 },
  Covered: { fg: "#0d9488", fw: 600 },
  Upcoming: { fg: "#a39d90", fw: 500 },
}

export function HistoryTab({ clientId }: { clientId: string }) {
  const { data, error } = useSWR<{ months: HistoryMonth[] }>(`/api/clients/${clientId}/history`, fetcher, { revalidateOnFocus: false })
  const [filter, setFilter] = useState<Filter>("all")
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const months = (data?.months ?? [])
    .map(m => ({ ...m, events: m.events.filter(e => passes(e.tag, filter)) }))
    .filter(m => filter === "all" || m.events.length > 0)

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.mintBorder}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 20px", background: C.mint, borderBottom: `1px solid ${C.mintBorder}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: C.mintTitle }}>History</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>Visits per cleaner each month, with anything unusual listed under it.</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{
                  fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${filter === key ? C.primary : "#e6dfd1"}`, background: filter === key ? C.hoverTint : "#fff", color: filter === key ? C.teal : C.muted,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "4px 20px 12px" }}>
          {!data && !error && <div style={{ fontSize: 12.5, color: C.muted, padding: "14px 0" }}>Loading…</div>}
          {error && <div style={{ fontSize: 12.5, color: "#b4413a", padding: "14px 0" }}>Couldn&apos;t load the history.</div>}
          {data && months.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.muted, padding: "14px 0" }}>{filter === "all" ? "No history yet." : "Nothing here for this filter."}</div>
          )}

          {months.map((m, i) => {
            const isOpen = !!open[m.key]
            return (
              <div key={m.key} style={{ borderTop: `1px solid ${i === 0 ? "transparent" : "#e6e0d4"}`, padding: "14px 0 6px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>{m.label}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flex: 1, minWidth: 0 }}>
                    {m.byCleaner.map(c => (
                      <span key={c.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, background: "#f6f7f9", border: "1px solid #eef1f4", borderRadius: 999, padding: "3px 10px 3px 6px" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: cleanerHex(c.name), flex: "none" }} />
                        <b>{c.name}</b>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.count} {c.count === 1 ? "visit" : "visits"}</span>
                      </span>
                    ))}
                    {m.skipped > 0 && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.amber }}>{m.skipped} skipped</span>}
                    {m.upcoming > 0 && filter === "all" && <span style={{ fontSize: 12.5, color: C.muted }}>{m.upcoming} upcoming</span>}
                  </div>
                  {m.visitGroups.length > 0 && (
                    <button type="button" className="cfp-link" style={{ fontSize: 11.5 }} onClick={() => setOpen(o => ({ ...o, [m.key]: !o[m.key] }))}>
                      {isOpen ? "Hide visits" : "See each visit"}
                    </button>
                  )}
                </div>

                {m.events.length > 0 ? (
                  <div style={{ marginTop: 8, borderLeft: `2px solid ${C.border}`, paddingLeft: 14, display: "flex", flexDirection: "column" }}>
                    {m.events.map((e, j) => {
                      const t = TAG_STYLE[e.tag]
                      return (
                        <div key={`${e.iso}-${j}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0" }}>
                          <span style={{ width: 40, flex: "none", fontSize: 11, fontWeight: 700, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{e.date}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, flex: "none", background: t.bg, color: t.fg }}>{t.label}</span>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                            <span style={{ fontWeight: 600 }}>{e.title}</span>
                            <span style={{ color: C.muted }}> {e.sub}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  filter === "all" && <div style={{ marginTop: 6, fontSize: 12, color: C.faint }}>Nothing unusual.</div>
                )}

                {isOpen && (
                  <div style={{ marginTop: 10, background: "#fbfaf6", border: `1px solid ${C.border}`, borderRadius: 10, padding: "4px 14px 8px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 24px" }}>
                    {m.visitGroups.map(g => (
                      <div key={g.name} style={{ padding: "8px 0 4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: C.muted, paddingBottom: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: cleanerHex(g.name) }} />
                          {g.name} · {g.done} done
                        </div>
                        {g.rows.map(v => {
                          const s = VISIT_STYLE[v.status]
                          return (
                            <div key={`${v.iso}-${v.location}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 0", fontSize: 12.5, borderTop: "1px solid #f1ece2" }}>
                              <span style={{ width: 80, flex: "none", whiteSpace: "nowrap", color: s.fg, fontWeight: s.fw, fontVariantNumeric: "tabular-nums" }}>{v.date}</span>
                              <span style={{ flex: 1, minWidth: 0, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.location}</span>
                              <span style={{ fontSize: 11.5, fontWeight: 700, color: s.fg, flex: "none" }}>{v.status}</span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
