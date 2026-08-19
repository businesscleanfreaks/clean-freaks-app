"use client"

import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { showError, showSuccess } from "@/lib/toast"

/**
 * "Invoicing across N locations" — one combined invoice, or one per location.
 *
 * Only shown for multi-location clients: with a single location there is no
 * choice to make. The change is effective next period rather than immediate,
 * because re-cutting an invoice already under review would move the ground
 * under the reviewer.
 */
export function InvoicingAcrossLocations({
  clientId,
  locationCount,
  separateLocationInvoices,
  onChanged,
}: {
  clientId: string
  locationCount: number
  separateLocationInvoices: boolean
  onChanged?: () => void
}) {
  const [separate, setSeparate] = useState(separateLocationInvoices)
  const [saving, setSaving] = useState(false)

  if (locationCount < 2) return null

  const choose = async (next: boolean) => {
    if (next === separate || saving) return
    const previous = separate
    setSeparate(next)
    setSaving(true)
    try {
      const res = await fetch("/api/settings/billing-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, separateLocationInvoices: next }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setSeparate(previous)
        showError(err?.error || "Could not change how this client is invoiced")
        return
      }
      showSuccess(
        next
          ? "Separate invoice per location · starts next period"
          : "One combined invoice · starts next period",
      )
      onChanged?.()
    } catch {
      setSeparate(previous)
      showError("Could not change how this client is invoiced")
    } finally {
      setSaving(false)
    }
  }

  const options = [
    {
      value: false,
      title: "One combined invoice",
      lines: ["Single email", "A line per location", "One total at the bottom"],
    },
    {
      value: true,
      title: "Separate invoice per location",
      lines: ["One email each", "Same billing contact", "Each location totals on its own"],
    },
  ]

  return (
    <section className="rounded-[10px] bg-white" style={{ border: "1px solid #E4E4E7" }}>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
          Invoicing across {locationCount} locations
        </span>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
      </div>

      <div className="grid gap-2.5 px-5 pb-2 sm:grid-cols-2">
        {options.map(opt => {
          const active = separate === opt.value
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => choose(opt.value)}
              aria-pressed={active}
              className="rounded-[10px] border p-3 text-left transition-colors"
              style={
                active
                  ? { borderColor: "#0d9488", background: "#ecfdf9" }
                  : { borderColor: "#E4E4E7", background: "#fff" }
              }
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full border"
                  style={active ? { borderColor: "#0d9488", background: "#0d9488" } : { borderColor: "#cbd5e1" }}
                >
                  {active && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-[13px] font-semibold text-slate-900">{opt.title}</span>
              </span>
              <span className="mt-1.5 block text-[11.5px] leading-[1.6] text-slate-500">
                {opt.lines.join(" · ")}
              </span>
            </button>
          )
        })}
      </div>

      <p className="px-5 pb-4 text-[11px] text-slate-400">
        Effective next period. Invoices already drafted or sent keep their current shape.
      </p>
    </section>
  )
}
