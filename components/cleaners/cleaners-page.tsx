"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CleanersTable } from "./cleaners-table"

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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

/**
 * The Cleaners page — who we owe, gated on their invoices and the client's
 * money. Built beside the existing Payables page rather than replacing it, so
 * the numbers can be compared before the nav is pointed here.
 */
export function CleanersPage() {
  const [period, setPeriod] = useState(thisMonth())
  const isCurrent = period >= thisMonth()

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="m-0 text-[30px] font-extrabold leading-none tracking-[-0.025em]">Cleaners</h1>
          <p className="mt-1 text-[13px] font-semibold text-[#7e8489]">Cleaner profiles &amp; payables</p>
        </div>

        <div className="flex h-11 flex-none items-center rounded-lg border border-[#e2e2df] bg-white">
          <button
            type="button"
            onClick={() => setPeriod(p => shiftPeriod(p, -1))}
            aria-label="Previous month"
            className="grid h-full w-10 place-items-center border-r border-[#f0f0ed] text-stone-500 hover:bg-[#f6f6f3]"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[128px] px-3 text-center text-[13.5px] font-bold">
            {monthLabel(period)}
          </span>
          <button
            type="button"
            onClick={() => setPeriod(p => shiftPeriod(p, 1))}
            disabled={isCurrent}
            aria-label="Next month"
            className="grid h-full w-10 place-items-center border-l border-[#f0f0ed] text-stone-500 hover:bg-[#f6f6f3] disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <CleanersTable period={period} />
    </div>
  )
}
