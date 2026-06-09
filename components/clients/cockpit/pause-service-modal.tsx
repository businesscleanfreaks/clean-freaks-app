"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Pause, X } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"

export interface PausableSchedule {
  id: string
  locationName: string
  cadence: string
}

/**
 * Pause a schedule over a date range (or indefinitely). Calls the pause endpoint,
 * which ends the interval before the pause and resumes a copy after it.
 */
export function PauseServiceModal({
  schedules,
  onClose,
  onDone,
}: {
  schedules: PausableSchedule[]
  onClose: () => void
  onDone: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [scheduleId, setScheduleId] = useState(schedules[0]?.id || "")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [indefinite, setIndefinite] = useState(false)
  const [saving, setSaving] = useState(false)

  const apply = async () => {
    if (!scheduleId) { showError("Pick a schedule to pause."); return }
    if (!from) { showError("Pick a pause start date."); return }
    if (!indefinite && !to) { showError("Pick an end date, or mark the pause indefinite."); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pauseFrom: from, pauseTo: indefinite ? null : to, indefinite }),
      })
      if (!res.ok) { await showApiError(res, "Failed to pause service"); return }
      showSuccess(indefinite ? "Service paused indefinitely" : "Service paused for the selected dates")
      onDone()
      onClose()
    } catch {
      showError("Failed to pause service")
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-stone-900">
            <Pause size={16} className="text-amber-600" /> Pause service
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>

        <p className="text-[12px] text-stone-500">
          Cleans in the paused window are removed; invoiced or paid cleans stay. Service resumes automatically
          after the end date (or stays paused until you change it).
        </p>

        {schedules.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">No active schedule to pause.</p>
        ) : (
          <>
            {schedules.length > 1 && (
              <div className="mt-4">
                <label className="text-[11px] font-semibold text-stone-500">Schedule</label>
                <select
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400"
                >
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>{s.locationName} · {s.cadence}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500">Pause from</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500">Pause to</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={indefinite}
                  className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-stone-400 disabled:bg-stone-50 disabled:text-stone-300" />
              </div>
            </div>

            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-[12px] text-stone-700">
              <input type="checkbox" checked={indefinite} onChange={(e) => setIndefinite(e.target.checked)} className="h-3.5 w-3.5 accent-amber-600" />
              Pause indefinitely (no resume date)
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-stone-500 hover:text-stone-700">Cancel</button>
              <button onClick={apply} disabled={saving}
                className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: "#D97706" }}>
                {saving ? "Pausing…" : "Pause service"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
