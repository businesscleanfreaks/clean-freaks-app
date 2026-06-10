"use client"

import { useEffect, useMemo, useState } from "react"
import { Mail, Phone, AlertTriangle, Wallet, Send } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import type { Payable, PayableAccount, AccountStatus } from "./use-payables"

const METHODS = ["Zelle", "Cash", "Check", "Bank transfer", "Other"] as const

const STATUS: Record<AccountStatus, { dot: string; label: string; bg: string; text: string }> = {
  safe: { dot: "#10B981", label: "Ready", bg: "#ECFDF5", text: "#047857" },
  waiting: { dot: "#F59E0B", label: "Waiting", bg: "#FFFBEB", text: "#B45309" },
  partial: { dot: "#0EA5E9", label: "Partial", bg: "#EFF6FF", text: "#1D4ED8" },
}

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Mark-paid rail: check the accounts to pay (waiting ones are locked with the
 * reason), record date / method / reference / notes, then post to the existing
 * subcontractor or vendor payment endpoint. Only the payable (safe) portion of
 * an account is ever sent — the gate can't be bypassed from here.
 */
export function PaymentDetail({ payable, onPaid }: { payable: Payable | null; onPaid: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [date, setDate] = useState(isoToday())
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Zelle")
  const [reference, setReference] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  // Reset per payable: pre-check everything that's payable right now.
  useEffect(() => {
    if (!payable) { setChecked(new Set()); return }
    setChecked(new Set(payable.accounts.filter((a) => a.payableItemIds.length > 0).map((a) => a.id)))
    setDate(isoToday())
    setMethod("Zelle")
    setReference("")
    setNotes("")
  }, [payable?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const checkedAccounts = useMemo(
    () => (payable ? payable.accounts.filter((a) => checked.has(a.id) && a.payableItemIds.length > 0) : []),
    [payable, checked],
  )
  const selectedTotal = checkedAccounts.reduce((s, a) => s + a.safeOwed, 0)
  const itemIds = useMemo(() => Array.from(new Set(checkedAccounts.flatMap((a) => a.payableItemIds))), [checkedAccounts])
  const canPay = itemIds.length > 0 && reference.trim().length > 0 && !saving

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const markPaid = async () => {
    if (!payable || !canPay) return
    setSaving(true)
    try {
      const combinedNotes = [method ? `Method: ${method}` : null, reference.trim() ? `Ref: ${reference.trim()}` : null, notes.trim() || null]
        .filter(Boolean)
        .join(" · ")
      const url = payable.type === "cleaner"
        ? `/api/subcontractors/${payable.id}/payments`
        : `/api/vendors/${payable.id}/payments`
      const body = payable.type === "cleaner"
        ? { jobIds: itemIds, datePaid: date, notes: combinedNotes || null }
        : { addOnServiceIds: itemIds, datePaid: date, notes: combinedNotes || null }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) { await showApiError(res, "Failed to record payment"); return }
      const payment = await res.json().catch(() => null)
      const recorded = typeof payment?.totalAmount === "number" ? payment.totalAmount : selectedTotal
      showSuccess(`Recorded ${formatCurrency(recorded)} paid to ${payable.name}`)
      onPaid()
    } catch {
      showError("Failed to record payment")
    } finally {
      setSaving(false)
    }
  }

  if (!payable) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white px-6 py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
          <Wallet size={20} className="text-stone-400" />
        </div>
        <p className="text-[13px] text-stone-500">Select a payable to mark as paid.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-stone-100 px-4 pt-4 pb-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-stone-200 text-[13px] font-bold text-stone-600">{payable.initials}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-stone-900">{payable.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-stone-500">
            {payable.zelleEmail ? (
              <span className="inline-flex items-center gap-1 truncate"><Mail size={11} /> {payable.zelleEmail}</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700"><AlertTriangle size={11} /> No Zelle email saved</span>
            )}
            {payable.contactPhone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {payable.contactPhone}</span>}
          </div>
        </div>
      </div>

      {/* Accounts to pay */}
      <div className="space-y-1.5 p-4">
        {payable.accounts.map((acc) => <AccountCheckRow key={acc.id} account={acc} checked={checked.has(acc.id)} onToggle={() => toggle(acc.id)} />)}
      </div>

      {/* Payment fields */}
      <div className="space-y-3 border-t border-stone-100 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-500">Payment date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-500">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
              className="mt-1 w-full rounded-md border border-stone-200 px-2 py-1.5 text-[13px] outline-none focus:border-stone-400">
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-stone-500">Reference <span className="font-normal text-stone-400">(confirmation no., last 4, …)</span></label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Zelle conf. #8841"
            className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-stone-500">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional"
            className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
        </div>

        <button onClick={markPaid} disabled={!canPay}
          className="flex w-full items-center justify-center gap-1.5 rounded-md py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#059669" }}>
          <Send size={14} /> {saving ? "Recording…" : `Mark ${formatCurrency(selectedTotal)} paid`}
        </button>
        {itemIds.length > 0 && reference.trim().length === 0 && (
          <p className="text-center text-[11px] text-stone-400">Add a payment reference to enable.</p>
        )}
      </div>
    </div>
  )
}

function AccountCheckRow({ account, checked, onToggle }: { account: PayableAccount; checked: boolean; onToggle: () => void }) {
  const st = STATUS[account.status]
  const locked = account.payableItemIds.length === 0
  return (
    <label className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-stone-50"}`}
      style={{ borderColor: checked && !locked ? "#A7F3D0" : "#F5F5F4", background: checked && !locked ? "#F0FDF9" : "#fff" }}>
      <input type="checkbox" checked={checked && !locked} disabled={locked} onChange={onToggle} className="mt-0.5 h-3.5 w-3.5 accent-emerald-600" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] font-medium text-stone-800">{account.clientName}</span>
          <span className="flex-shrink-0 font-mono text-[12.5px] font-semibold text-stone-800">{formatCurrency(locked ? account.owed : account.safeOwed)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10.5px]" style={{ color: account.status === "safe" ? "#A8A29E" : st.text }}>{account.reason}</span>
          {account.status === "partial" && (
            <span className="flex-shrink-0 text-[10px] text-stone-400">{formatCurrency(account.waitingOwed)} still waiting</span>
          )}
        </div>
      </div>
    </label>
  )
}
