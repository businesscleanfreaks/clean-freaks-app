"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/utils"
import type { ClientWithDetails } from "@/lib/types"

// Cockpit tab union — single source of truth, imported by the detail view too.
export type CockpitTab = "overview" | "schedule" | "billing" | "contacts" | "access" | "scope" | "history"

interface NextClean {
  date: string
  time?: string | null
  location?: string | null
  worker?: string | null
}

type LooseSchedule = {
  id: string
  isActive?: boolean
  clientPayType?: string | null
  subcontractorPayType?: string | null
  defaultClientRate?: number | null
  defaultSubcontractorRate?: number | null
}
type LooseJob = {
  scheduleId?: string | null
  date: string | Date
  status?: string | null
  clientRate?: number | null
  subcontractorRate?: number | null
}

/**
 * Always-visible strip under the header (the "client calls and the VA picks up"
 * moment): next clean, this month's billing, access, and the single most
 * important attention item. Each slot jumps to the relevant tab.
 */
export function AtAGlanceStrip({
  client,
  nextClean,
  onJumpTo,
}: {
  client: ClientWithDetails
  nextClean: NextClean | null
  onJumpTo: (tab: CockpitTab) => void
}) {
  const isTrial = (client.notes || "").toUpperCase().includes("TRIAL CLIENT")

  // This month's billing estimate: flat-rate schedules count once, per-clean
  // schedules and one-offs sum per non-cancelled clean in the current month.
  const monthBilling = useMemo(() => {
    const now = new Date()
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    let clientTotal = 0
    let cleanerTotal = 0
    for (const loc of client.locations || []) {
      const scheds = ((loc.schedules || []) as LooseSchedule[]).filter((s) => s.isActive)
      const schedById = new Map(scheds.map((s) => [s.id, s]))
      const flatClientIds = new Set(scheds.filter((s) => s.clientPayType === "FLAT_RATE").map((s) => s.id))
      for (const s of scheds) {
        if (s.clientPayType === "FLAT_RATE") clientTotal += s.defaultClientRate || 0
        if (s.subcontractorPayType === "FLAT_RATE") cleanerTotal += s.defaultSubcontractorRate || 0
      }
      for (const j of (loc.jobs || []) as LooseJob[]) {
        const d = new Date(j.date)
        if (d < mStart || d > mEnd || j.status === "CANCELLED") continue
        if (!(j.scheduleId && flatClientIds.has(j.scheduleId))) clientTotal += j.clientRate || 0
        const sched = j.scheduleId ? schedById.get(j.scheduleId) : undefined
        if (!(sched && sched.subcontractorPayType === "FLAT_RATE")) cleanerTotal += j.subcontractorRate || 0
      }
    }
    return { clientTotal, cleanerTotal, margin: clientTotal - cleanerTotal }
  }, [client])

  const accessSummary = useMemo(() => {
    const locs = client.locations || []
    if (locs.length === 0) return null
    const fieldsOf = (l: (typeof locs)[number]) => (l.accessFields as unknown as Record<string, string> | null) || {}
    const anySaved = (a: Record<string, string>, legacy?: string | null) =>
      Object.values(a).some((v) => (v || "").trim()) || !!(legacy || "").trim()
    if (locs.length > 1) {
      const saved = locs.some((l) => anySaved(fieldsOf(l), l.accessInfo))
      return { multi: true, value: saved ? "Multi-location" : "Not set", count: locs.length, saved }
    }
    const a = fieldsOf(locs[0])
    const trunc = (s: string) => (s.length > 32 ? s.slice(0, 30) + "…" : s)
    if (a.lockbox?.trim()) return { multi: false, value: `Lockbox ${a.lockbox}`, saved: true }
    if (a.entry?.trim()) return { multi: false, value: trunc(a.entry), saved: true }
    if (a.alarm?.trim()) return { multi: false, value: `Alarm ${a.alarm}`, saved: true }
    if ((locs[0].accessInfo || "").trim()) return { multi: false, value: trunc(locs[0].accessInfo as string), saved: true }
    return { multi: false, value: "Not set", saved: false }
  }, [client])

  const attention = useMemo((): { label: string; tab: CockpitTab; urgent?: boolean } | null => {
    if (!nextClean) return { label: "No upcoming cleans", tab: "schedule", urgent: true }
    if (!nextClean.worker) return { label: "Next clean unassigned", tab: "schedule", urgent: true }
    const issues = client.openIssues || []
    if (issues.length > 0) return { label: `${issues.length} open issue${issues.length === 1 ? "" : "s"}`, tab: "overview" }
    return null
  }, [client, nextClean])

  const primaryContact = client.communicationContactName || null

  const slots: Array<{
    label: string
    primary: string
    secondary?: string
    tab: CockpitTab
    attention?: boolean
    urgent?: boolean
  }> = [
    {
      label: "Next clean",
      primary: nextClean ? nextClean.date : "—",
      secondary: nextClean
        ? [nextClean.worker, nextClean.location, nextClean.time].filter(Boolean).join(" · ")
        : "No upcoming cleans",
      tab: "schedule",
    },
    {
      label: isTrial ? "Trial billing" : "This month",
      primary: isTrial ? "Pending" : formatCurrency(monthBilling.clientTotal),
      secondary: isTrial ? "Bills after trial" : `Margin ${formatCurrency(monthBilling.margin)}`,
      tab: "billing",
    },
    {
      label: "Access",
      primary: accessSummary ? accessSummary.value : "—",
      secondary: accessSummary && accessSummary.multi
        ? `${accessSummary.count} locations`
        : primaryContact
          ? `Primary: ${primaryContact}`
          : undefined,
      tab: "access",
    },
  ]

  if (attention) {
    slots.push({
      label: "Attention",
      primary: attention.label,
      secondary: "Click to review",
      tab: attention.tab,
      attention: true,
      urgent: attention.urgent,
    })
  }

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="px-4 sm:px-7">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0,1fr))` }}>
          {slots.map((s, i) => (
            <button
              key={i}
              onClick={() => onJumpTo(s.tab)}
              className={`group min-w-0 text-left px-3.5 py-2.5 transition-colors ${
                i < slots.length - 1 ? "border-r border-gray-100" : ""
              } ${s.attention ? (s.urgent ? "bg-rose-50/60 hover:bg-rose-50" : "bg-amber-50/60 hover:bg-amber-50") : "hover:bg-zinc-50"}`}
            >
              <div
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em]"
                style={{ color: s.attention ? (s.urgent ? "#E11D48" : "#B45309") : "#A1A1AA" }}
              >
                {s.attention && <span>{s.urgent ? "⚠" : "•"}</span>}
                {s.label}
              </div>
              <div
                className="truncate text-[14px] font-semibold leading-tight mt-0.5"
                style={{ color: s.attention && s.urgent ? "#E11D48" : "#18181B" }}
                title={s.primary}
              >
                {s.primary}
              </div>
              {s.secondary && (
                <div className="truncate text-[10px] text-zinc-400 mt-0.5" title={s.secondary}>
                  {s.secondary}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
