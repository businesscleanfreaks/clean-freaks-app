"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import useSWR from "swr"
import { Loader2, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { showError } from "@/lib/toast"

interface Cleaner {
  id: string
  name: string
  isActive: boolean
  invoicesUs: boolean
  payByDay: number
}

/** 1st, 2nd, 3rd, 4th … for the day a cleaner is paid by. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase()

/**
 * Pay schedule — when each cleaner gets paid, and whether they invoice us.
 *
 * These two settings decide what the table calls "ready", so they need somewhere
 * to be changed. The day grid stops at 28 on purpose: a pay-by day of the 30th
 * would go missing every February.
 */
export function PayScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, mutate, isLoading } = useSWR<Cleaner[]>(
    open ? "/api/subcontractors" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [dayOpenFor, setDayOpenFor] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Esc closes the day picker first, then the modal.
      if (dayOpenFor) setDayOpenFor(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, dayOpenFor, onClose])

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSaving(id)
    try {
      const res = await fetch(`/api/subcontractors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Could not save")
      }
      mutate()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save")
    } finally {
      setSaving(null)
    }
  }

  if (!open || typeof document === "undefined") return null

  const cleaners = (data ?? []).filter(c => c.isActive)

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-8"
      style={{ background: "rgba(15,23,42,.4)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Pay schedule"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-[820px] max-w-full flex-col overflow-hidden rounded-[16px] bg-white"
        style={{ boxShadow: "0 24px 64px rgba(16,24,40,.22)" }}
      >
        <div className="flex flex-none items-start gap-3 border-b border-[#ececea] px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-extrabold tracking-[-0.02em]">Pay schedule</div>
            <div className="mt-0.5 text-[12.5px] text-[#7e8489]">
              When each cleaner gets paid. Change it here · the Cleaners page sorts itself.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 flex-none place-items-center rounded-[7px] text-[#94a3b8] hover:bg-[#f6f6f3]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-[#98a2b3]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {cleaners.map(c => (
            <div
              key={c.id}
              className="flex items-center gap-3 border-b border-[#f6f6f3] py-3.5 last:border-b-0"
            >
              <span
                className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[9px] text-[11px] font-extrabold"
                style={{ background: "#eef6f1", color: "#0b7a4e" }}
              >
                {initials(c.name)}
              </span>
              <div className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{c.name}</div>

              <div className="relative flex-none">
                <button
                  type="button"
                  onClick={() => setDayOpenFor(v => (v === c.id ? null : c.id))}
                  title="We pay this cleaner by this day of the month, no matter what · earlier if the client already paid"
                  className="rounded-[8px] border border-[#e2e2df] px-3 py-1.5 text-[12.5px] font-semibold hover:bg-[#f6f6f3]"
                >
                  Pay by the <strong className="font-extrabold">{ordinal(c.payByDay)}</strong> ▾
                </button>

                {dayOpenFor === c.id && (
                  <div
                    className="absolute right-0 top-[calc(100%+6px)] z-10 rounded-[10px] border border-[#e2e2df] bg-white p-2"
                    style={{ boxShadow: "0 4px 10px rgba(16,24,40,.06), 0 16px 40px rgba(16,24,40,.14)" }}
                  >
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => { patch(c.id, { payByDay: d }); setDayOpenFor(null) }}
                          className="h-7 w-7 rounded-[6px] text-[12px] font-semibold tabular-nums hover:bg-[#eef6f1]"
                          style={d === c.payByDay ? { background: "#0b7a4e", color: "#fff" } : undefined}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 px-1 text-[10.5px] text-[#9a9fa4]">
                      Stops at 28 so the day exists in every month.
                    </div>
                  </div>
                )}
              </div>

              <label className="flex flex-none cursor-pointer items-center gap-2 text-[12px] font-semibold text-[#6b6f73]">
                Invoices us?
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.invoicesUs}
                  aria-label={`${c.name} invoices us`}
                  disabled={saving === c.id}
                  onClick={() => patch(c.id, { invoicesUs: !c.invoicesUs })}
                  className="relative h-[20px] w-[34px] flex-none rounded-full transition-colors disabled:opacity-50"
                  style={{ background: c.invoicesUs ? "#0b7a4e" : "#d5d8dc" }}
                >
                  <span
                    className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-[left] duration-[180ms]"
                    style={{ left: c.invoicesUs ? 16 : 2 }}
                  />
                </button>
              </label>
            </div>
          ))}

          {!isLoading && cleaners.length === 0 && (
            <div className="py-16 text-center text-[13px] text-[#8a8f93]">No active cleaners.</div>
          )}
        </div>

        <div className="flex-none border-t border-[#ececea] px-6 py-3 text-[11.5px] text-[#9a9fa4]">
          Turning &ldquo;invoices us&rdquo; off means that cleaner&rsquo;s work is never held waiting for one.
        </div>
      </div>
    </div>,
    document.body,
  )
}
