"use client"

import { useMemo, useState } from "react"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import type { ClientWithDetails } from "@/lib/types"

type LooseSchedule = {
  id: string
  isActive?: boolean
  endDate?: string | Date | null
  startDate?: string | Date | null
  defaultClientRate?: number | null
}
type LooseJob = { scheduleId?: string | null; date: string | Date; status?: string | null }

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function addDaysIso(base: Date, n: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Trial cockpit panel: window + progress + days-left, plus the three decisions —
 * Convert to recurring (clear the trial end + apply the proposed rate), Extend
 * (push the end out), End (stop after today). All via the schedule PUT route,
 * which regenerates jobs.
 */
export function TrialStatusPanel({
  client,
  proposedRate,
  onDone,
}: {
  client: ClientWithDetails
  proposedRate?: string | null
  onDone: () => void
}) {
  // The trial schedule is the active schedule carrying the trial end date.
  const sched = useMemo<LooseSchedule | null>(() => {
    for (const loc of client.locations || []) {
      const withEnd = ((loc.schedules || []) as LooseSchedule[]).find((s) => s.isActive && s.endDate)
      if (withEnd) return withEnd
    }
    for (const loc of client.locations || []) {
      const any = ((loc.schedules || []) as LooseSchedule[]).find((s) => s.isActive)
      if (any) return any
    }
    return null
  }, [client])

  const [busy, setBusy] = useState<null | "extend" | "convert" | "end">(null)
  const [extendOpen, setExtendOpen] = useState(false)
  const [newEnd, setNewEnd] = useState("")
  const [confirmEnd, setConfirmEnd] = useState(false)

  const start = toDate(sched?.startDate)
  const end = toDate(sched?.endDate)

  const { completed, total, daysLeft } = useMemo(() => {
    if (!sched || !start) return { completed: 0, total: 0, daysLeft: null as number | null }
    const winEnd = end || new Date()
    const jobs = (client.locations || []).flatMap((l) => (l.jobs || []) as LooseJob[]).filter((j) => {
      if (j.scheduleId !== sched.id) return false
      const d = toDate(j.date)
      return d ? d >= start && d <= winEnd && j.status !== "CANCELLED" : false
    })
    const done = jobs.filter((j) => j.status === "COMPLETED").length
    let dl: number | null = null
    if (end) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      dl = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000))
    }
    return { completed: done, total: jobs.length, daysLeft: dl }
  }, [client, sched, start, end])

  if (!sched) return null

  const progress = total > 0 ? Math.min(1, completed / total) : 0
  const ended = end ? end.getTime() < Date.now() : false
  const statusLabel = !end ? "No end date" : ended ? "Trial ended" : daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
  const urgent = ended || (daysLeft != null && daysLeft <= 14)

  const putSchedule = async (data: Record<string, unknown>, kind: "extend" | "convert" | "end", ok: string) => {
    setBusy(kind)
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) { await showApiError(res, `Failed to ${kind} trial`); return }
      showSuccess(ok)
      setExtendOpen(false)
      setConfirmEnd(false)
      onDone()
    } catch { showError(`Failed to ${kind} trial`) } finally { setBusy(null) }
  }

  const convert = () => {
    const rate = proposedRate ? parseFloat(proposedRate.replace(/[^0-9.]/g, "")) : NaN
    const data: Record<string, unknown> = { endDate: null }
    if (!Number.isNaN(rate) && rate > 0) data.defaultClientRate = rate
    putSchedule(data, "convert", "Converted to a recurring schedule")
  }

  return (
    <section className="rounded-[10px] bg-white" style={{ border: `1px solid ${urgent ? "#FDE68A" : "#BFDBFE"}` }}>
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: urgent ? "#B45309" : "#1D4ED8" }}>
            Trial{start && end ? ` · ${fmt(start)} – ${fmt(end)}` : ""}
          </span>
          <span className="text-[12px] font-bold" style={{ color: urgent ? "#B45309" : "#1D4ED8" }}>{statusLabel}</span>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: "#2563EB" }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
          <span>{completed} of {total} cleans completed</span>
          {proposedRate && <span>Proposed: {proposedRate}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t px-5 py-3" style={{ borderColor: "#F4F4F5", background: urgent ? "#FFFBEB" : "#FAFAFA" }}>
        <button onClick={convert} disabled={busy !== null}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: "#2563EB" }}>
          {busy === "convert" ? "Converting…" : "Convert to recurring"}
        </button>
        <button onClick={() => { setNewEnd(addDaysIso(end || new Date(), 14)); setExtendOpen((v) => !v) }} disabled={busy !== null}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">
          Extend trial
        </button>
        <button onClick={() => setConfirmEnd((v) => !v)} disabled={busy !== null}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">
          End service
        </button>
      </div>

      {extendOpen && (
        <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 px-5 py-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-500">New trial end</label>
            <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
              className="mt-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-zinc-400" />
          </div>
          <button onClick={() => putSchedule({ endDate: newEnd }, "extend", "Trial extended")} disabled={busy !== null || !newEnd}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: "#0D9488" }}>
            {busy === "extend" ? "Extending…" : "Apply"}
          </button>
          <button onClick={() => setExtendOpen(false)} className="px-2 py-1.5 text-[12px] font-semibold text-zinc-500">Cancel</button>
        </div>
      )}

      {confirmEnd && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-5 py-3">
          <span className="text-[12px] text-zinc-600">End service after today? Upcoming cleans will be removed.</span>
          <button onClick={() => putSchedule({ endDate: isoToday() }, "end", "Service ended")} disabled={busy !== null}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: "#DC2626" }}>
            {busy === "end" ? "Ending…" : "Yes, end service"}
          </button>
          <button onClick={() => setConfirmEnd(false)} className="px-2 py-1.5 text-[12px] font-semibold text-zinc-500">Cancel</button>
        </div>
      )}
    </section>
  )
}
