"use client"

import { formatCurrency } from "@/lib/utils"

export interface SummaryTotals {
  readyNow: number
  stillOwed: number
  unpaidJobs: number
}

/**
 * The three numbers at the top of the Cleaners page.
 *
 * "Left to pay" is what can actually go out today; "still owed" is what is
 * waiting on an invoice or a date. Keeping them apart is the point — one total
 * would hide whether the hold-up is paperwork or the calendar.
 */
export function CleanersSummary({ totals, cleanerCount }: {
  totals: SummaryTotals
  cleanerCount: number
}) {
  const owed = totals.readyNow + totals.stillOwed
  const pct = owed > 0 ? Math.round((totals.readyNow / owed) * 100) : 0

  return (
    <div
      className="mt-4 grid grid-cols-1 overflow-clip rounded-[12px] border border-[#ececea] bg-white sm:grid-cols-3"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }}
    >
      <div className="px-5 py-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#98a2b3]">
          Ready to pay now
        </div>
        <div className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#0b7a4e]">
          {formatCurrency(totals.readyNow)}
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[#eef6f1]">
          <div className="h-full rounded-full bg-[#0b7a4e]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="border-t border-[#f0f0ed] px-5 py-4 sm:border-l sm:border-t-0">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#98a2b3]">
          Waiting on an invoice or a date
        </div>
        <div className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#3f4347]">
          {formatCurrency(totals.stillOwed)}
        </div>
        <div className="mt-1 text-[11.5px] font-semibold text-[#9a9fa4]">
          Not blocked on you
        </div>
      </div>

      <div className="border-t border-[#f0f0ed] px-5 py-4 sm:border-l sm:border-t-0">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#98a2b3]">
          Total owed this month
        </div>
        <div className="mt-1.5 text-[21px] font-extrabold tabular-nums text-[#0d0d0e]">
          {formatCurrency(owed)}
        </div>
        <div className="mt-1 text-[11.5px] font-semibold text-[#9a9fa4]">
          {totals.unpaidJobs} unpaid job{totals.unpaidJobs === 1 ? "" : "s"} · {cleanerCount} cleaner
          {cleanerCount === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  )
}
