"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { Loader2, X } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showError, showUndoToast } from "@/lib/toast"

export interface PaySelection {
  cleanerId: string
  cleanerName: string
  jobIds: string[]
  /** Vendor add-ons are paid through the same call but a different field. */
  addOnServiceIds?: string[]
  amount: number
  /** Vendors are a separate model with their own payments endpoint. */
  isVendor?: boolean
}

/** Cleaners and vendors record payments against different tables. */
const payUrl = (p: PaySelection) =>
  p.isVendor
    ? `/api/vendors/${p.cleanerId}/payments`
    : `/api/subcontractors/${p.cleanerId}/payments`

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase()

const today = () => new Date().toISOString().slice(0, 10)

/**
 * The batch-pay bar and its review step.
 *
 * Paying is the one irreversible-feeling action on this page, so it never fires
 * from the bar itself: the bar opens a review listing exactly who gets paid and
 * how much, and only that confirms. Undo still follows, because the design
 * prefers undo over a second confirmation.
 */
export function BatchPayBar({ selection, onDone, onClear, hidden }: {
  selection: PaySelection[]
  onDone: () => void
  onClear: () => void
  /** Hidden while a modal or profile is open, per the design. */
  hidden?: boolean
}) {
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [memo, setMemo] = useState("")

  const total = selection.reduce((s, p) => s + p.amount, 0)
  const jobCount = selection.reduce(
    (s, p) => s + p.jobIds.length + (p.addOnServiceIds?.length ?? 0),
    0,
  )

  const pay = async () => {
    setBusy(true)
    try {
      // One payment per cleaner — that is how the money actually leaves, one
      // Zelle transfer each, so the record should match.
      const results = await Promise.all(
        selection.map(p =>
          fetch(payUrl(p), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobIds: p.jobIds,
              addOnServiceIds: p.addOnServiceIds ?? [],
              datePaid: today(),
              notes: memo.trim() || null,
            }),
          }).then(r => (r.ok ? p : null)).catch(() => null),
        ),
      )
      const done = results.filter((p): p is PaySelection => p !== null)
      const failed = selection.length - done.length

      if (done.length === 0) {
        showError("Could not log those payments")
        return
      }
      if (failed > 0) {
        showError(`${done.length} of ${selection.length} logged · the rest failed`)
      } else {
        showUndoToast(
          `Logged · ${done.length} payment${done.length === 1 ? "" : "s"} · ${formatCurrency(
            done.reduce((s, p) => s + p.amount, 0),
          )}`,
          async () => {
            await Promise.all(
              done.map(p =>
                fetch(payUrl(p), {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    jobIds: p.jobIds,
                    addOnServiceIds: p.addOnServiceIds ?? [],
                  }),
                }).catch(() => null),
              ),
            )
            onDone()
          },
        )
      }
      setReviewing(false)
      setMemo("")
      onClear()
      onDone()
    } finally {
      setBusy(false)
    }
  }

  if (selection.length === 0) return null

  return (
    <>
      {!reviewing && !hidden && (
        <div
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[14px] px-4 py-3"
          style={{ background: "#16302b", boxShadow: "0 8px 28px rgba(0,0,0,0.25)" }}
        >
          <span className="text-[13px] font-semibold text-[#eafaf4]">
            {selection.length} selected · {jobCount} job{jobCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setReviewing(true)}
            className="rounded-[9px] bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-[#0d0d0e] transition-transform active:scale-[0.98]"
          >
            Review &amp; mark {formatCurrency(total)} paid
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            className="text-[#7df0c2] transition-colors hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {reviewing && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => !busy && setReviewing(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center p-8"
          style={{ background: "rgba(15,23,42,.4)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Review payments"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="flex max-h-full w-[520px] max-w-full flex-col overflow-hidden rounded-[16px] bg-white"
            style={{ boxShadow: "0 24px 64px rgba(16,24,40,.22)" }}
          >
            <div className="flex-none border-b border-[#ececea] px-5 py-4">
              <div className="text-[16px] font-extrabold">Mark {formatCurrency(total)} paid</div>
              <div className="mt-0.5 text-[12px] text-[#7e8489]">
                One payment each · {jobCount} job{jobCount === 1 ? "" : "s"} across{" "}
                {selection.length} cleaner{selection.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {selection.map(p => (
                <div key={p.cleanerId} className="flex items-center gap-2.5 border-b border-[#f6f6f3] py-2.5 last:border-b-0">
                  <span
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] text-[11px] font-extrabold"
                    style={{ background: "#eef6f1", color: "#0b7a4e" }}
                  >
                    {initials(p.cleanerName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold">{p.cleanerName}</div>
                    <div className="text-[11.5px] text-[#9a9fa4]">
                      {(() => {
                        const n = p.jobIds.length + (p.addOnServiceIds?.length ?? 0)
                        return `${n} job${n === 1 ? "" : "s"}`
                      })()}
                    </div>
                  </div>
                  <span className="flex-none text-[13.5px] font-extrabold tabular-nums">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex-none border-t border-[#ececea] px-5 py-4">
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#98a2b3]">
                Memo (optional)
              </label>
              <input
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="Shows on the payment record"
                className="mb-3 h-10 w-full rounded-[8px] border border-[#e2e2df] px-3 text-[13px] outline-none focus:border-[#0b7a4e]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReviewing(false)}
                  disabled={busy}
                  className="rounded-[8px] border border-[#e2e2df] px-4 py-2.5 text-[13px] font-bold text-[#3f4347] disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={pay}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[8px] py-2.5 text-[13px] font-extrabold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{ background: "#0b7a4e" }}
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {busy ? "Logging…" : `Mark ${formatCurrency(total)} paid`}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
