"use client"

import { useState } from "react"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showError, showSuccess, showUndoToast } from "@/lib/toast"
import { consumableSummary, validateConsumable } from "@/lib/consumables"
import { parseAmount } from "@/lib/new-invoice"

interface Entry {
  id: string
  description: string | null
  billAmount: number
  paybackAmount: number
}

/**
 * Consumables bought on this visit.
 *
 * Entered where they happened, so the amount and the date are whatever actually
 * occurred rather than something reconstructed at invoice time. What is billed
 * goes on the client's next unsent invoice as a dated line; what is paid back
 * lands in the cleaner's payables.
 *
 * The payback mirrors the charge until it is touched — most restocks are billed
 * on and reimbursed in full, so that is one number, not two.
 */
export function VisitConsumables({ jobId, cleanerName, locked }: {
  jobId: string
  /** Whoever worked the visit · who a payback would go to. */
  cleanerName: string | null
  locked?: boolean
}) {
  const { data, mutate } = useSWR<{ consumables: Entry[] }>(
    `/api/consumables?kind=ADHOC&jobId=${jobId}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState("")
  const [bill, setBill] = useState("")
  const [payback, setPayback] = useState("")
  const [paybackTouched, setPaybackTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const entries = data?.consumables ?? []
  const first = (cleanerName || "").split(/\s+/)[0]
  const billNum = parseAmount(bill)
  const payNum = paybackTouched ? parseAmount(payback) : billNum

  const reset = () => {
    setOpen(false); setWhat(""); setBill(""); setPayback(""); setPaybackTouched(false)
  }

  const add = async () => {
    const problem = validateConsumable({ bill: billNum, payback: payNum })
    if (problem) { showError(problem); return }
    setBusy(true)
    try {
      const res = await fetch("/api/consumables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ADHOC",
          jobId,
          description: what.trim() || null,
          billAmount: billNum,
          paybackAmount: payNum,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not add it")
      const bits: string[] = []
      if (billNum > 0) bits.push(`${formatCurrency(billNum)} on the next invoice`)
      if (payNum > 0 && first) bits.push(`${first} gets ${formatCurrency(payNum)} back`)
      showSuccess(`Consumables · ${bits.join(" · ")}`)
      reset()
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not add it")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: Entry) => {
    try {
      const res = await fetch(`/api/consumables/${entry.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not remove it")
      showUndoToast("Consumables entry removed", async () => {
        await fetch("/api/consumables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "ADHOC",
            jobId,
            description: entry.description,
            billAmount: entry.billAmount,
            paybackAmount: entry.paybackAmount,
          }),
        }).catch(() => null)
        mutate()
      })
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not remove it")
    }
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">CONSUMABLES</p>
        {!open && !locked && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto text-[11.5px] font-bold text-[#0f766e] hover:underline"
          >
            ＋ Add
          </button>
        )}
      </div>

      {entries.map(e => (
        <div key={e.id} className="flex items-center gap-2 px-0.5 py-1">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#334155]">
            {e.description || "Consumables"}
          </span>
          <span className="flex-none text-[10px] font-bold uppercase tracking-[0.03em] text-[#7f8ea3]">
            {[
              e.billAmount > 0 ? `bill ${formatCurrency(e.billAmount)}` : null,
              e.paybackAmount > 0 ? `pay ${formatCurrency(e.paybackAmount)}` : null,
            ].filter(Boolean).join(" · ")}
          </span>
          {!locked && (
            <button
              type="button"
              onClick={() => remove(e)}
              title="Remove this entry"
              aria-label={`Remove ${e.description || "consumables entry"}`}
              className="grid h-[18px] w-[18px] flex-none place-items-center text-[13px] leading-none text-[#b6c2cf] hover:text-[#64748b]"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {open && (
        <div className="rounded-[9px] border border-[#e8ecf1] bg-white px-2.5 py-[9px]">
          <input
            value={what}
            onChange={e => setWhat(e.target.value)}
            placeholder="Towels, soap…"
            autoFocus
            className="w-full rounded-[7px] border border-[#e8ecf1] px-2.5 py-[7px] text-[12.5px] outline-none focus:border-[#0d9488]"
          />
          <div className="mt-2 flex gap-2">
            <label className="min-w-0 flex-1 text-[9.5px] font-semibold text-[#7f8ea3]">
              Bill client
              <div className="mt-[3px] flex items-center rounded-[8px] border border-[#e8ecf1] px-2">
                <span className="text-[#7f8ea3]">$</span>
                {/* Text + decimal, never `type=number`: a number input changes
                    value on scroll, silently rewriting money already entered. */}
                <input
                  value={bill}
                  onChange={e => setBill(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent px-[3px] py-[7px] text-[13px] font-bold outline-none"
                />
              </div>
            </label>
            <label className="min-w-0 flex-1 text-[9.5px] font-semibold text-[#7f8ea3]">
              Pay {first || "cleaner"} back
              <div className="mt-[3px] flex items-center rounded-[8px] border border-[#e8ecf1] px-2">
                <span className="text-[#7f8ea3]">$</span>
                <input
                  value={paybackTouched ? payback : (billNum ? String(billNum) : "")}
                  onChange={e => { setPaybackTouched(true); setPayback(e.target.value) }}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!cleanerName}
                  className="min-w-0 flex-1 bg-transparent px-[3px] py-[7px] text-[13px] font-bold outline-none disabled:text-[#b6c2cf]"
                />
              </div>
            </label>
          </div>

          <div className="mt-[9px] flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[10.5px] leading-[1.4] text-[#7f8ea3]">
              {consumableSummary(billNum, payNum, first)}
            </span>
            <button
              type="button"
              onClick={reset}
              className="flex-none px-1 py-[5px] text-[11.5px] font-semibold text-[#7f8ea3]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={busy || (billNum <= 0 && payNum <= 0)}
              className="flex-none rounded-[7px] px-3 py-[5px] text-[12px] font-bold text-white"
              style={{ background: billNum > 0 || payNum > 0 ? "#0d9488" : "#cbd5e1" }}
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
