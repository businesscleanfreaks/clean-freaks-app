"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"

/**
 * Add a cleaner or vendor without leaving Payables. Single POST to the existing
 * create routes. Editing/archiving stays on the Cleaners / Vendors pages (the
 * system of record), linked from the detail rail.
 */
export function PersonModal({ type, onClose, onSaved }: { type: "cleaner" | "vendor"; onClose: () => void; onSaved: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [zelle, setZelle] = useState("")
  const [service, setService] = useState("")
  const [notes, setNotes] = useState("")
  const [fastPay, setFastPay] = useState(false)
  const [saving, setSaving] = useState(false)

  const isCleaner = type === "cleaner"

  const save = async () => {
    if (!name.trim()) { showError("Name is required."); return }
    setSaving(true)
    try {
      const url = isCleaner ? "/api/subcontractors" : "/api/vendors"
      const body = isCleaner
        ? { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null, fastPay }
        : {
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            zelle: zelle.trim() || null,
            services: service.trim() ? [service.trim()] : [],
            notes: notes.trim() || null,
          }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) { await showApiError(res, `Failed to add ${type}`); return }
      showSuccess(`${isCleaner ? "Cleaner" : "Vendor"} added`)
      onSaved()
      onClose()
    } catch {
      showError(`Failed to add ${type}`)
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h3 className="text-[15px] font-semibold text-stone-900">Add {isCleaner ? "cleaner" : "vendor"}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isCleaner ? "e.g. Maggie Quevedo" : "e.g. ABC Window Co."}
              className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
          </Field>

          {!isCleaner && (
            <Field label="Service" hint="What kind of work they do">
              <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Window cleaning, carpet, …"
                className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567"
                className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
            </Field>
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@example.com"
                className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
            </Field>
          </div>

          {!isCleaner && (
            <Field label="Zelle" hint="Where you Zelle their payments">
              <input value={zelle} onChange={(e) => setZelle(e.target.value)} placeholder="zelle@example.com or (555) 123-4567"
                className="w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
            </Field>
          )}

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full resize-none rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
          </Field>

          {isCleaner && (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={fastPay} onChange={(e) => setFastPay(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-stone-800" />
              <span className="text-[12px] text-stone-700">Pay fast <span className="text-stone-400">— residential; flag "Pay today" once a clean has gone &gt;72h unpaid</span></span>
            </label>
          )}
          {isCleaner && (
            <p className="text-[11px] text-stone-400">Payment cadence (pay-after-client-pays, etc.) is set on the Cleaners page.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50/60 px-5 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-stone-600 hover:bg-stone-100">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()}
            className="rounded-md px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "#1C1917" }}>
            {saving ? "Adding…" : `Add ${isCleaner ? "cleaner" : "vendor"}`}
          </button>
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
