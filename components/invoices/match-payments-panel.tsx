"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { X, Search, Loader2, Check } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError } from "@/lib/toast"

interface InvoiceLite {
  id: string
  invoiceNumber: string
  clientName: string
  totalAmount: number
}

interface PaymentMatch {
  id: string
  senderName: string | null
  amount: number
  receivedAt: string
  confidence: string | null
  rawSnippet: string | null
  suggestedInvoice: InvoiceLite | null
  candidates: InvoiceLite[]
}

interface InboxResponse {
  matches: PaymentMatch[]
  count: number
  openInvoices: InvoiceLite[]
}

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

const whenLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay) return `Today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * Match payments side sheet.
 *
 * Layout follows the design deliberately: the SELECTED payment and its
 * suggested-match card sit at the top so "Match · mark paid" is reachable
 * without scrolling; the "waiting to match" queue lives below it.
 */
export function MatchPaymentsPanel({ open, onClose, onMatched }: {
  open: boolean
  onClose: () => void
  onMatched?: () => void
}) {
  const { data, isLoading, mutate } = useSWR<InboxResponse>(
    open ? "/api/payments/inbox" : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const matches = useMemo(() => data?.matches ?? [], [data])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")

  const selected = matches.find(m => m.id === selectedId) ?? matches[0] ?? null
  const queue = matches.filter(m => m.id !== selected?.id)

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return (data?.openInvoices ?? [])
      .filter(inv => inv.clientName.toLowerCase().includes(q) || inv.invoiceNumber.toLowerCase().includes(q))
      .slice(0, 6)
  }, [search, data])

  if (!open) return null

  const act = async (path: string, body: unknown, successMsg: string) => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await fetch(`/api/payments/${selected.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Something went wrong")
      }
      showSuccess(successMsg)
      setSelectedId(null)
      setSearch("")
      await mutate()
      onMatched?.()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const matchTo = (inv: InvoiceLite) =>
    act("confirm", { invoiceId: inv.id }, `Matched ${formatCurrency(selected?.amount ?? 0)} to ${inv.clientName}`)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#101828]/25" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-[94vw] flex-col border-l border-[#e4e7ec] bg-white shadow-[0_12px_32px_rgba(16,24,40,.18)]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[#eef0f3] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold tracking-[-0.01em] text-[#101828]">Match payments</div>
            <div className="mt-0.5 text-[11.5px] text-[#7d8795]">Zelle · found in your bank&apos;s emails</div>
          </div>
          <span className="flex-none rounded-full bg-[#f3effb] px-2.5 py-1 text-[11px] font-extrabold text-[#6b46c1]">
            {matches.length} left
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close match payments"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-[#98a2b3] transition-colors hover:bg-[#f2f4f7] hover:text-[#475467]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-[#98a2b3]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !selected ? (
            <div className="px-5 py-20 text-center">
              <Check className="mx-auto h-7 w-7 text-[#22a35a]" strokeWidth={2.4} />
              <div className="mt-2 text-[14px] font-bold text-[#15803d]">All caught up</div>
              <div className="mt-1 text-[12px] text-[#7d8795]">No payments waiting to be matched.</div>
            </div>
          ) : (
            <>
              {/* Selected payment */}
              <div className="border-b border-[#eef0f3] px-5 py-4">
                <div className="text-[27px] font-extrabold tabular-nums leading-none tracking-[-0.02em] text-[#101828]">
                  {formatCurrency(selected.amount)}
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-[#475467]">{selected.senderName || "Unknown sender"}</div>
                <div className="mt-0.5 text-[11.5px] text-[#7d8795]">{whenLabel(selected.receivedAt)}</div>
                {selected.rawSnippet && (
                  <div className="mt-2 inline-block max-w-full truncate rounded-md bg-[#f7f8fa] px-2 py-1 text-[11.5px] text-[#5b6470]">
                    {selected.rawSnippet}
                  </div>
                )}
              </div>

              {/* Suggested match — kept at the top so the CTA needs no scrolling. */}
              <div className="border-b border-[#eef0f3] px-5 py-4">
                {selected.suggestedInvoice ? (
                  <>
                    <div className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">Suggested match</div>
                    <div className="mt-2 rounded-[11px] border border-[#cfe8d8] bg-[#f6fbf8] px-3.5 py-3">
                      <div className="text-[13.5px] font-bold text-[#101828]">{selected.suggestedInvoice.clientName}</div>
                      <div className="mt-0.5 text-[11.5px] text-[#7d8795]">
                        {selected.suggestedInvoice.invoiceNumber} ·{" "}
                        <span className="font-bold tabular-nums text-[#475467]">
                          {formatCurrency(selected.suggestedInvoice.totalAmount)}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => matchTo(selected.suggestedInvoice as InvoiceLite)}
                        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-[#15793f] px-3 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f5a36] disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
                        Match · mark paid
                      </button>
                    </div>
                  </>
                ) : selected.candidates.length > 0 ? (
                  <>
                    <div className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">
                      {selected.candidates.length} invoices match this amount
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {selected.candidates.map(inv => (
                        <button
                          key={inv.id}
                          type="button"
                          disabled={busy}
                          onClick={() => matchTo(inv)}
                          className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-[#e4e7ec] px-3 py-2.5 text-left transition-colors hover:border-[#cfe8d8] hover:bg-[#f6fbf8] disabled:opacity-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-[#101828]">{inv.clientName}</span>
                            <span className="block text-[11px] text-[#7d8795]">{inv.invoiceNumber}</span>
                          </span>
                          <span className="flex-none text-[12.5px] font-bold tabular-nums text-[#475467]">
                            {formatCurrency(inv.totalAmount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[12.5px] font-semibold text-[#8a5e12]">
                      No open invoice matches {formatCurrency(selected.amount)}.
                    </div>
                    <div className="relative mt-2.5">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98a2b3]" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Find invoice by client or number"
                        className="w-full rounded-[9px] border border-[#e4e7ec] py-2 pl-9 pr-3 text-[12.5px] outline-none focus:border-[#15793f]"
                      />
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {searchResults.map(inv => (
                        <button
                          key={inv.id}
                          type="button"
                          disabled={busy}
                          onClick={() => matchTo(inv)}
                          className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-[#e4e7ec] px-3 py-2.5 text-left transition-colors hover:border-[#cfe8d8] hover:bg-[#f6fbf8] disabled:opacity-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-[#101828]">{inv.clientName}</span>
                            <span className="block text-[11px] text-[#7d8795]">{inv.invoiceNumber}</span>
                          </span>
                          <span className="flex-none text-[12.5px] font-bold tabular-nums text-[#475467]">
                            {formatCurrency(inv.totalAmount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Queue */}
              {queue.length > 0 && (
                <div className="px-5 py-4">
                  <div className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#7d8795]">Waiting to match</div>
                  <div className="mt-2 space-y-1">
                    {queue.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedId(m.id)}
                        className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[#f7f8fa]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold text-[#101828]">
                            {m.senderName || "Unknown sender"}
                          </span>
                          <span className="block text-[11px] text-[#7d8795]">{whenLabel(m.receivedAt)}</span>
                        </span>
                        {m.suggestedInvoice && (
                          <span className="flex-none rounded-full bg-[#eaf5ee] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.03em] text-[#15793f]">
                            Match found
                          </span>
                        )}
                        <span className="flex-none text-[12.5px] font-bold tabular-nums text-[#475467]">
                          {formatCurrency(m.amount)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {selected && (
          <div className="flex flex-none items-center justify-between gap-2 border-t border-[#eef0f3] px-5 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => act("dismiss", {}, "Payment dismissed")}
              className="rounded-[8px] px-2.5 py-1.5 text-[12px] font-bold text-[#7d8795] transition-colors hover:bg-[#f7f8fa] hover:text-[#475467] disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              disabled={busy || matches.length < 2}
              onClick={() => {
                const next = queue[0]
                if (next) setSelectedId(next.id)
              }}
              className="rounded-[8px] border border-[#e4e7ec] px-3 py-1.5 text-[12px] font-bold text-[#475467] transition-colors hover:bg-[#f7f8fa] disabled:opacity-40"
            >
              Skip for now
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
