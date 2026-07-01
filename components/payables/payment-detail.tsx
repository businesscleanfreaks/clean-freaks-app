"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Mail, Phone, AlertTriangle, Wallet, Send, Zap, Upload, FileText } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import type { Payable, PayableAccount, AccountStatus } from "./use-payables"

const METHODS = ["Zelle", "Cash", "Check", "Bank transfer", "Other"] as const

const STATUS: Record<AccountStatus, { dot: string; label: string; bg: string; text: string }> = {
  safe: { dot: "#10B981", label: "Ready", bg: "#ECFDF5", text: "#047857" },
  waiting: { dot: "#F59E0B", label: "Waiting", bg: "#FFFBEB", text: "#B45309" },
  partial: { dot: "#0EA5E9", label: "Partial", bg: "#EFF6FF", text: "#1D4ED8" },
  "pay-today": { dot: "#DC2626", label: "Pay today", bg: "#FEF2F2", text: "#B91C1C" },
}

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const PDF_MAX_BYTES = 10 * 1024 * 1024

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validatePdf(file: File | null): file is File {
  if (!file) return false
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (!isPdf) { showError("Choose a PDF file"); return false }
  if (file.size > PDF_MAX_BYTES) { showError("PDF must be 10 MB or smaller"); return false }
  return true
}

/**
 * Mark-paid rail: check the accounts to pay (waiting ones are locked with the
 * reason), record date / method / reference / notes, then post to the existing
 * subcontractor or vendor payment endpoint. Only the payable (safe) portion of
 * an account is ever sent — the gate can't be bypassed from here.
 */
interface PayeeInvoiceRow {
  id: string
  period: string
  claimedAmount: number
  computedOwed: number
  reference: string | null
  status: "PENDING" | "MATCHED" | "MISMATCH" | "RESOLVED"
  attachmentFileName: string | null
  attachmentSize: number | null
}

/**
 * Records what a cleaner billed us for the viewed month and reconciles it against
 * what we compute we owe (the same payables math). A MISMATCH is flagged so Grace
 * resolves it before paying — Josh's "only pay against a matching invoice" rule.
 */
function InvoiceIntakeSection({ payeeType, payeeId, period }: { payeeType: "cleaner" | "vendor"; payeeId: string; period: string }) {
  const label = payeeType === "cleaner" ? "Cleaner" : "Vendor"
  const lowerLabel = label.toLowerCase()
  const basePath = payeeType === "cleaner"
    ? `/api/subcontractors/${payeeId}/cleaner-invoices`
    : `/api/vendors/${payeeId}/vendor-invoices`
  const { data, mutate } = useSWR<{ invoices: PayeeInvoiceRow[] }>(
    `${basePath}?period=${period}`,
    (u: string) => fetch(u).then((r) => r.json()),
  )
  const latest = data?.invoices?.[0]
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState(false)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputId = `${payeeType}-invoice-file-${payeeId}-${period}`

  const record = async () => {
    const claimedAmount = parseFloat(amount)
    if (!Number.isFinite(claimedAmount) || claimedAmount < 0) { showError("Enter a valid amount"); return }
    setSaving(true)
    try {
      const body = new FormData()
      body.set("period", period)
      body.set("claimedAmount", String(claimedAmount))
      if (reference.trim()) body.set("reference", reference.trim())
      if (attachmentFile) body.set("file", attachmentFile)
      const res = await fetch(basePath, {
        method: "POST",
        body,
      })
      if (!res.ok) { await showApiError(res, "Failed to record invoice"); return }
      const { invoice } = await res.json()
      showSuccess(invoice.status === "MATCHED" ? "Invoice matches what we owe" : "Recorded — does NOT match what we owe")
      setAmount(""); setReference(""); setAttachmentFile(null); setOpen(false); mutate()
    } catch { showError("Failed to record invoice") } finally { setSaving(false) }
  }

  const chooseAttachment = (file: File | null) => {
    if (validatePdf(file)) setAttachmentFile(file)
  }

  const uploadAttachment = async (file: File | null) => {
    if (!latest || !validatePdf(file)) return
    setUploading(true)
    try {
      const body = new FormData()
      body.set("file", file)
      const res = await fetch(`${basePath}/${latest.id}/attachment`, {
        method: "POST",
        body,
      })
      if (!res.ok) { await showApiError(res, "Failed to attach PDF"); return }
      showSuccess(`${label} invoice PDF attached`)
      mutate()
    } catch {
      showError("Failed to attach PDF")
    } finally {
      setUploading(false)
    }
  }

  const resolve = async () => {
    if (!latest) return
    const res = await fetch(`${basePath}/${latest.id}/resolve`, { method: "POST" })
    if (!res.ok) { await showApiError(res, "Failed to resolve"); return }
    showSuccess("Mismatch resolved"); mutate()
  }

  const tone =
    latest?.status === "MATCHED" ? { bg: "#ECFDF5", text: "#047857", label: "Cleaner invoiced · matches what we owe" }
    : latest?.status === "RESOLVED" ? { bg: "#EFF6FF", text: "#1D4ED8", label: "Mismatch resolved" }
    : latest?.status === "MISMATCH" ? { bg: "#FEF2F2", text: "#B91C1C", label: "Cleaner invoice doesn't match" }
    : null
  const statusLabel =
    latest?.status === "MATCHED" ? `${label} invoiced - matches what we owe`
    : latest?.status === "RESOLVED" ? "Mismatch resolved"
    : latest?.status === "MISMATCH" ? `${label} invoice doesn't match`
    : ""

  return (
    <div className="border-b border-stone-100 px-4 py-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label} invoice</div>
      {latest ? (
        <div className="rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: tone?.bg }}>
          <div className="flex items-center justify-between gap-2">
            <span style={{ color: tone?.text, fontWeight: 600 }}>{statusLabel}</span>
            {latest.status === "MISMATCH" && (
              <button onClick={resolve} className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Resolve</button>
            )}
          </div>
          <div className="mt-1 text-stone-600">
            Billed <strong>{formatCurrency(latest.claimedAmount)}</strong> · we owe <strong>{formatCurrency(latest.computedOwed)}</strong>
            {latest.reference ? ` · ${latest.reference}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {latest.attachmentFileName && (
              <a
                href={`${basePath}/${latest.id}/attachment`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-600 hover:border-stone-300 hover:text-stone-900"
              >
                <FileText size={12} />
                {latest.attachmentFileName}
                {latest.attachmentSize ? <span className="font-normal text-stone-400">{formatBytes(latest.attachmentSize)}</span> : null}
              </a>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-500 hover:border-stone-300 hover:text-stone-800">
              <Upload size={12} />
              {uploading ? "Uploading..." : latest.attachmentFileName ? "Replace PDF" : "Attach PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  uploadAttachment(e.currentTarget.files?.[0] || null)
                  e.currentTarget.value = ""
                }}
              />
            </label>
          </div>
        </div>
      ) : open ? (
        <div className="space-y-2">
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount the ${lowerLabel} billed`}
            className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-[13px] outline-none" autoFocus />
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Their invoice # (optional)"
            className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-[13px] outline-none" />
          <label
            htmlFor={inputId}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              chooseAttachment(e.dataTransfer.files?.[0] || null)
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-[12px]"
            style={{ borderColor: dragging ? "#00A896" : "#D6D3D1", backgroundColor: dragging ? "#F0FDFA" : "#FAFAF9", color: "#57534E" }}
          >
            {attachmentFile ? <FileText size={14} /> : <Upload size={14} />}
            <span className="min-w-0 flex-1 truncate">
              {attachmentFile ? `${attachmentFile.name} ${formatBytes(attachmentFile.size)}` : `Drop ${lowerLabel} invoice PDF or choose file`}
            </span>
            {attachmentFile && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setAttachmentFile(null) }}
                className="text-[11px] font-semibold text-stone-400 hover:text-stone-700"
              >
                Remove
              </button>
            )}
            <input
              id={inputId}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => chooseAttachment(e.currentTarget.files?.[0] || null)}
            />
          </label>
          <div className="flex gap-2">
            <button onClick={record} disabled={saving} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#00A896" }}>Record</button>
            <button onClick={() => setOpen(false)} className="rounded-md border border-stone-300 px-3 py-1.5 text-[12px] text-stone-600">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-[12px] font-medium text-stone-500 hover:text-stone-800">
          No invoice recorded for this month — <span style={{ color: "#00A896" }}>record one</span>
        </button>
      )}
    </div>
  )
}

export function PaymentDetail({ payable, onPaid, onEdit, period }: { payable: Payable | null; onPaid: () => void; onEdit: (p: Payable) => void; period: string }) {
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
      let body: Record<string, unknown>
      if (payable.type === "cleaner") {
        // Split selected items: regular cleans → jobIds; add-ons this cleaner
        // performed on someone else's schedule → addOnIds (Payout-B).
        const jobIds = Array.from(new Set(checkedAccounts.filter((a) => a.itemKind !== "addon").flatMap((a) => a.payableItemIds)))
        const addOnIds = Array.from(new Set(checkedAccounts.filter((a) => a.itemKind === "addon").flatMap((a) => a.payableItemIds)))
        body = { jobIds, addOnIds, datePaid: date, notes: combinedNotes || null }
      } else {
        const jobIds = Array.from(new Set(checkedAccounts.filter((a) => a.itemKind === "job").flatMap((a) => a.payableItemIds)))
        const addOnServiceIds = Array.from(new Set(checkedAccounts.filter((a) => a.itemKind !== "job").flatMap((a) => a.payableItemIds)))
        body = { addOnServiceIds, jobIds, datePaid: date, notes: combinedNotes || null }
      }
      let res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      // Pay-gate: if no matching cleaner/vendor invoice is on file, confirm and retry.
      if (res.status === 409) {
        const gate = await res.clone().json().catch(() => null)
        if (
          (payable.type === "cleaner" && gate?.code === "NO_MATCHING_CLEANER_INVOICE") ||
          (payable.type === "vendor" && gate?.code === "NO_MATCHING_VENDOR_INVOICE")
        ) {
          const label = payable.type === "cleaner" ? "cleaner" : "vendor"
          const periods = Array.isArray(gate.periods) ? gate.periods.join(", ") : ""
          if (!window.confirm(`No matching ${label} invoice on file${periods ? ` for ${periods}` : ""}. Pay anyway?`)) {
            return
          }
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, confirmNoInvoice: true }),
          })
        }
      }
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

  const toggleFastPay = async () => {
    if (!payable || payable.type !== "cleaner") return
    try {
      const res = await fetch(`/api/subcontractors/${payable.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fastPay: !payable.fastPay }),
      })
      if (!res.ok) { await showApiError(res, "Failed to update fast-pay"); return }
      showSuccess(payable.fastPay ? "Fast-pay turned off" : "Fast-pay turned on")
      onPaid()
    } catch {
      showError("Failed to update fast-pay")
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
        {payable.type === "cleaner" && (
          <button onClick={toggleFastPay} title="Residential — pay within 72h"
            className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={payable.fastPay ? { borderColor: "#FECACA", background: "#FEF2F2", color: "#B91C1C" } : { borderColor: "#E7E5E4", background: "#fff", color: "#A8A29E" }}>
            <Zap size={10} /> Fast-pay {payable.fastPay ? "on" : "off"}
          </button>
        )}
        <button onClick={() => onEdit(payable)}
          className="flex-shrink-0 text-[11px] font-semibold text-stone-400 hover:text-stone-700" title="Edit profile">
          Edit
        </button>
      </div>

      <InvoiceIntakeSection payeeType={payable.type} payeeId={payable.id} period={period} />

      {payable.accounts.length > 0 ? (
        <>
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
        </>
      ) : (
        <div className="border-t border-stone-100 px-4 py-4 text-[12px] text-stone-400">Nothing owed to {payable.name} right now.</div>
      )}

      <PaymentHistory payable={payable} />
    </div>
  )
}

interface HistoryEntry { id: string; datePaid: string; amount: number; method: string | null; notes: string | null; count: number }

// Per-person payment history — the statement view that used to live on the
// separate /subcontractors and /vendors detail pages.
function PaymentHistory({ payable }: { payable: Payable }) {
  const { data } = useSWR<{ payments: HistoryEntry[]; total: number }>(
    `/api/payables/history?type=${payable.type}&id=${payable.id}`,
    (url: string) => fetch(url).then((r) => r.json()),
  )
  const payments = data?.payments || []
  return (
    <div className="border-t border-stone-100 px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Payment history</span>
        {payable.type === "cleaner" && payments.length > 0 && (
          <a href={`/api/subcontractors/${payable.id}/statement`} className="text-[11px] font-semibold text-stone-400 hover:text-stone-700">Download CSV</a>
        )}
      </div>
      {payments.length === 0 ? (
        <p className="text-[12px] text-stone-400">No payments recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] text-stone-700">
                  {new Date(p.datePaid).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  <span className="text-stone-400"> · {p.count} item{p.count === 1 ? "" : "s"}</span>
                </div>
                {p.notes && <div className="truncate text-[11px] text-stone-400">{p.notes}</div>}
              </div>
              <span className="flex-shrink-0 font-mono text-[12px] font-semibold text-emerald-700">{formatCurrency(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
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
