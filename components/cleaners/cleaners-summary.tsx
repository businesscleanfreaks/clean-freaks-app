"use client"

import { useState } from "react"
import { Check, ChevronRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

export interface SummaryTotals {
  readyNow: number
  stillOwed: number
  unpaidJobs: number
  paidSoFar: number
}

export interface PaymentRow {
  id: string
  name: string
  amount: number
  date: string
  detail: string
}

const LABEL = "text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#7e8489]"
const VALUE = "mt-[3px] text-[21px] font-extrabold tracking-[-0.02em] tabular-nums"

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

/**
 * The three numbers at the top of the Cleaners page.
 *
 * "Paid so far" is a button: clicking it drops the log of what actually went
 * out, so the total is checkable rather than something to take on trust.
 */
export function CleanersSummary({ totals, cleanerCount, payments }: {
  totals: SummaryTotals
  cleanerCount: number
  payments: PaymentRow[]
}) {
  const [logOpen, setLogOpen] = useState(false)

  const owed = totals.readyNow + totals.stillOwed
  const total = owed + totals.paidSoFar
  const pct = total > 0 ? Math.round((totals.paidSoFar / total) * 100) : 0

  return (
    <>
      <div
        className="mt-5 flex items-stretch rounded-[12px] border border-[#ececea] bg-white py-[13px]"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }}
      >
        <div className="min-w-0 px-5" style={{ flex: 1.15 }}>
          <div className={LABEL}>Left to pay cleaners &amp; vendors</div>
          <div className={`${VALUE} text-[#0b7a4e]`}>{formatCurrency(owed)}</div>
          <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[#eef0ec]">
            <div className="h-full rounded-full bg-[#0b7a4e]" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="w-px flex-none bg-[#f0f0ed]" />

        <button
          type="button"
          onClick={() => setLogOpen(v => !v)}
          title="Show payments sent"
          className="-my-[13px] min-w-0 flex-1 px-5 py-[13px] text-left transition-colors hover:bg-[#fafaf8]"
        >
          <div className={LABEL}>Paid so far</div>
          <div className={`${VALUE} text-[#101828]`}>{formatCurrency(totals.paidSoFar)}</div>
          <div
            className="mt-[5px] flex items-center gap-1 overflow-hidden whitespace-nowrap text-[11.5px] font-semibold"
            style={{ color: payments.length > 0 ? "#0b7a4e" : "#8a8f93" }}
          >
            {payments.length > 0
              ? `${payments.length} payment${payments.length === 1 ? "" : "s"} · view`
              : "No payments yet"}
            {payments.length > 0 && (
              <ChevronRight
                size={11}
                strokeWidth={2.6}
                className="transition-transform"
                style={{ transform: logOpen ? "rotate(90deg)" : "none" }}
              />
            )}
          </div>
        </button>

        <div className="w-px flex-none bg-[#f0f0ed]" />

        <div className="min-w-0 flex-1 px-5">
          <div className={LABEL}>Total owed this month</div>
          <div className={`${VALUE} text-[#101828]`}>{formatCurrency(owed)}</div>
          <div className="mt-[5px] truncate text-[11.5px] text-[#8a8f93]">
            {totals.unpaidJobs} unpaid job{totals.unpaidJobs === 1 ? "" : "s"} · {cleanerCount} cleaner
            {cleanerCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {logOpen && (
        <div
          className="mt-2 rounded-[12px] border border-[#ececea] bg-white px-5 py-1"
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}
        >
          {payments.map(p => (
            <div key={p.id} className="flex items-center gap-3 border-b border-[#f6f6f3] py-3 last:border-b-0">
              <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-[#e9f7ef]">
                <Check size={11} strokeWidth={3} color="#1f9d57" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-[#6b6f73]">{p.name}</div>
                <div className="mt-px truncate text-[11.5px] text-[#6b6f73]">{p.detail}</div>
              </div>
              <span className="w-[46px] flex-none text-right text-[11.5px] font-semibold tabular-nums text-[#6b6f73]">
                {shortDate(p.date)}
              </span>
              <span className="flex-none text-[13.5px] font-bold tabular-nums text-[#8a8f93]">
                {formatCurrency(p.amount)}
              </span>
            </div>
          ))}
          {payments.length === 0 && (
            <div className="py-3.5 text-[12.5px] text-[#8a8f93]">No payments sent yet this month.</div>
          )}
        </div>
      )}
    </>
  )
}
