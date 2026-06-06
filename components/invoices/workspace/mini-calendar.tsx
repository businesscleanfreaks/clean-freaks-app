"use client"

// Month grid of the selected client's cleans, color-coded by status — the
// at-a-glance "did the month go as planned?" view from the prototype.

const DOW = ["S", "M", "T", "W", "T", "F", "S"]

const STATUS_COLOR: Record<string, { bg: string; text: string; strike?: boolean }> = {
  COMPLETED: { bg: "#DCFCE7", text: "#15803D" },
  SCHEDULED: { bg: "#DBEAFE", text: "#1D4ED8" },
  CANCELLED: { bg: "#FEE2E2", text: "#B91C1C", strike: true },
  SKIPPED: { bg: "#FEE2E2", text: "#B91C1C", strike: true },
}

// COMPLETED beats SCHEDULED beats a cancellation when a day has more than one.
const PRIORITY: Record<string, number> = { COMPLETED: 3, SCHEDULED: 2, CANCELLED: 1, SKIPPED: 1 }

export function MiniCalendar({ month, cleans }: { month: string; cleans: Array<{ date: string | Date; status: string }> }) {
  const [y, m] = month.split("-").map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const leadBlanks = new Date(y, m - 1, 1).getDay()

  const byDay = new Map<number, string>()
  for (const c of cleans) {
    const d = c.date instanceof Date ? c.date : new Date(c.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m - 1) continue
    const day = d.getDate()
    const prev = byDay.get(day)
    if (!prev || (PRIORITY[c.status] || 0) > (PRIORITY[prev] || 0)) byDay.set(day, c.status)
  }

  const today = new Date()
  const isThisMonth = today.getFullYear() === y && today.getMonth() === m - 1
  const cells: Array<number | null> = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[8px] font-medium text-stone-400">
        {DOW.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="h-6" />
          const status = byDay.get(day)
          const sc = status ? STATUS_COLOR[status] : null
          const isToday = isThisMonth && today.getDate() === day
          return (
            <div key={i} className="flex h-6 items-center justify-center rounded text-[10px] tabular-nums"
              style={sc ? { background: sc.bg, color: sc.text, fontWeight: 600 } : { color: "#A8A29E" }}>
              <span
                className={isToday ? "flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-stone-900" : ""}
                style={sc?.strike ? { textDecoration: "line-through" } : undefined}
              >
                {day}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
