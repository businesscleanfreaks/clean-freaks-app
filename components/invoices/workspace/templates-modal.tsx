"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"

const VARS = [
  { name: "{client}", desc: "Client name" },
  { name: "{month}", desc: "Billing month, e.g. June 2026" },
  { name: "{month_short}", desc: "Short month, e.g. Jun 2026" },
  { name: "{total}", desc: "Total with $ sign" },
  { name: "{due_date}", desc: "Due date" },
]

export function TemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [defaults, setDefaults] = useState({ subject: "", message: "" })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch("/api/settings/email-template")
      .then((r) => r.json())
      .then((d) => {
        setSubject(d.subject || "")
        setMessage(d.message || "")
        setDefaults(d.defaults || { subject: "", message: "" })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/settings/email-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      })
      if (!res.ok) { await showApiError(res, "Failed to save template"); return }
      showSuccess("Email template saved")
      onClose()
    } catch { showError("Failed to save template") } finally { setSaving(false) }
  }

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-stone-900">Email template</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-stone-400">Loading…</div>
        ) : (
          <>
            <p className="text-[12px] text-stone-500">One template, applied to every invoice email. Variables fill in per client at send time.</p>

            <label className="mt-3 block text-[11px] font-semibold text-stone-500">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />

            <label className="mt-3 block text-[11px] font-semibold text-stone-500">Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
              className="mt-1 w-full resize-y rounded-md border border-stone-200 px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-stone-400" />

            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Variables — click to insert</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {VARS.map((v) => (
                  <button key={v.name} title={v.desc} onClick={() => setMessage((m) => (m ? `${m} ${v.name}` : v.name))}
                    className="rounded-full border border-stone-200 px-2 py-0.5 font-mono text-[11px] text-stone-600 hover:border-teal-300 hover:text-teal-700">
                    {v.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button onClick={() => { setSubject(defaults.subject); setMessage(defaults.message) }}
                className="text-[12px] font-semibold text-stone-400 hover:text-stone-600">Reset to default</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-stone-500 hover:text-stone-700">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: "#0D9488" }}>
                  {saving ? "Saving…" : "Save template"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
