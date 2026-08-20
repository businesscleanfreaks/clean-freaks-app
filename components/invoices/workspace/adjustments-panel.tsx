"use client"

import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { X, Check, PlusCircle, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showError } from "@/lib/toast"
import {
  MODE_LABELS, MODES_WITH_DAY, PCT_PRESETS, ADJUSTMENT_MODES,
  perCleanValue, pctOffAmount, signedAmount, adjustmentsTotal, adjustedTotal,
  sendBlockedReason, isCharge,
  type Adjustment, type AdjustmentMode,
} from "@/lib/invoice-adjustments"

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

export interface AdjustmentsPanelProps {
  candidateId: string
  clientId: string
  period: string
  baseTotal: number
  billingType: string
  cleanCount: number
  /** Lets the parent gate its send button and show the live total. */
  onChange?: (state: { adjustments: Adjustment[]; adjustedTotal: number; blockedReason: string | null }) => void
}

export function AdjustmentsPanel({
  candidateId, clientId, period, baseTotal, billingType, cleanCount, onChange,
}: AdjustmentsPanelProps) {
  const key = `/api/invoices/adjustments?candidateId=${encodeURIComponent(candidateId)}&period=${period}`
  const { data, mutate, isLoading } = useSWR<{ adjustments: Adjustment[] }>(key, fetcher, { revalidateOnFocus: false })
  const adjustments = useMemo(() => data?.adjustments ?? [], [data])

  const [formOpen, setFormOpen] = useState(false)
  const [mode, setMode] = useState<AdjustmentMode>("COURTESY")
  const [amount, setAmount] = useState("")
  const [label, setLabel] = useState("")
  const [day, setDay] = useState("")
  const [pct, setPct] = useState(10)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const perClean = perCleanValue({ billingType, total: baseTotal, cleanCount })

  // Draft amount so the total updates in real time as the operator types.
  const draftSigned = mode === "PCT_OFF" ? -pctOffAmount(perClean, pct) : signedAmount(mode, amount)
  const draftList: Adjustment[] = draftSigned !== null && formOpen
    ? [...adjustments, { id: "__draft", mode, label: label || MODE_LABELS[mode], amount: draftSigned, serviceDay: null, approved: true }]
    : adjustments

  const liveTotal = adjustedTotal(baseTotal, draftList)
  const blockedReason = sendBlockedReason(adjustments)

  // Report upward without causing a render loop: only when the value changes.
  const lastReported = useRef("")
  const snapshot = JSON.stringify({ n: adjustments.length, t: adjustedTotal(baseTotal, adjustments), blockedReason })
  if (snapshot !== lastReported.current) {
    lastReported.current = snapshot
    onChange?.({ adjustments, adjustedTotal: adjustedTotal(baseTotal, adjustments), blockedReason })
  }

  const openForm = () => {
    setFormOpen(true)
    // The design asks that a just-opened control never sit below the fold.
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50)
  }

  const reset = () => { setFormOpen(false); setAmount(""); setLabel(""); setDay(""); setPct(10); setMode("COURTESY") }

  const apply = async () => {
    const finalAmount = mode === "PCT_OFF" ? String(pctOffAmount(perClean, pct)) : amount
    if (signedAmount(mode, finalAmount) === null) {
      showError("Enter an amount greater than zero.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/invoices/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId, clientId, period, mode, label,
          amount: finalAmount,
          serviceDay: day ? Number(day) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not add it")
      }
      reset()
      await mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not add it")
    } finally {
      setBusy(false)
    }
  }

  const setApproved = async (adj: Adjustment, approved: boolean) => {
    const optimistic = adjustments.map(a => (a.id === adj.id ? { ...a, approved } : a))
    mutate({ adjustments: optimistic }, false)
    try {
      const res = await fetch(`/api/invoices/adjustments/${adj.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      })
      if (!res.ok) throw new Error("Could not update")
      mutate()
    } catch { showError("Could not update"); mutate() }
  }

  const remove = async (adj: Adjustment) => {
    mutate({ adjustments: adjustments.filter(a => a.id !== adj.id) }, false)
    try {
      const res = await fetch(`/api/invoices/adjustments/${adj.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not remove")
      mutate()
    } catch { showError("Could not remove"); mutate() }
  }

  return (
    <section className="rounded-[10px] border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-stone-400">Adjustments</span>
        {adjustments.length > 0 && (
          <span className="text-[12px] font-bold tabular-nums text-stone-600">
            {adjustmentsTotal(adjustments) >= 0 ? "+" : ""}{formatCurrency(adjustmentsTotal(adjustments))}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6 text-stone-300"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : adjustments.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-stone-500">No credits or charges on this invoice.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {adjustments.map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-stone-100 px-2.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-stone-800">{a.label}</span>
                <span className="block text-[11px] text-stone-400">
                  {MODE_LABELS[a.mode as AdjustmentMode] ?? a.mode}
                  {a.serviceDay ? ` · day ${a.serviceDay}` : ""}
                </span>
              </span>
              <span className={`flex-none text-[12.5px] font-bold tabular-nums ${a.amount < 0 ? "text-[#15793f]" : "text-stone-800"}`}>
                {a.amount < 0 ? "" : "+"}{formatCurrency(a.amount)}
              </span>
              <button
                type="button"
                onClick={() => setApproved(a, !a.approved)}
                title={a.approved ? "Approved · click to undo" : "Approve this adjustment"}
                className={`flex-none rounded-md px-2 py-1 text-[11.5px] font-bold transition-colors ${
                  a.approved
                    ? "bg-[#eaf5ee] text-[#15793f]"
                    : "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                {a.approved ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />Approved</span> : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Remove ${a.label}`}
                className="flex-none rounded p-1 text-stone-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {blockedReason && (
        <p className="mt-2 text-[11.5px] font-semibold text-amber-700">{blockedReason}</p>
      )}

      {formOpen ? (
        <div
          ref={formRef}
          className="mt-3 rounded-[14px] p-[14px_15px]"
          style={{ border: "1.5px solid #dcdff2", background: "#fafbff", padding: "14px 15px" }}
        >
          <div className="mb-[11px] text-[14px] font-bold" style={{ color: "#3b4380" }}>
            Add a credit or charge
          </div>
          <div className="flex flex-wrap gap-[7px]">
            {ADJUSTMENT_MODES.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setAmount(m === "COMP" ? String(perClean) : "") }}
                className="rounded-[20px] px-3 py-1.5 text-[12px] font-bold transition-colors"
                style={
                  mode === m
                    ? { background: "#4f46e5", color: "#fff", border: "1.5px solid #4f46e5" }
                    : { background: "#fff", color: "#4b5563", border: "1.5px solid #d7dbe0" }
                }
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {mode === "PCT_OFF" && (
            <div className="mt-2.5">
              <div className="flex gap-1.5">
                {PCT_PRESETS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPct(p)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-bold transition-colors ${
                      pct === p ? "border-indigo-600 bg-indigo-600 text-white" : "border-stone-300 bg-white text-stone-600"
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-stone-500">
                −{formatCurrency(pctOffAmount(perClean, pct))} off the {formatCurrency(perClean)} clean
              </p>
            </div>
          )}

          {MODES_WITH_DAY.includes(mode) && (
            <input
              value={day}
              onChange={e => setDay(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="Day of month (optional)"
              className="mt-2.5 w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-500"
            />
          )}

          {mode !== "PCT_OFF" && (
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              type="text"
              inputMode="decimal"
              placeholder="Amount, e.g. $120"
              className="mt-2.5 w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-500"
            />
          )}

          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={isCharge(mode) ? "e.g. Consumables · paper towels, liners" : "e.g. Courtesy credit · June"}
            className="mt-2 w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-500"
          />

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-stone-500">
              Invoice becomes <span className="font-bold tabular-nums text-stone-800">{formatCurrency(liveTotal)}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={reset} className="rounded-md px-2.5 py-1.5 text-[12px] font-bold text-stone-500 hover:bg-stone-200">
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-[9px] px-4 py-[9px] text-[12.5px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-50"
                style={{ background: "#4f46e5" }}
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {isCharge(mode) ? "Add charge" : "Add credit"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openForm}
          className="mt-2.5 inline-flex items-center gap-[7px] text-[12.5px] font-bold transition-opacity hover:opacity-80"
          style={{ color: "#4f46e5" }}
        >
          <PlusCircle className="h-[13px] w-[13px]" />
          Add credit, discount, or charge
        </button>
      )}
    </section>
  )
}
