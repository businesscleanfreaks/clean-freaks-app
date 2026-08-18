"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"

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
  month, cleans, clientId, clientName,
}: {
  month: string
  cleans: ScheduleCheckClean[]
  clientId: string
  clientName: string
}) {
  const router = useRouter()
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

        {counts.cancelled > 0 && (
          <p className="mt-2 border-t border-stone-100 pt-2 text-[10.5px] text-stone-500">
            {counts.cancelled} cancelled {counts.cancelled === 1 ? "clean" : "cleans"} this month. Open the day to correct it
            before sending.
          </p>
        )}
      </div>
    </div>
  )
}
