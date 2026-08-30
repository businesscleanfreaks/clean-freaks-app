"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeftRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showError, showSuccess } from "@/lib/toast"
import { mirroredPayback, validateConsumable } from "@/lib/consumables"
import { parseAmount } from "@/lib/new-invoice"

export interface ConsumableRow {
  id: string
  clientId?: string | null
  billAmount: number
  paybackAmount: number
  subcontractor?: { id: string; name: string } | null
}

/**
 * The Consumables cell on the Billing schedule.
 *
 * One popover sets both sides: what the client is charged on every invoice, and
 * what their cleaner is paid back. The payback mirrors the charge until it is
 * touched, so the common case is one number rather than two.
 *
 * Stopping removes both sides at once, which is the whole reason they live on
 * one record.
 */
export function ConsumablesCell({ clientId, clientName, cleanerName, current, onSaved }: {
  clientId: string
  clientName: string
  /** Whoever cleans for this client · who the payback would go to. */
  cleanerName: string | null
  current: ConsumableRow | null
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const [bill, setBill] = useState("")
  const [payback, setPayback] = useState("")
  const [paybackTouched, setPaybackTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const start = () => {
    const b = anchor.current?.getBoundingClientRect()
    if (b) {
      const W = 300
      setAt({
        top: Math.min(b.bottom + 6, window.innerHeight - 250),
        left: Math.max(8, Math.min(b.left, window.innerWidth - W - 8)),
      })
    }
    setBill(current ? String(current.billAmount) : "")
    setPayback(current ? String(current.paybackAmount) : "")
    setPaybackTouched(!!current && current.paybackAmount !== current.billAmount)
    setOpen(true)
  }

  const effectivePayback = mirroredPayback(parseAmount(bill), paybackTouched, parseAmount(payback))
  const firstName = (cleanerName || "the cleaner").split(/\s+/)[0]

  const save = async () => {
    const draft = { bill: parseAmount(bill), payback: effectivePayback }
    const problem = validateConsumable(draft)
    if (problem) { showError(problem); return }
    setBusy(true)
    try {
      const res = await fetch("/api/consumables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "RECURRING",
          clientId,
          billAmount: draft.bill,
          paybackAmount: draft.payback,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not save")
      const bits: string[] = []
      if (draft.bill > 0) bits.push(`${formatCurrency(draft.bill)} on every invoice not sent yet`)
      if (draft.payback > 0 && cleanerName) bits.push(`${firstName} gets ${formatCurrency(draft.payback)}/mo back`)
      showSuccess(`${clientName} · ${bits.join(" · ")}`)
      setOpen(false)
      onSaved()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!current) return
    setBusy(true)
    try {
      const res = await fetch(`/api/consumables/${current.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not stop it")
      const had = current.paybackAmount
      showSuccess(
        `${clientName} · consumables stopped · comes off any invoice not sent yet` +
        (had > 0 && cleanerName ? ` · ${firstName}'s ${formatCurrency(had)}/mo payback removed too` : ""),
      )
      setOpen(false)
      onSaved()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not stop it")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={anchor}
        type="button"
        onClick={start}
        title={
          current
            ? "Change or stop this consumables charge"
            : "Charge this client for consumables on every invoice · with an optional payback to their cleaner"
        }
        className={
          current
            ? "inline-flex items-center gap-1 rounded-full border border-[#cfe7d8] bg-[#eaf5ee] px-2.5 py-1 text-[11px] font-bold text-[#2f6b47]"
            : "rounded-[8px] border border-dashed border-[#d5dae0] px-2.5 py-[5px] text-[11px] font-bold text-[#98a2b3] hover:border-[#b6bdc6] hover:text-[#6b7480]"
        }
      >
        {current ? (
          <>
            {formatCurrency(current.billAmount)}
            {current.paybackAmount > 0 && (
              <ArrowLeftRight size={10} strokeWidth={2.6} aria-label="payback rides along" />
            )}
          </>
        ) : (
          "＋ Add"
        )}
      </button>

      {current && (
        <button
          type="button"
          onClick={stop}
          disabled={busy}
          title="Stop charging consumables · comes off any invoice not sent yet · removes the cleaner payback too"
          aria-label={`Stop consumables for ${clientName}`}
          className="grid h-5 w-5 place-items-center rounded-[6px] text-[13px] leading-none text-[#b6bdc6] hover:bg-[#f6f6f3] hover:text-[#6b7480]"
        >
          ×
        </button>
      )}

      {open && at && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[96] w-[300px] rounded-[12px] border border-[#e2e2df] bg-white p-3.5"
            style={{ top: at.top, left: at.left, boxShadow: "0 4px 10px rgba(16,24,40,.06), 0 16px 40px rgba(16,24,40,.14)" }}
          >
            <div className="text-[12.5px] font-extrabold">Consumables · {clientName}</div>
            <div className="mt-0.5 text-[11px] text-[#9a9fa4]">
              Goes on every invoice not sent yet. Sent invoices never change.
            </div>

            <label className="mt-3 block text-[11px] font-bold text-[#6b7480]">
              Bill client $
              <input
                value={bill}
                onChange={e => setBill(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoFocus
                className="mt-1 h-9 w-full rounded-[8px] border border-[#e2e2df] px-2.5 text-[13px] outline-none focus:border-[#0b7a4e]"
              />
            </label>

            <label className="mt-2.5 block text-[11px] font-bold text-[#6b7480]">
              Pay {firstName} back $
              <input
                value={paybackTouched ? payback : (parseAmount(bill) ? String(parseAmount(bill)) : "")}
                onChange={e => { setPaybackTouched(true); setPayback(e.target.value) }}
                inputMode="decimal"
                placeholder="0.00"
                disabled={!cleanerName}
                className="mt-1 h-9 w-full rounded-[8px] border border-[#e2e2df] px-2.5 text-[13px] outline-none focus:border-[#0b7a4e] disabled:bg-[#f6f6f3]"
              />
            </label>
            <div className="mt-1 text-[10.5px] text-[#9a9fa4]">
              {cleanerName
                ? "Matches the charge until you change it. Set 0 to charge without paying back."
                : "No cleaner assigned to this client yet."}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="flex-1 rounded-[8px] py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                style={{ background: "#0b7a4e" }}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] border border-[#e2e2df] px-3 py-2 text-[12.5px] font-bold text-[#3f4347]"
              >
                Cancel
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
