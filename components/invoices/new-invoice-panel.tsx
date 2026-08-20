"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowLeft, ArrowRight, FileText, Info, Plus, Search, Trash2, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { showError, showSuccess } from "@/lib/toast"
import {
  billsAutomatically,
  draftTotal,
  INVOICE_PRESETS,
  toApiLineItems,
  validateDraft,
  type DraftLine,
} from "@/lib/new-invoice"

interface ClientOption {
  id: string
  name: string
  billingType: string | null
  lastInvoiceTotal?: number | null
  lastInvoiceDue?: string | null
  cleanerName?: string | null
}

const initials = (name: string) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?"

let lineSeq = 0
const newLine = (name = "", amount = ""): DraftLine => ({ id: `l${++lineSeq}`, name, amount })

/**
 * "New invoice" — for charges that never came off the calendar: a fee,
 * supplies, damage.
 *
 * Deliberately NOT a way to bill scheduled cleans. Those are invoiced on the
 * client's cadence and reviewed in the workspace; raising one here would
 * double-bill, which is why a client already on a cadence gets a warning.
 */
export function NewInvoicePanel({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}) {
  const router = useRouter()
  const { data } = useSWR<{ clients: ClientOption[] }>(
    open ? "/api/invoices/new-invoice-clients" : null,
    fetcher,
  )

  const [query, setQuery] = useState("")
  const [client, setClient] = useState<ClientOption | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [addToCalendar, setAddToCalendar] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  // Reset between openings — a half-typed invoice for the wrong client is the
  // one thing that must never survive a close.
  useEffect(() => {
    if (!open) return
    setQuery(""); setClient(null); setLines([]); setAddToCalendar(false); setBusy(null)
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const clients = useMemo(() => data?.clients ?? [], [data])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients.slice(0, 6)
    return clients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6)
  }, [clients, query])

  const total = draftTotal(lines)
  const problems = validateDraft(client?.id ?? null, lines)
  const canSubmit = problems.length === 0 && !busy

  const addPreset = (name: string, amount: number | null) =>
    setLines(cur => [...cur, newLine(name, amount === null ? "" : String(amount))])

  const patchLine = (id: string, changes: Partial<DraftLine>) =>
    setLines(cur => cur.map(l => (l.id === id ? { ...l, ...changes } : l)))

  /**
   * `status` decides what happens after it exists: a draft to come back to, a
   * record of something already settled, or straight into review.
   */
  const submit = async (mode: "paid" | "draft" | "review") => {
    if (problems.length > 0) { showError(problems[0].message); return }
    setBusy(mode)
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client!.id,
          jobIds: [],
          lineItems: toApiLineItems(lines),
          showPaymentOptions: true,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { showError(body?.error || "Could not create the invoice"); return }

      const id: string | undefined = body?.id
      if (id && mode === "paid") {
        await fetch(`/api/invoices/${id}/mark-paid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod: "MANUAL", paymentNotes: "Recorded as already paid on creation" }),
        })
      }

      showSuccess(
        mode === "paid" ? "Invoice recorded as paid"
          : mode === "draft" ? "Saved for later"
            : "Invoice created · opening review",
      )
      onCreated?.()
      onClose()
      // Every send goes through the review workspace — never straight out.
      if (mode === "review") router.push("/invoices/workspace")
    } catch {
      showError("Could not create the invoice")
    } finally {
      setBusy(null)
    }
  }

  if (!open || !mounted) return null

  const warnAutomatic = client && billsAutomatically(client.billingType)

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-end justify-end"
      style={{ background: "rgba(16,24,40,0.32)", padding: "0 30px 0 0" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="New invoice"
        className="flex flex-col overflow-hidden bg-white"
        style={{
          width: 560,
          maxWidth: "calc(100% - 40px)",
          maxHeight: "calc(100vh - 44px)",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -8px 40px rgba(15,23,42,.22)",
        }}
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-2.5 text-white" style={{ background: "#0f172a", padding: "13px 18px" }}>
          {client && (
            <button
              type="button"
              onClick={() => setClient(null)}
              title="Back to client picker"
              aria-label="Back to client picker"
              className="-ml-1 flex h-[26px] w-[26px] items-center justify-center rounded-md text-[#cbd5e1] transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <FileText size={16} />
          <span className="text-[13.5px] font-bold">New invoice</span>
          <span
            className="rounded-full px-2.5 py-[3px] text-[11px] font-semibold text-[#cbd5e1]"
            style={{ background: "rgba(255,255,255,.09)" }}
          >
            One-time
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new invoice"
            className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-md text-[#cbd5e1] transition-colors hover:bg-white/10"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "20px 22px 22px" }}>
          {/* 1 — who */}
          <div className="mb-2.5 flex items-center gap-2">
            <StepDot n={1} />
            <span className="text-[13px] font-bold text-[#1f2733]">Who&apos;s it for?</span>
          </div>

          {!client ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#9aa3af]" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search a client, or type a new name…"
                  aria-label="Search for a client"
                  className="w-full rounded-[10px] border border-[#dfe3e8] py-[11px] pl-9 pr-3 text-[13px] outline-none focus:border-[#15793f]"
                />
              </div>

              <div className="mt-2 rounded-[12px] border border-[#eef0f3] bg-[#fbfcfd] p-1.5">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-[#9aa3af]">
                  Recent clients
                </div>
                {matches.length === 0 ? (
                  <p className="px-2 py-3 text-[12.5px] text-[#7d8795]">
                    No client matches “{query.trim()}”. Add them on the Clients page first.
                  </p>
                ) : (
                  matches.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClient(c)}
                      className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-2 text-left transition-colors hover:bg-white"
                    >
                      <span
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[11px] font-bold"
                        style={{ background: "#eaf5ee", color: "#15793f" }}
                      >
                        {initials(c.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-[#101828]">{c.name}</span>
                        <span className="block truncate text-[11.5px] text-[#98a2b3]">
                          {[c.cleanerName, c.lastInvoiceTotal != null ? `last ${formatCurrency(c.lastInvoiceTotal)}` : null]
                            .filter(Boolean)
                            .join(" · ") || "No invoices yet"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className="flex items-center gap-2.5 rounded-[11px] px-3 py-2.5"
                style={{ background: "#f1faf4", border: "1px solid #c7ebd3" }}
              >
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[11px] font-bold"
                  style={{ background: "#fff", color: "#15793f" }}
                >
                  {initials(client.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-[#101828]">{client.name}</span>
                  <span className="block truncate text-[11.5px] text-[#5b6470]">
                    {[client.cleanerName, client.lastInvoiceTotal != null ? `last invoice ${formatCurrency(client.lastInvoiceTotal)}` : null]
                      .filter(Boolean)
                      .join(" · ") || "No invoices yet"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setClient(null)}
                  className="flex-none text-[12px] font-bold text-[#15793f]"
                >
                  Change
                </button>
              </div>

              {warnAutomatic && (
                <div
                  className="mt-2.5 flex gap-2.5 rounded-[10px] px-3 py-2.5 text-[12px] leading-[1.45]"
                  style={{ background: "#fdf6ea", border: "1px solid #f3e2c4", color: "#9a6a1f" }}
                >
                  <Info size={15} className="mt-px flex-none" />
                  <span>
                    This client is billed automatically · completed cleans are already invoiced on their
                    cadence. Use this only for extras like fees, supplies, or damage.
                  </span>
                </div>
              )}

              {/* 2 — what */}
              <div className="mb-2.5 mt-5 flex items-center gap-2">
                <StepDot n={2} />
                <span className="text-[13px] font-bold text-[#1f2733]">What&apos;s the job?</span>
              </div>

              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {INVOICE_PRESETS.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => addPreset(p.name, p.amount)}
                    className="inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-[5px] text-[11.5px] font-semibold text-[#42505f] transition-colors hover:bg-[#eceff2]"
                    style={{ background: "#f4f6f8", border: "1px solid #e6eaee" }}
                  >
                    <Plus size={12} />
                    {p.name}
                  </button>
                ))}
              </div>

              {lines.length > 0 && (
                <div className="flex flex-col gap-2">
                  {lines.map(l => (
                    <div key={l.id} className="flex items-center gap-2">
                      <input
                        value={l.name}
                        onChange={e => patchLine(l.id, { name: e.target.value })}
                        placeholder="Description"
                        aria-label="Line description"
                        className="min-w-0 flex-1 rounded-[8px] border border-[#dfe3e8] px-2.5 py-[9px] text-[13px] text-[#1f2733] outline-none focus:border-[#15793f]"
                      />
                      <div className="flex w-[118px] flex-none items-center rounded-[8px] border border-[#dfe3e8] bg-white px-2.5">
                        <span className="text-[13px] text-[#9aa3af]">$</span>
                        {/* text + inputmode, never a number field: the handoff
                            requires money inputs that cannot change on scroll. */}
                        <input
                          value={l.amount}
                          onChange={e => patchLine(l.id, { amount: e.target.value })}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label="Line amount"
                          className="w-full border-none bg-transparent py-[9px] pl-1 text-right text-[13px] tabular-nums text-[#1f2733] outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setLines(cur => cur.filter(x => x.id !== l.id))}
                        aria-label={`Remove ${l.name || "line"}`}
                        className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-[#aab2bd] transition-colors hover:bg-[#f4f6f8] hover:text-[#dc2626]"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setLines(cur => [...cur, newLine()])}
                className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#15793f]"
              >
                <Plus size={13} /> Add a custom line
              </button>

              {/* 3 — details */}
              <div className="mb-2.5 mt-5 flex items-center gap-2">
                <StepDot n={3} />
                <span className="text-[13px] font-bold text-[#1f2733]">Details</span>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(v => !v)}
                  className="ml-auto text-[12px] font-bold text-[#8b95a1]"
                >
                  {detailsOpen ? "Hide" : "Show"}
                </button>
              </div>

              {detailsOpen && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[11px] border border-[#eef0f3] px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[#344054]">Also add to calendar</span>
                    <span className="block text-[11.5px] text-[#98a2b3]">
                      Puts this work on the schedule as a one-off job
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={addToCalendar}
                    onChange={e => setAddToCalendar(e.target.checked)}
                    className="h-4 w-4 flex-none accent-[#15793f]"
                  />
                </label>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {client && (
          <div className="flex flex-none items-center gap-2 border-t border-[#eef0f3] px-[18px] py-3">
            <div className="flex flex-col">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9aa3af]">Total</span>
              <span
                className="tabular-nums"
                style={{ fontSize: 19, fontWeight: 740, color: "#10131a", letterSpacing: "-.02em" }}
              >
                {formatCurrency(total)}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit("paid")}
                disabled={!canSubmit}
                title={problems[0]?.message}
                className="rounded-[9px] border border-[#e2e5e9] bg-white px-3 py-2.5 text-[12.5px] font-semibold text-[#475569] transition-colors hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                {busy === "paid" ? "Saving…" : "Already paid"}
              </button>
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={!canSubmit}
                title={problems[0]?.message}
                className="rounded-[9px] border border-[#e2e5e9] bg-white px-3 py-2.5 text-[12.5px] font-semibold text-[#475569] transition-colors hover:bg-[#f7f8fa] disabled:opacity-50"
              >
                {busy === "draft" ? "Saving…" : "Save for later"}
              </button>
              <button
                type="button"
                onClick={() => submit("review")}
                disabled={!canSubmit}
                title={problems[0]?.message}
                className="inline-flex items-center gap-[7px] rounded-[9px] px-[18px] py-[11px] text-[13.5px] font-bold text-white shadow-[0_2px_6px_rgba(15,90,54,.22)] disabled:opacity-50"
                style={{ background: "#15793f" }}
              >
                {busy === "review" ? "Creating…" : "Review & send"}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function StepDot({ n }: { n: number }) {
  return (
    <span
      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: "#15793f" }}
    >
      {n}
    </span>
  )
}
