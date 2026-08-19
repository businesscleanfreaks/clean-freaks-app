"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronRight, Download, Loader2, X } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

/**
 * Invoice history — the client's invoices, newest first, month first.
 *
 * This card IS the history home: the handoff is explicit that it carries no
 * "view in invoices" links. Opening a month shows the invoice exactly as the
 * client received it, which is the real PDF rather than a second rendering of
 * the same document that could drift from it.
 */

interface HistoryInvoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: number
  dateCreated: string | Date
  dateSent?: string | Date | null
  datePaid?: string | Date | null
}

const STATUS_CHIP: Record<string, { bg: string; color: string; label: string }> = {
  PAID: { bg: "#DCFCE7", color: "#15803D", label: "Paid" },
  SENT: { bg: "#DBEAFE", color: "#1D4ED8", label: "Sent" },
  DRAFT: { bg: "#FEF3C7", color: "#92400E", label: "Draft" },
  VOID: { bg: "#F1F5F9", color: "#64748B", label: "Void" },
}

const asDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })

/** "Paid Jul 5" / "Sent Jun 30" / "Not sent yet" — the one date that matters. */
function statusLine(inv: HistoryInvoice): string {
  const paid = asDate(inv.datePaid)
  if (paid) return `Paid ${shortDate(paid)}`
  const sent = asDate(inv.dateSent)
  if (sent) return `Sent ${shortDate(sent)}`
  return "Not sent yet"
}

export function InvoiceHistory({ invoices, autoScroll }: {
  invoices: HistoryInvoice[]
  /** Deep link ?tab=billing&hist=1 scrolls this card into view. */
  autoScroll?: boolean
}) {
  const [open, setOpen] = useState<HistoryInvoice | null>(null)
  const [mounted, setMounted] = useState(false)
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (autoScroll && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [autoScroll])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null) }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const rows = useMemo(
    () =>
      [...invoices]
        .filter(inv => inv.status !== "VOID")
        .sort((a, b) => {
          const ad = asDate(a.dateCreated)?.getTime() ?? 0
          const bd = asDate(b.dateCreated)?.getTime() ?? 0
          return bd - ad
        }),
    [invoices],
  )

  return (
    <section ref={cardRef} className="rounded-[10px] bg-white" style={{ border: "1px solid #E4E4E7" }}>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Invoice history</span>
        <span className="text-[11px] text-slate-400">{rows.length} total</span>
      </div>

      <div className="px-5 pb-4">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No invoices yet.</p>
        ) : (
          <div>
            {rows.map(inv => {
              const created = asDate(inv.dateCreated)
              const chip = STATUS_CHIP[inv.status] || STATUS_CHIP.DRAFT
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => setOpen(inv)}
                  title="See this invoice exactly as the client received it"
                  className="flex w-full items-center gap-3 border-b border-slate-100 py-2 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  <span className="w-[104px] flex-none text-[12.5px] font-semibold text-slate-900">
                    {created ? monthLabel(created) : "Undated"}
                  </span>
                  <span className="hidden w-[124px] flex-none truncate text-[11.5px] text-slate-400 sm:block">
                    #{inv.invoiceNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">{statusLine(inv)}</span>
                  <span className="flex-none font-mono text-[12.5px] font-semibold text-slate-900">
                    {formatCurrency(inv.totalAmount)}
                  </span>
                  <span
                    className="flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ background: chip.bg, color: chip.color }}
                  >
                    {chip.label}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-300" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {mounted && open && createPortal(
        <div className="fixed inset-0 z-[90] flex justify-end bg-black/30" onClick={() => setOpen(null)}>
          <aside
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label={`Invoice ${open.invoiceNumber}`}
            className="flex h-full w-full max-w-[720px] flex-col bg-white shadow-2xl"
          >
            <div className="flex flex-none items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-slate-900">
                  {asDate(open.dateCreated) ? monthLabel(asDate(open.dateCreated)!) : "Invoice"}
                </div>
                <div className="mt-0.5 text-[11.5px] text-slate-500">
                  #{open.invoiceNumber} · {statusLine(open)} · {formatCurrency(open.totalAmount)}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Exactly as the client received it.</div>
              </div>
              <a
                href={`/api/invoices/${open.id}/generate-pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex flex-none items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                style={{ background: "#0d9488" }}
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </a>
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label="Close invoice"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative min-h-0 flex-1 bg-slate-100">
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <iframe
                src={`/api/invoices/${open.id}/generate-pdf#toolbar=0`}
                title={`Invoice ${open.invoiceNumber}`}
                className="relative h-full w-full border-0"
              />
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </section>
  )
}
