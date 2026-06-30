"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2 } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"

const CADENCES = [
  { value: "IMMEDIATE", label: "Immediate" },
  { value: "AFTER_CLIENT_PAYS", label: "After client pays" },
  { value: "END_OF_MONTH", label: "End of month" },
  { value: "SEMI_MONTHLY", label: "Semi-monthly" },
  { value: "RESIDENTIAL_7_DAY", label: "Residential 7-day" },
  { value: "COMMERCIAL_CLIENT_PAID_OR_7TH", label: "Commercial paid/7th" },
  { value: "ON_CLEANER_INVOICE", label: "On cleaner invoice" },
]

/**
 * Add or edit a cleaner / vendor from inside Payables, so the common profile
 * actions don't require leaving for the Cleaners / Vendors pages. Edit prefills
 * from the existing record; archive sets isActive=false (keeps history).
 */
export function PersonModal({
  type,
  mode = "add",
  editId,
  onClose,
  onSaved,
}: {
  type: "cleaner" | "vendor"
  mode?: "add" | "edit"
  editId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isCleaner = type === "cleaner"
  const isEdit = mode === "edit" && !!editId

  const [loading, setLoading] = useState(isEdit)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [zelle, setZelle] = useState("")
  const [service, setService] = useState("")
  const [cadence, setCadence] = useState("IMMEDIATE")
  const [notes, setNotes] = useState("")
  const [fastPay, setFastPay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)

  // Prefill when editing (the list endpoints return the full records).
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(isCleaner ? "/api/subcontractors" : "/api/vendors")
        const list = res.ok ? await res.json() : []
        const rec = Array.isArray(list) ? list.find((x: { id: string }) => x.id === editId) : null
        if (rec && !cancelled) {
          setName(rec.name || "")
          setPhone(rec.phone || "")
          setEmail(rec.email || "")
          setNotes(rec.notes || "")
          if (isCleaner) {
            setCadence(rec.paymentCadence || "IMMEDIATE")
            setFastPay(!!rec.fastPay)
          } else {
            setZelle(rec.zelle || "")
            setService(Array.isArray(rec.services) ? rec.services[0] || "" : "")
          }
        }
      } catch {
        /* ignore — fields stay blank */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isEdit, editId, isCleaner])

  const save = async () => {
    if (!name.trim()) { showError("Name is required."); return }
    setSaving(true)
    try {
      const body = isCleaner
        ? { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null, fastPay, paymentCadence: cadence }
        : { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, zelle: zelle.trim() || null, services: service.trim() ? [service.trim()] : [], notes: notes.trim() || null }
      const url = isEdit
        ? (isCleaner ? `/api/subcontractors/${editId}` : `/api/vendors/${editId}`)
        : (isCleaner ? "/api/subcontractors" : "/api/vendors")
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) { await showApiError(res, `Failed to ${isEdit ? "save" : "add"} ${type}`); return }
      showSuccess(isEdit ? "Saved" : `${isCleaner ? "Cleaner" : "Vendor"} added`)
      onSaved()
      onClose()
    } catch {
      showError(`Failed to ${isEdit ? "save" : "add"} ${type}`)
    } finally {
      setSaving(false)
    }
  }

  const archive = async () => {
    if (!editId) return
    if (!window.confirm(`Archive this ${type}? They'll stop appearing in payables (history is kept).`)) return
    setArchiving(true)
    try {
      const url = isCleaner ? `/api/subcontractors/${editId}` : `/api/vendors/${editId}`
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false }) })
      if (!res.ok) { await showApiError(res, "Failed to archive"); return }
      showSuccess(`${isCleaner ? "Cleaner" : "Vendor"} archived`)
      onSaved()
      onClose()
    } catch {
      showError("Failed to archive")
    } finally {
      setArchiving(false)
    }
  }

  if (!mounted) return null

  const inputCls = "w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400"

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h3 className="text-[15px] font-semibold text-stone-900">{isEdit ? "Edit" : "Add"} {isCleaner ? "cleaner" : "vendor"}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-stone-400"><Loader2 size={18} className="mr-2 animate-spin" /> Loading…</div>
        ) : (
          <div className="space-y-3 overflow-y-auto px-5 py-4">
            <Field label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isCleaner ? "e.g. Maggie Quevedo" : "e.g. ABC Window Co."} className={inputCls} />
            </Field>

            {!isCleaner && (
              <Field label="Service" hint="What kind of work they do">
                <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Window cleaning, carpet, …" className={inputCls} />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={inputCls} /></Field>
              <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@example.com" className={inputCls} /></Field>
            </div>

            {!isCleaner && (
              <Field label="Zelle" hint="Where you Zelle their payments">
                <input value={zelle} onChange={(e) => setZelle(e.target.value)} placeholder="zelle@example.com or (555) 123-4567" className={inputCls} />
              </Field>
            )}

            {isCleaner && (
              <Field label="Payment cadence" hint="When their work becomes payable">
                <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
                  {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            )}

            {isCleaner && (
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={fastPay} onChange={(e) => setFastPay(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-stone-800" />
                <span className="text-[12px] text-stone-700">Pay fast <span className="text-stone-400">— residential; flag &quot;Pay today&quot; once a clean has gone &gt;72h unpaid</span></span>
              </label>
            )}

            <Field label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-stone-200 bg-stone-50/60 px-5 py-3">
          {isEdit && (
            <button onClick={archive} disabled={archiving || saving} className="text-[12px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">
              {archiving ? "Archiving…" : "Archive"}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-stone-600 hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={saving || archiving || loading || !name.trim()}
              className="rounded-md px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "#1C1917" }}>
              {saving ? "Saving…" : isEdit ? "Save changes" : `Add ${isCleaner ? "cleaner" : "vendor"}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-stone-500">
        {label}{required && <span className="text-rose-500"> *</span>}
        {hint && <span className="ml-1 font-normal text-stone-400">— {hint}</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
