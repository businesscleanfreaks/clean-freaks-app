"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeft, Loader2, Check, X, Inbox } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

interface InvoiceLite {
  id: string
  invoiceNumber: string
  clientName: string
  totalAmount: number
}

interface Match {
  id: string
  senderName: string
  amount: number
  receivedAt: string
  confidence: "HIGH" | "MEDIUM" | "REVIEW" | null
  rawSnippet: string | null
  suggestedInvoice: InvoiceLite | null
  candidates: InvoiceLite[]
}

const CONFIDENCE: Record<string, { label: string; bg: string; text: string }> = {
  HIGH: { label: "High", bg: "#ECFDF5", text: "#047857" },
  MEDIUM: { label: "Likely", bg: "#FFFBEB", text: "#B45309" },
  REVIEW: { label: "Review", bg: "#FEF2F2", text: "#B91C1C" },
}

export function PaymentInbox() {
  const [matches, setMatches] = useState<Match[]>([])
  const [openInvoices, setOpenInvoices] = useState<InvoiceLite[]>([])
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/payments/inbox")
      if (!res.ok) throw new Error("load failed")
      const json = await res.json()
      setMatches(json.matches || [])
      setOpenInvoices(json.openInvoices || [])
      const defaults: Record<string, string> = {}
      for (const m of json.matches || []) {
        defaults[m.id] = m.suggestedInvoice?.id || m.candidates?.[0]?.id || ""
      }
      setPicked(defaults)
      setError(null)
    } catch {
      setError("Couldn't load the payment inbox.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id: string, path: string, body?: unknown) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/payments/${id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || "Action failed.")
        return false
      }
      return true
    } catch {
      setError("Action failed.")
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function confirm(m: Match) {
    const invoiceId = picked[m.id]
    if (!invoiceId) { setError("Choose an invoice to apply this payment to."); return }
    const inv = openInvoices.find((i) => i.id === invoiceId)
    if (await act(m.id, "confirm", { invoiceId })) {
      setToast(`Marked ${inv?.invoiceNumber || "invoice"} paid — any cleaner waiting on ${inv?.clientName || "this client"} is now ready to pay.`)
      await load()
    }
  }

  async function dismiss(m: Match) {
    if (await act(m.id, "dismiss")) await load()
  }

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');`}</style>

      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto w-full max-w-[900px] px-4 sm:px-6 pt-5 pb-4">
          <Link href="/payables" className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-stone-500 hover:text-stone-800">
            <ChevronLeft size={14} /> Payables
          </Link>
          <h1 className="text-[20px] font-bold text-stone-900">Payments to review</h1>
          <p className="mt-1 text-[13px] text-stone-500">
            Detected client payments. Confirm one to mark its invoice paid and release the cleaner.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[900px] px-4 sm:px-6 py-6">
        {toast && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">{toast}</div>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white py-20 text-center">
            <Inbox className="h-7 w-7 text-stone-300" />
            <p className="mt-3 text-[14px] font-medium text-stone-600">No payments to review</p>
            <p className="mt-1 text-[12px] text-stone-400">Detected Zelle and processor payments will show up here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map((m) => {
              const conf = m.confidence ? CONFIDENCE[m.confidence] : null
              const busy = busyId === m.id
              return (
                <div key={m.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-stone-900">{formatCurrency(m.amount)}</span>
                        <span className="text-[13px] text-stone-500">from {m.senderName}</span>
                        {conf && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: conf.bg, color: conf.text }}>{conf.label}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px] text-stone-400">
                        {new Date(m.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="text-[12px] text-stone-500">Apply to</label>
                    <select
                      value={picked[m.id] || ""}
                      onChange={(e) => setPicked((p) => ({ ...p, [m.id]: e.target.value }))}
                      className="min-w-[260px] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-[13px] text-stone-800"
                    >
                      <option value="">Select an invoice…</option>
                      {openInvoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} · {inv.clientName} · {formatCurrency(inv.totalAmount)}
                          {Math.abs(inv.totalAmount - m.amount) < 0.005 ? "  ✓ exact" : ""}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => confirm(m)}
                      disabled={busy || !picked[m.id]}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
                      style={{ backgroundColor: "#00A896" }}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check size={14} />} Confirm
                    </button>
                    <button
                      onClick={() => dismiss(m)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-3 py-1.5 text-[13px] font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                    >
                      <X size={14} /> Dismiss
                    </button>
                  </div>

                  {m.rawSnippet && (
                    <p className="mt-2 truncate text-[11px] text-stone-400" title={m.rawSnippet}>{m.rawSnippet}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
