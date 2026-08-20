"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return `${MONTHS_LONG[m - 1] ?? month} ${y}`
}

/**
 * Month picker for the ledger: a year to page through and twelve months to
 * choose from, so jumping back to March is one click instead of five presses
 * of the back arrow.
 */
export function MonthPicker({ month, onChange }: {
  /** YYYY-MM */
  month: string
  onChange: (month: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number(month.split("-")[0]))
  const ref = useRef<HTMLDivElement>(null)

  // Reopen on the year you are actually looking at, not the last one browsed.
  useEffect(() => { if (open) setYear(Number(month.split("-")[0])) }, [open, month])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const [selectedYear, selectedMonth] = month.split("-").map(Number)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label="Choose month"
        className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[13.5px] font-bold tabular-nums text-[#101828] transition-colors hover:bg-[#f2f4f7]"
      >
        {monthLabel(month)}
        <ChevronDown className="h-3.5 w-3.5 text-[#98a2b3]" />
      </button>

      {open && (
        <div className="absolute left-0 top-[38px] z-40 w-[302px] rounded-[15px] border border-[#e6e8ec] bg-white p-[15px] shadow-[0_14px_44px_rgba(16,24,40,.17)]">
          <div className="mb-[13px] flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYear(y => y - 1)}
              aria-label="Previous year"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#667085] transition-colors hover:bg-[#f2f4f7]"
            >
              <ChevronLeft className="h-[15px] w-[15px]" />
            </button>
            <span className="text-[14px] font-extrabold tabular-nums tracking-[0.01em] text-[#101828]">{year}</span>
            <button
              type="button"
              onClick={() => setYear(y => y + 1)}
              aria-label="Next year"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#667085] transition-colors hover:bg-[#f2f4f7]"
            >
              <ChevronRight className="h-[15px] w-[15px]" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-[5px]">
            {MONTHS_SHORT.map((label, i) => {
              const active = year === selectedYear && i + 1 === selectedMonth
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    onChange(`${year}-${String(i + 1).padStart(2, "0")}`)
                    setOpen(false)
                  }}
                  className="rounded-[8px] py-2 text-[12.5px] font-bold transition-colors"
                  style={
                    active
                      ? { background: "#15793f", color: "#fff" }
                      : { color: "#475467" }
                  }
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f2f4f7" }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
