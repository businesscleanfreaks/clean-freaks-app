"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Settings } from "lucide-react"
import { CleanersTable } from "./cleaners-table"
import { PayScheduleModal } from "./pay-schedule-modal"

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return `${FULL_MONTHS[m - 1]} ${y}`
}

const shiftPeriod = (period: string, by: number) => {
  const [y, m] = period.split("-").map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

const STEP =
  "grid h-6 w-6 flex-none place-items-center rounded-[7px] border border-[#e2e2df] bg-white text-[#6b6f73] hover:bg-[#f6f6f3] disabled:opacity-30"

/**
 * The Cleaners page — who we owe, gated on their invoices and the client's
 * money.
 */
export function CleanersPage() {
  const [period, setPeriod] = useState(thisMonth())
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [pickYear, setPickYear] = useState(() => Number(thisMonth().slice(0, 4)))

  const isCurrent = period >= thisMonth()

  useEffect(() => {
    if (!pickOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pickOpen])

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold leading-none tracking-[-0.025em]">Cleaners</h1>
          <div className="mt-1 text-[13px] font-semibold text-[#7e8489]">Cleaner profiles &amp; payables</div>

          <div className="relative mt-[5px] flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPeriod(p => shiftPeriod(p, -1))}
              aria-label="Previous month"
              className={STEP}
            >
              <ChevronLeft size={12} strokeWidth={2.6} />
            </button>

            <span className="relative flex-none">
              <button
                type="button"
                onClick={() => { setPickYear(Number(period.slice(0, 4))); setPickOpen(v => !v) }}
                title="Pick a month"
                className="inline-flex min-w-[96px] items-center justify-center gap-[5px] rounded-[7px] px-1.5 py-0.5 text-[13.5px] font-bold text-[#3f4347] hover:bg-[#f6f6f3]"
              >
                {monthLabel(period)}
                <ChevronDown size={10} strokeWidth={2.8} className="text-[#8a8f93]" />
              </button>

              {pickOpen && (
                <>
                  <div className="fixed inset-0 z-[59]" onClick={() => setPickOpen(false)} />
                  <div
                    className="absolute top-[calc(100%+6px)] z-[60] w-[216px] rounded-[12px] border border-[#e2e2df] bg-white p-2.5"
                    style={{
                      left: "50%",
                      marginLeft: -108,
                      boxShadow: "0 4px 10px rgba(16,24,40,.06), 0 16px 40px rgba(16,24,40,.14)",
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setPickYear(y => y - 1)}
                        aria-label="Previous year"
                        className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e2e2df] bg-white text-[#6b6f73] hover:bg-[#f6f6f3]"
                      >
                        <ChevronLeft size={11} strokeWidth={2.6} />
                      </button>
                      <span className="text-[13.5px] font-extrabold tabular-nums text-[#0d0d0e]">{pickYear}</span>
                      <button
                        type="button"
                        onClick={() => setPickYear(y => y + 1)}
                        aria-label="Next year"
                        className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e2e2df] bg-white text-[#6b6f73] hover:bg-[#f6f6f3]"
                      >
                        <ChevronRight size={11} strokeWidth={2.6} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {SHORT_MONTHS.map((label, i) => {
                        const p = `${pickYear}-${String(i + 1).padStart(2, "0")}`
                        const active = p === period
                        const future = p > thisMonth()
                        return (
                          <button
                            key={label}
                            type="button"
                            disabled={future}
                            onClick={() => { setPeriod(p); setPickOpen(false) }}
                            className="rounded-[7px] py-1.5 text-[12px] font-bold hover:bg-[#eef6f1] disabled:opacity-30 disabled:hover:bg-transparent"
                            style={active ? { background: "#0b7a4e", color: "#fff" } : { color: "#3f4347" }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </span>

            <button
              type="button"
              onClick={() => setPeriod(p => shiftPeriod(p, 1))}
              disabled={isCurrent}
              aria-label="Next month"
              className={STEP}
            >
              <ChevronRight size={12} strokeWidth={2.6} />
            </button>
          </div>
        </div>

        {/* Where pay-by day and "invoices us" get set · the two settings that
            decide what the table calls ready. */}
        <button
          type="button"
          onClick={() => setScheduleOpen(true)}
          className="inline-flex flex-none items-center gap-2 rounded-[8px] border border-[#e2e2df] bg-white px-4 py-2.5 text-[13px] font-bold text-[#3f4347] hover:bg-[#f6f6f3]"
        >
          <Settings size={15} /> Pay schedule
        </button>
      </div>

      <CleanersTable period={period} />

      <PayScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} />
    </div>
  )
}
