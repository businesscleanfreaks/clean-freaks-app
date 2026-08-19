"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { ArrowRight, Loader2, RotateCcw } from "lucide-react"
import { showError, showSuccess } from "@/lib/toast"
import { buildCorrectionRows, correctionToast, type CorrectionTarget } from "@/lib/invoice-correction"

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
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Schedule check</span>
        <button
          type="button"
          onClick={() => router.push(`/calendar?clientId=${clientId}`)}
          title={`Open the calendar showing only ${clientName}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-500 transition-colors hover:text-stone-900"
        >
          Open in Calendar
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-2.5">
        <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[8px] font-medium text-stone-400">
          {DOW.map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="h-6" />
            const entry = byDay.get(day)
            const style = entry ? MARK_STYLE[entry.mark] : null
            const isToday = isThisMonth && today.getDate() === day
            const label = entry
              ? `${clientName} · ${new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${entry.mark}`
              : undefined

            if (!entry) {
              return (
                <div key={i} className="flex h-6 items-center justify-center rounded text-[10px] tabular-nums text-stone-300">
                  <span className={isToday ? "flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-stone-900" : ""}>{day}</span>
                </div>
              )
            }
            return (
              <button
                key={i}
                type="button"
                onClick={() => openDay(entry.jobId)}
                title={label}
                aria-label={label}
                className="flex h-6 items-center justify-center rounded text-[10px] font-semibold tabular-nums transition-opacity hover:opacity-75"
                style={{ background: style!.bg, color: style!.text }}
              >
                <span
                  className={isToday ? "flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-stone-900" : ""}
                  style={style!.strike ? { textDecoration: "line-through" } : undefined}
                >
                  {day}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-stone-400">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#86EFAC" }} />Completed{counts.completed ? ` ${counts.completed}` : ""}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#93C5FD" }} />Scheduled{counts.scheduled ? ` ${counts.scheduled}` : ""}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#FCA5A5" }} />Cancelled{counts.cancelled ? ` ${counts.cancelled}` : ""}</span>
          {counts.oneoff > 0 && (
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "#FCD34D" }} />One-off {counts.oneoff}</span>
          )}
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
    </div>
  )
}
