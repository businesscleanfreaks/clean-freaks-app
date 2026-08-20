"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import type { LedgerRow } from "@/lib/invoice-ledger"

export interface OverflowItem {
  label: string
  sub: string
  onSelect: () => void
}

/**
 * The row's secondary actions, behind a chevron.
 *
 * Everything here is either an undo or a route somewhere else — the row's
 * primary action stays review, never a one-click send. Each item carries a
 * one-line explanation because these change money state and the person
 * clicking is often not the owner.
 */
export function RowOverflowMenu({ items }: { items: OverflowItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className="rounded-[7px] p-1 text-[#98a2b3] transition-colors hover:bg-[#f2f4f7] hover:text-[#475467]"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-[248px] rounded-[11px] border border-[#e6e9ee] bg-white p-1.5 shadow-[0_14px_40px_rgba(16,24,40,.18)]">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => { setOpen(false); item.onSelect() }}
              className="block w-full rounded-[7px] px-2.5 py-2 text-left transition-colors hover:bg-[#f7f8fa]"
            >
              <span className="block text-[12.5px] font-bold text-[#1f2937]">{item.label}</span>
              <span className="mt-px block text-[11px] leading-snug text-[#98a2b3]">{item.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Which secondary actions a row offers, by status — mirroring the design's
 * menu. "View past invoices" is always there; it is the route into the client
 * profile's billing history rather than a link back into this same list.
 */
export function buildRowMenu(
  row: LedgerRow,
  actions: {
    onViewHistory: () => void
    onMarkPaid: () => void
    onUndoPaid: () => void
    onToggleClearing: () => void
    onCancelSchedule: () => void
  },
): OverflowItem[] {
  const history: OverflowItem = {
    label: "View past invoices",
    sub: "Full history in the client profile",
    onSelect: actions.onViewHistory,
  }

  if (row.ledgerStatus === "Sent: Paid") {
    return [
      { label: "Not actually paid", sub: "Marked by mistake · moves it back to unpaid", onSelect: actions.onUndoPaid },
      history,
    ]
  }
  if (row.ledgerStatus === "Scheduled") {
    return [
      { label: "Cancel scheduled send", sub: "Keeps the draft · you send it by hand", onSelect: actions.onCancelSchedule },
      history,
    ]
  }
  if (row.ledgerStatus === "To send") {
    return [history]
  }
  if (row.clearing) {
    return [
      { label: "Not actually clearing", sub: "Marked by mistake · moves it back", onSelect: actions.onToggleClearing },
      history,
    ]
  }
  if (row.ledgerStatus === "Payment late") {
    return [
      { label: "Mark paid", sub: "Money landed in your bank", onSelect: actions.onMarkPaid },
      { label: "Mark clearing", sub: "Client says payment is on the way", onSelect: actions.onToggleClearing },
      history,
    ]
  }
  // Sent: Unpaid
  return [
    { label: "Mark clearing", sub: "Client says ACH / check is on the way", onSelect: actions.onToggleClearing },
    history,
  ]
}
