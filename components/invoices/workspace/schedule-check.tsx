"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { CircleCheck, Loader2, RotateCcw } from "lucide-react"
import { showError, showSuccess } from "@/lib/toast"
import { buildCorrectionRows, correctionToast, type CorrectionTarget } from "@/lib/invoice-correction"
import { cadenceLabel, cellStyle, scheduleSummaryLabel, type CellMark } from "@/lib/schedule-check"

/**
 * Schedule check — "did the month go as planned?" for a per-clean invoice.
 *
 * Only shown for per-clean billing: a flat-rate client pays the same monthly
 * amount whatever the visit count, so checking the day grid tells the reviewer
 * nothing about the total.
 *
 * Every marked day links into the calendar with that job's card open, and the
 * header links to the calendar filtered to just this client.
 */

const DOW = ["S", "M", "T", "W", "T", "F", "S"]

export type CleanMark = "completed" | "scheduled" | "cancelled" | "oneoff"

export interface ScheduleCheckClean {
  jobId?: string
  date: string | Date
  status: string
  /** One-off / add-on work, which the design marks amber. */
  isOneOff?: boolean
  /** What this clean bills when it counts. */
  clientRate?: number | null
  /** Late-cancel fee attached while it is cancelled. */
  cancellationFee?: number | null
  /** Who performed it, so the toast can say who gets credited. */
  cleanerName?: string | null
}

const MARK_STYLE: Record<CleanMark, { bg: string; text: string; strike?: boolean }> = {
  completed: { bg: "#DCFCE7", text: "#15803D" },
  scheduled: { bg: "#DBEAFE", text: "#1D4ED8" },
  cancelled: { bg: "#FEE2E2", text: "#B91C1C", strike: true },
  oneoff: { bg: "#FEF3C7", text: "#92400E" },
}

// A real visit outranks a cancellation on a day that has both; a one-off is
// called out over a routine scheduled clean because it is the surprise.
const PRIORITY: Record<CleanMark, number> = { completed: 4, oneoff: 3, scheduled: 2, cancelled: 1 }

export function markFor(clean: ScheduleCheckClean): CleanMark {
  if (clean.status === "CANCELLED" || clean.status === "SKIPPED") return "cancelled"
  if (clean.isOneOff) return "oneoff"
  if (clean.status === "COMPLETED") return "completed"
  return "scheduled"
}

/** Highest-priority mark per day, plus a job to link to. */
export function buildDayMap(
  month: string,
  cleans: ScheduleCheckClean[],
): Map<number, { mark: CleanMark; jobId?: string }> {
  const [y, m] = month.split("-").map(Number)
  const byDay = new Map<number, { mark: CleanMark; jobId?: string }>()
  for (const c of cleans) {
    const d = c.date instanceof Date ? c.date : new Date(c.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m - 1) continue
    const day = d.getDate()
    const mark = markFor(c)
    const prev = byDay.get(day)
    if (!prev || PRIORITY[mark] > PRIORITY[prev.mark]) byDay.set(day, { mark, jobId: c.jobId })
  }
  return byDay
}

export function countByMark(byDay: Map<number, { mark: CleanMark }>): Record<CleanMark, number> {
  const counts: Record<CleanMark, number> = { completed: 0, scheduled: 0, cancelled: 0, oneoff: 0 }
  for (const { mark } of byDay.values()) counts[mark] += 1
  return counts
}

export function ScheduleCheck({
  month, cleans, clientId, clientName, onCorrected,
}: {
  month: string
  cleans: ScheduleCheckClean[]
  clientId: string
  clientName: string
  /** Refetch the cleans this grid draws, owned by the pane that fetched them. */
  onCorrected?: () => Promise<unknown> | unknown
}) {
  const router = useRouter()
  const { mutate } = useSWRConfig()
  // Cleans corrected in this sitting stay listed so the change can be undone
  // without going hunting for the day again.
  const [corrected, setCorrected] = useState<string[]>([])
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const byDay = useMemo(() => buildDayMap(month, cleans), [month, cleans])
  const counts = useMemo(() => countByMark(byDay), [byDay])

  const [y, m] = month.split("-").map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const leadBlanks = new Date(y, m - 1, 1).getDay()
  const today = new Date()
  const isThisMonth = today.getFullYear() === y && today.getMonth() === m - 1

  const cells: Array<number | null> = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const rows = useMemo(
    () => buildCorrectionRows(month, cleans, corrected),
    [month, cleans, corrected],
  )

  // The month's pattern in words, from the cleans that actually happened.
  const cadence = useMemo(() => {
    const dayOf = (c: ScheduleCheckClean) => {
      const d = c.date instanceof Date ? c.date : new Date(c.date)
      return isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m - 1 ? null : d.getDate()
    }
    const cleanDays: number[] = []
    const cancelledDays: number[] = []
    for (const c of cleans) {
      const day = dayOf(c)
      if (day === null) continue
      if (c.status === "CANCELLED" || c.status === "SKIPPED") cancelledDays.push(day)
      else cleanDays.push(day)
    }
    return cadenceLabel({ cleanDays, cancelledDays, year: y, month: m })
  }, [cleans, y, m])

  const ranAsScheduled = counts.cancelled === 0 && counts.oneoff === 0
  const monthTitle = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })

  /**
   * Write the correction back to the visit itself, not to this invoice.
   * The same PUT the calendar uses, so the clean, the cleaner's pay and the
   * invoice all move together instead of drifting apart.
   */
  const correct = async (jobId: string, target: CorrectionTarget, droppedFee: number, cleanerName?: string | null) => {
    setBusyJobId(jobId)
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        showError(body?.error || "Could not update this clean.")
        return
      }
      setCorrected(prev => (prev.includes(jobId) ? prev : [...prev, jobId]))
      showSuccess(correctionToast(target, cleanerName, droppedFee))
      // Refetch this grid through the hook that owns its key, then let the
      // ledger and calendar catch up: the invoice is derived from the visits,
      // so everything downstream has to recompute.
      await onCorrected?.()
      // Everything else that reads this visit. The cleans key is deliberately
      // excluded: onCorrected already owns it, and refetching it again here
      // only re-runs a slow request and can flash the pre-correction state
      // back on screen.
      await mutate(
        key =>
          typeof key === "string" &&
          !key.includes("/cleans?") &&
          (key.startsWith("/api/invoices/candidates") ||
            key.startsWith("/api/invoices/overview") ||
            key.startsWith(`/api/clients/${clientId}`) ||
            key.startsWith("/api/calendar/data")),
      )
    } catch {
      showError("Could not update this clean.")
    } finally {
      setBusyJobId(null)
    }
  }

  const openDay = (jobId?: string) => {
    // With a job we can open its card directly; otherwise just filter the month.
    router.push(jobId ? `/calendar?jobId=${jobId}&clientId=${clientId}` : `/calendar?clientId=${clientId}`)
  }

  return (
    // Warm card, per the design — the schedule check is a moment of scrutiny
    // and reads as its own surface rather than another white panel.
    <div style={{ border: "1px solid #eee7db", background: "#faf9f6", borderRadius: 14, padding: "11px 16px" }}>
      <div className="mb-[5px] flex items-baseline justify-between gap-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#9aa3af]">Schedule check</span>
        <span className="inline-flex items-center gap-2.5">
          <span className="text-[11.5px] font-semibold text-[#8b95a1]">
            {scheduleSummaryLabel(counts.completed, counts.cancelled)}
          </span>
          <button
            type="button"
            onClick={() => router.push(`/calendar?clientId=${clientId}`)}
            title={`Something wrong? Fix the schedule on the calendar · this invoice recomputes from it`}
            className="whitespace-nowrap text-[11.5px] font-bold text-[#15793f] transition-opacity hover:opacity-80"
          >
            Open in Calendar →
          </button>
        </span>
      </div>

      {/* What the month's pattern actually was, in words. */}
      <div className="text-[17px] font-bold leading-tight tracking-[-0.015em] text-[#111827]">{cadence}</div>

      {ranAsScheduled && (
        <div className="mt-1.5 flex items-center gap-[7px]">
          <CircleCheck className="h-[15px] w-[15px] flex-none text-[#15793f]" strokeWidth={2.2} />
          <span className="text-[13px] font-bold text-[#15793f]">Ran as scheduled</span>
        </div>
      )}

      <div className="mt-[9px] border-t border-[#eee7db] pt-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#111827]">{monthTitle}</span>
          <span className="flex items-center gap-[11px] text-[10.5px] text-[#9aa3af]">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: "#15793f" }} />Clean
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} />Add-on
            </span>
          </span>
        </div>

        <div className="grid grid-cols-7 gap-[3px]" style={{ maxWidth: 206 }}>
          {DOW.map((d, i) => (
            <span key={`dow-${i}`} className="pb-px text-center text-[10px] text-[#9aa3af]">{d}</span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={i} style={{ aspectRatio: "1" }} />
            const entry = byDay.get(day)
            const mark: CellMark = entry
              ? entry.mark === "completed" ? "clean"
                : entry.mark === "oneoff" ? "oneoff"
                  : entry.mark === "cancelled" ? "cancelled"
                    : "scheduled"
              : "empty"
            const st = cellStyle(mark)
            const label = entry
              ? `${new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · open this day on the calendar to correct it`
              : undefined
            return (
              <div
                key={i}
                onClick={entry ? () => openDay(entry.jobId) : undefined}
                title={label}
                aria-label={label}
                className="flex items-center justify-center rounded-full text-[10.5px] tabular-nums"
                style={{
                  aspectRatio: "1",
                  background: st.background,
                  color: st.color,
                  fontWeight: st.fontWeight,
                  boxShadow: st.boxShadow,
                  textDecoration: st.textDecoration,
                  cursor: entry ? "pointer" : "default",
                }}
              >
                {day}
              </div>
            )
          })}
        </div>
      </div>

        {/* Invoice-time correction. The reviewer often knows the clean did
            happen; fixing it here writes back to the visit, so the calendar,
            the cleaner's pay and this invoice all move together. */}
        {rows.length > 0 && (
          <div className="mt-2 border-t border-stone-100 pt-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              Cancelled this month
            </div>
            <div className="space-y-1">
              {rows.map(row => {
                const busy = busyJobId === row.jobId
                const cleanerName = cleans.find(c => c.jobId === row.jobId)?.cleanerName
                return (
                  <div key={row.jobId} className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{ background: row.billed ? "#15793f" : "#c0c7cf" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-semibold text-stone-700">{row.dateLabel}</div>
                      <div className="truncate text-[10.5px]" style={{ color: row.billed ? "#15793f" : "#8b95a1" }}>
                        {row.description}
                      </div>
                    </div>
                    {row.effect && (
                      <span
                        className="flex-none text-[11px] font-semibold tabular-nums"
                        style={{ color: row.billed ? "#15793f" : "#8b95a1" }}
                      >
                        {row.effect}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => correct(row.jobId, row.target, row.droppedFee, cleanerName)}
                      title={
                        row.billed
                          ? "Put this clean back to cancelled"
                          : "This clean did happen · bill it and credit the cleaner"
                      }
                      className="inline-flex flex-none items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors disabled:opacity-50"
                      style={
                        row.billed
                          ? { borderColor: "#d7dbe0", color: "#64748b", background: "#fff" }
                          : { borderColor: "#f3b4b4", color: "#c0342a", background: "#fdecec" }
                      }
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : row.billed ? <RotateCcw className="h-3 w-3" /> : null}
                      {row.actionLabel}
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-stone-400">
              Correcting a clean updates the calendar and the cleaner&apos;s pay too.
            </p>
          </div>
        )}
    </div>
  )
}
