"use client"

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"

const DOW = ["S", "M", "T", "W", "T", "F", "S"]

function normalizeMonth(y: number, m: number) {
  const d = new Date(y, m, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

/**
 * Date + time picker for "Send later", portaled to <body> (so a transformed
 * ancestor can't anchor the fixed positioning) and floated above the anchor.
 */
export function SendLaterPopover({
  anchor,
  onCancel,
  onSchedule,
}: {
  anchor: DOMRect
  onCancel: () => void
  onSchedule: (when: Date) => void
}) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [view, setView] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }))
  const [day, setDay] = useState<Date | null>(null)
  const [time, setTime] = useState("09:00")

  const cells = useMemo(() => {
    const startDow = new Date(view.y, view.m, 1).getDay()
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const out: (Date | null)[] = []
    for (let i = 0; i < startDow; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(view.y, view.m, d))
    return out
  }, [view])

  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })

  // Float above the anchor (the send bar sits at the bottom of the rail).
  const width = 300
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
  const bottom = Math.max(8, window.innerHeight - anchor.top + 8)

  const schedule = () => {
    if (!day) return
    const [hh, mm] = time.split(":").map(Number)
    const when = new Date(day)
    when.setHours(hh || 0, mm || 0, 0, 0)
    onSchedule(when)
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" onClick={onCancel} />
      <div className="fixed z-[91] rounded-xl border border-stone-200 bg-white p-3 shadow-2xl" style={{ width, left, bottom }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Schedule send</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setView((v) => normalizeMonth(v.y, v.m - 1))}
              className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"><ChevronLeft size={14} /></button>
            <span className="min-w-[92px] text-center text-[12px] font-semibold text-stone-700">{monthLabel}</span>
            <button onClick={() => setView((v) => normalizeMonth(v.y, v.m + 1))}
              className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"><ChevronRight size={14} /></button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center">
          {DOW.map((d, i) => <div key={i} className="py-1 text-[9px] font-semibold uppercase text-stone-300">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const past = d < today
            const sel = !!day && d.getTime() === day.getTime()
            return (
              <button key={i} disabled={past} onClick={() => setDay(d)}
                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[12px] ${
                  past ? "cursor-not-allowed text-stone-300" : sel ? "font-semibold text-white" : "text-stone-600 hover:bg-stone-100"
                }`}
                style={sel ? { background: "#0D9488" } : undefined}>
                {d.getDate()}
              </button>
            )
          })}
        </div>

        <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-stone-400">Time</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />

        <div className="mt-3 flex gap-2">
          <button onClick={onCancel}
            className="flex-1 rounded-md border border-stone-200 py-1.5 text-[12px] font-semibold text-stone-500 hover:bg-stone-50">Cancel</button>
          <button onClick={schedule} disabled={!day}
            className="flex-1 rounded-md py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "#0D9488" }}>Schedule</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
