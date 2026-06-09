"use client"

import { useState } from "react"
import useSWR from "swr"
import { formatCurrency } from "@/lib/utils"

const fetcher = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))

interface ProrationRow {
  locationId: string
  locationName: string
  flatRate: number
  expected: number
  actual: number
  missed: number
  perClean: number
  credit: number
}

function monthLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

/**
 * Proration card for the Billing tab: when a flat-rate client missed cleans this
 * month (e.g. a pause), show the suggested per-location credit. Display + review
 * for now — auto-applying to the invoice is the next step.
 */
export function ProrationCard({ clientId }: { clientId: string }) {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const { data } = useSWR<{ rows: ProrationRow[]; totalCredit: number }>(
    `/api/clients/${clientId}/proration?month=${month}`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [on, setOn] = useState(true)

  const rows = data?.rows || []
  if (rows.length === 0) return null // nothing to prorate this month

  const total = on ? data!.totalCredit : 0

  return (
    <section className="rounded-[10px] bg-white" style={{ border: "1px solid #FDE68A" }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-600">Proration · {monthLabel()}</span>
        <button
          onClick={() => setOn((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700"
          title={on ? "Disable proration credit" : "Enable proration credit"}
        >
          Prorate missed cleans
          <span className="relative inline-block h-4 w-7 rounded-full transition-colors" style={{ background: on ? "#D97706" : "#D4D4D8" }}>
            <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style={{ left: on ? 14 : 2 }} />
          </span>
        </button>
      </div>
      <div className="px-5 pb-4">
        {rows.map((r) => <ProrationRowView key={r.locationId} row={r} enabled={on} />)}
        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 text-[13px]">
          <span className="font-semibold text-zinc-700">Total credit</span>
          <span className="font-mono font-semibold" style={{ color: total > 0 ? "#BE123C" : "#A1A1AA" }}>
            {total > 0 ? `−${formatCurrency(total)}` : formatCurrency(0)}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">
          Credit for cleans missed this month (e.g. a paused week). Shown for review — confirm before it goes on the invoice.
        </p>
      </div>
    </section>
  )
}

function ProrationRowView({ row, enabled }: { row: ProrationRow; enabled: boolean }) {
  const [showMath, setShowMath] = useState(false)
  return (
    <div className="border-b border-zinc-50 py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-zinc-800">{row.locationName}</div>
          <div className="text-[11px] text-zinc-400">{row.missed} missed · {row.actual} of {row.expected} cleans</div>
        </div>
        <div
          className="font-mono text-[13px] font-semibold"
          style={{ color: enabled ? "#BE123C" : "#A1A1AA", textDecoration: enabled ? "none" : "line-through" }}
        >
          −{formatCurrency(row.credit)}
        </div>
      </div>
      <button onClick={() => setShowMath((v) => !v)} className="mt-1 text-[10px] text-zinc-400 underline decoration-dotted hover:text-zinc-600">
        {showMath ? "Hide math" : "Show math"}
      </button>
      {showMath && (
        <div className="mt-1 rounded bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-500">
          {formatCurrency(row.flatRate)}/mo ÷ {row.expected} expected = {formatCurrency(Math.round(row.perClean))}/clean × {row.missed} missed = {formatCurrency(row.credit)}
        </div>
      )}
    </div>
  )
}
