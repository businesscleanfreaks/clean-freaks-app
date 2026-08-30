"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { X, Loader2 } from "lucide-react"
import { showError } from "@/lib/toast"
import { ConsumablesCell, type ConsumableRow } from "./consumables-cell"
import { BillingSections } from "./billing-sections"
import {
  CADENCES, CADENCE_LABELS,
  TERMS, TERM_LABELS,
  PAY_METHODS, PAY_METHOD_LABELS,
  DELIVERY, DELIVERY_LABELS,
  locationPillLabel,
  type BillingScheduleRow,
} from "@/lib/billing-schedule"

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

const selectCls =
  "w-full rounded-[8px] border border-[#e4e7ec] bg-white px-2 py-1.5 text-[12px] font-semibold text-[#101828] outline-none focus:border-[#15793f]"

/** Segmented control used for the two-option client type. */
function Segmented({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[8px] bg-[#f2f4f7] p-0.5">
      {options.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-[6px] px-2 py-1 text-[11.5px] font-bold transition-colors ${
              active ? "bg-white text-[#101828] shadow-sm" : "text-[#7d8795] hover:text-[#475467]"
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Billing schedule sheet — per-client billing rules.
 *
 * Each control saves immediately (optimistic, with a rollback on failure);
 * there is no page-level save button because every row is independent.
 */
export function BillingScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: consData, mutate: mutateCons } = useSWR<{ consumables: ConsumableRow[] }>(
    open ? "/api/consumables?kind=RECURRING" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const consByClient = useMemo(() => {
    const m = new Map<string, ConsumableRow>()
    for (const c of consData?.consumables ?? []) {
      if (c.clientId) m.set(c.clientId, c)
    }
    return m
  }, [consData])

  const { data, isLoading, mutate } = useSWR<{ rows: BillingScheduleRow[] }>(
    open ? "/api/settings/billing-schedule" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [savingId, setSavingId] = useState<string | null>(null)

  // Drives the "Applies to N clients" lines in the one-time job defaults.
  const clientCounts = useMemo(() => {
    const rows = data?.rows ?? []
    return {
      residential: rows.filter(r => r.clientType === "RESIDENTIAL").length,
      commercial: rows.filter(r => r.clientType !== "RESIDENTIAL").length,
    }
  }, [data])

  if (!open) return null
  const rows = data?.rows ?? []

  const patch = async (row: BillingScheduleRow, changes: Record<string, unknown>) => {
    setSavingId(row.id)
    // Optimistic: reflect the change straight away, roll back if the save fails.
    const optimistic = rows.map(r => (r.id === row.id ? { ...r, ...changes } : r))
    mutate({ rows: optimistic }, false)
    try {
      const res = await fetch("/api/settings/billing-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: row.id, ...changes }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not save")
      }
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save")
      mutate()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      {/* Centred, as the design has it: this is a settings dialog you come back
          out of, not a side panel you work alongside the ledger. */}
      <div className="fixed inset-0 z-40 bg-[#101828]/25" onClick={onClose} />
      <aside className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[1000px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[16px] border border-[#e4e7ec] bg-white shadow-[0_24px_64px_rgba(16,24,40,.24)]">
        <div className="flex items-start gap-3 border-b border-[#eef0f3] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold tracking-[-0.01em] text-[#101828]">Billing schedule</div>
            <div className="mt-0.5 text-[11.5px] text-[#7d8795]">
              How each client is invoiced. Changes apply to the next invoice.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close billing schedule"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-[#98a2b3] transition-colors hover:bg-[#f2f4f7] hover:text-[#475467]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <BillingSections clientCounts={clientCounts} />

          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-[#98a2b3]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-20 text-center text-[13px] text-[#7d8795]">No active clients.</div>
          ) : (
            <div className="min-w-[840px]">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(150px,1fr)_150px_130px_100px_120px_130px_120px] items-center gap-3 border-b border-[#eef0f3] bg-[#fbfcfd] px-5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">
                <span>Client</span>
                <span>Client type</span>
                {/* The design requires this exact header wording. */}
                <span>Invoicing cadence</span>
                <span>Terms</span>
                <span>How they pay</span>
                <span>How we bill</span>
                <span title="A flat consumables charge on every invoice · on/off anytime · applies to invoices not sent yet, sent ones never change">
                  Consumables
                </span>
              </div>

              {rows.map(row => {
                const pill = locationPillLabel(row)
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(150px,1fr)_150px_130px_100px_120px_130px_120px] items-center gap-3 border-b border-[#f4f5f7] px-5 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-[#101828]">
                        {row.name}
                        {savingId === row.id && (
                          <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-[#98a2b3]" />
                        )}
                      </div>
                      {pill && (
                        <button
                          type="button"
                          onClick={() => patch(row, { separateLocationInvoices: !row.separateLocationInvoices })}
                          title="Click to switch. Applies from the next period."
                          className="mt-1 truncate rounded-full bg-[#eaf0fa] px-2 py-0.5 text-[10.5px] font-bold text-[#3a66b0] transition-colors hover:bg-[#dde7f6]"
                        >
                          {pill}
                        </button>
                      )}
                    </div>

                    <Segmented
                      options={[
                        { value: "COMMERCIAL", label: "Commercial" },
                        { value: "RESIDENTIAL", label: "Residential" },
                      ]}
                      value={row.clientType}
                      onChange={v => patch(row, { clientType: v })}
                    />

                    <select
                      aria-label={`Invoicing cadence for ${row.name}`}
                      className={selectCls}
                      value={row.cadence}
                      onChange={e => patch(row, { cadence: e.target.value })}
                    >
                      {CADENCES.map(c => (
                        <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
                      ))}
                    </select>

                    <select
                      aria-label={`Terms for ${row.name}`}
                      className={selectCls}
                      value={row.terms ?? ""}
                      onChange={e => patch(row, { terms: e.target.value || null })}
                    >
                      <option value="">Not set</option>
                      {TERMS.map(t => (
                        <option key={t} value={t}>{TERM_LABELS[t]}</option>
                      ))}
                    </select>

                    <select
                      aria-label={`How ${row.name} pays`}
                      className={selectCls}
                      value={row.payMethod ?? ""}
                      onChange={e => patch(row, { payMethod: e.target.value || null })}
                    >
                      <option value="">Not set</option>
                      {PAY_METHODS.map(m => (
                        <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>
                      ))}
                    </select>

                    <select
                      aria-label={`How we bill ${row.name}`}
                      className={selectCls}
                      value={row.delivery}
                      onChange={e => patch(row, { delivery: e.target.value })}
                    >
                      {DELIVERY.map(d => (
                        <option key={d} value={d}>{DELIVERY_LABELS[d]}</option>
                      ))}
                    </select>

                    <ConsumablesCell
                      clientId={row.id}
                      clientName={row.name}
                      cleanerName={row.cleanerName ?? null}
                      current={consByClient.get(row.id) ?? null}
                      onSaved={() => { mutateCons(); mutate() }}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-none border-t border-[#eef0f3] px-5 py-3 text-[11.5px] text-[#7d8795]">
          Client rows save as you change them. The sections above have their own Save changes button.
        </div>
      </aside>
    </>
  )
}
