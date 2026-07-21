"use client"

import { useEffect, useState } from "react"
import { addDays, addMonths, endOfMonth, format, isSameDay, startOfMonth, startOfWeek } from "date-fns"
import { Loader2, Plus, X } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { showApiError, showError, showSuccess, showUndoToast } from "@/lib/toast"
import { refreshCalendarData } from "./calendar-client"
import type { JobWithFullRelations } from "@/types"

type ScheduleJob = JobWithFullRelations & {
  schedule: (NonNullable<JobWithFullRelations["schedule"]> & {
    clientPayType?: string | null
    subcontractorPayType?: string | null
    paymentCadenceOverride?: string | null
    monthlyPattern?: string | null
    customDates?: string | null
  }) | null
}

interface QuickScheduleChangeDialogProps {
  job: ScheduleJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onBack: () => void
}

const weeklyCadences: Record<string, number> = {
  WEEKLY: 1,
  BI_WEEKLY: 2,
  EVERY_3_WEEKS: 3,
  EVERY_4_WEEKS: 4,
  EVERY_6_WEEKS: 6,
}
const dayLetters = ["S", "M", "T", "W", "T", "F", "S"]
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function parseDays(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]")
    return Array.isArray(parsed) ? parsed.map(Number).filter(day => day >= 0 && day <= 6) : []
  } catch {
    return []
  }
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) return ""
  return typeof value === "string" ? value.slice(0, 10) : format(value, "yyyy-MM-dd")
}

function cadenceLabel(frequency: string) {
  return {
    WEEKLY: "Weekly",
    BI_WEEKLY: "Every other week",
    EVERY_3_WEEKS: "Every 3 weeks",
    EVERY_4_WEEKS: "Every 4 weeks",
    EVERY_6_WEEKS: "Every 6 weeks",
    MONTHLY: "Monthly",
    "2X_MONTHLY": "Twice monthly",
    CUSTOM: "One-time / custom dates",
  }[frequency] || frequency
}

function previewDates(startDate: Date, frequency: string, selectedDays: number[], customDates: string[], count = 18) {
  if (frequency === "CUSTOM") {
    return customDates
      .filter(Boolean)
      .map(value => new Date(`${value}T12:00:00`))
      .filter(date => !Number.isNaN(date.getTime()))
  }
  const dates: Date[] = []
  const cadenceWeeks = weeklyCadences[frequency]
  const anchorWeek = startOfWeek(startDate, { weekStartsOn: 0 })
  for (let cursor = new Date(startDate); dates.length < count && cursor <= addMonths(startDate, 4); cursor = addDays(cursor, 1)) {
    if (cadenceWeeks) {
      const weekDiff = Math.floor((startOfWeek(cursor, { weekStartsOn: 0 }).getTime() - anchorWeek.getTime()) / (7 * 86400000))
      if (weekDiff % cadenceWeeks === 0 && selectedDays.includes(cursor.getDay())) dates.push(new Date(cursor))
    } else if (frequency === "MONTHLY" && cursor.getDate() === startDate.getDate()) {
      dates.push(new Date(cursor))
    } else if (frequency === "2X_MONTHLY" && (cursor.getDate() === startDate.getDate() || cursor.getDate() === Math.min(startDate.getDate() + 14, 28))) {
      dates.push(new Date(cursor))
    }
  }
  return dates
}

function MiniMonth({ month, highlighted, effectiveDate }: { month: Date; highlighted: Date[]; effectiveDate: Date }) {
  const monthStart = startOfMonth(month)
  const offset = monthStart.getDay()
  const days = endOfMonth(month).getDate()
  return (
    <div className="rounded-lg border border-[#bddbd0] bg-white p-2">
      <h3 className="text-center text-[11px] font-extrabold text-[#263246]">{format(month, "MMMM yyyy")}</h3>
      <div className="mt-1.5 grid grid-cols-7 text-center text-[8px] font-bold text-[#a2adba]">{dayLetters.map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}</div>
      <div className="mt-0.5 grid grid-cols-7 gap-y-0.5 text-center text-[9px]">
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1, 12)
          const active = highlighted.some(item => isSameDay(item, date))
          const effective = isSameDay(effectiveDate, date)
          return <span key={index + 1} className={`mx-auto flex h-[17px] w-[17px] items-center justify-center rounded-full font-bold ${effective ? "bg-[#111827] text-white" : active ? "bg-[#0b8557] text-white" : "text-[#536177]"}`}>{index + 1}</span>
        })}
      </div>
    </div>
  )
}

export function QuickScheduleChangeDialog({ job, open, onOpenChange, onBack }: QuickScheduleChangeDialogProps) {
  const [frequency, setFrequency] = useState("WEEKLY")
  const [days, setDays] = useState<number[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [customDates, setCustomDates] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!job?.schedule || !open) return
    const today = format(new Date(), "yyyy-MM-dd")
    const jobDate = format(new Date(job.date), "yyyy-MM-dd")
    const initialEffective = jobDate >= today ? jobDate : today
    setFrequency(job.schedule.frequency || "WEEKLY")
    setDays(parseDays(job.schedule.daysOfWeek).length ? parseDays(job.schedule.daysOfWeek) : [new Date(`${initialEffective}T12:00:00`).getDay()])
    setEffectiveFrom(initialEffective)
    try {
      const parsed = JSON.parse(job.schedule.customDates || "[]")
      setCustomDates(Array.isArray(parsed) && parsed.length ? parsed : [initialEffective])
    } catch {
      setCustomDates([initialEffective])
    }
  }, [job, open])

  const effectiveDate = effectiveFrom ? new Date(`${effectiveFrom}T12:00:00`) : new Date()
  const highlighted = previewDates(effectiveDate, frequency, days, customDates)
  if (!job?.schedule || !job.scheduleId) return null

  const weeklyLike = Boolean(weeklyCadences[frequency])
  const summaryDays = weeklyLike
    ? days.map(day => dayNames[day]).join(", ")
    : frequency === "CUSTOM"
      ? `${customDates.filter(Boolean).length} selected date${customDates.filter(Boolean).length === 1 ? "" : "s"}`
      : format(effectiveDate, "MMM d")

  const confirm = async () => {
    if (!effectiveFrom || (weeklyLike && days.length === 0) || (frequency === "CUSTOM" && customDates.filter(Boolean).length === 0)) {
      showError("Choose an effective date and at least one service day")
      return
    }
    setSaving(true)
    try {
      const schedule = job.schedule!
      const monthlyPattern = frequency === "MONTHLY"
        ? JSON.stringify({ type: "FIXED_DATES", dates: [effectiveDate.getDate()] })
        : frequency === "2X_MONTHLY"
          ? JSON.stringify({ type: "FIXED_DATES", dates: [effectiveDate.getDate(), Math.min(effectiveDate.getDate() + 14, 28)] })
          : null
      const nextCustomDates = frequency === "CUSTOM"
        ? JSON.stringify(Array.from(new Set(customDates.filter(Boolean))).sort())
        : null
      const existingEndDate = dateOnly(schedule.endDate)
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: job.location.id,
          frequency,
          daysOfWeek: weeklyLike ? JSON.stringify(days) : null,
          monthlyPattern,
          customDates: nextCustomDates,
          startDate: effectiveFrom,
          endDate: existingEndDate && existingEndDate >= effectiveFrom ? existingEndDate : null,
          defaultClientRate: schedule.defaultClientRate ?? job.clientRate ?? 0,
          defaultSubcontractorRate: schedule.defaultSubcontractorRate ?? job.subcontractorRate ?? 0,
          clientPayType: schedule.clientPayType ?? job.location.client.billingType ?? "PER_CLEAN",
          subcontractorPayType: schedule.subcontractorPayType ?? job.location.client.cleanerPayType ?? "PER_CLEAN",
          paymentCadenceOverride: schedule.paymentCadenceOverride ?? null,
          subcontractorId: schedule.subcontractorId ?? job.subcontractor?.id ?? null,
          timeType: schedule.timeType ?? (schedule.startTime || job.startTime ? "SPECIFIC" : "WINDOW"),
          startTime: schedule.startTime ?? job.startTime ?? null,
          startWindowBegin: schedule.startWindowBegin ?? job.startWindowBegin ?? null,
          startWindowEnd: schedule.startWindowEnd ?? job.startWindowEnd ?? null,
          carryForwardRecurringAddOns: true,
        }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to change schedule")
        return
      }
      const result = await response.json() as { oldScheduleId?: string; newSchedule?: { id?: string } }
      const originalPayload = {
        frequency: schedule.frequency,
        daysOfWeek: schedule.daysOfWeek ?? null,
        monthlyPattern: schedule.monthlyPattern ?? null,
        customDates: schedule.customDates ?? null,
        startDate: dateOnly(schedule.startDate),
        endDate: dateOnly(schedule.endDate) || null,
        defaultClientRate: schedule.defaultClientRate ?? job.clientRate ?? 0,
        defaultSubcontractorRate: schedule.defaultSubcontractorRate ?? job.subcontractorRate ?? 0,
        clientPayType: schedule.clientPayType ?? job.location.client.billingType ?? "PER_CLEAN",
        subcontractorPayType: schedule.subcontractorPayType ?? job.location.client.cleanerPayType ?? "PER_CLEAN",
        paymentCadenceOverride: schedule.paymentCadenceOverride ?? null,
        subcontractorId: schedule.subcontractorId ?? job.subcontractor?.id ?? null,
        timeType: schedule.timeType ?? (schedule.startTime || job.startTime ? "SPECIFIC" : "WINDOW"),
        startTime: schedule.startTime ?? job.startTime ?? null,
        startWindowBegin: schedule.startWindowBegin ?? job.startWindowBegin ?? null,
        startWindowEnd: schedule.startWindowEnd ?? job.startWindowEnd ?? null,
      }
      onOpenChange(false)
      void refreshCalendarData().catch(() => {})
      try {
        showUndoToast("Schedule updated", async () => {
          const newScheduleId = result.newSchedule?.id
          if (newScheduleId && newScheduleId !== job.scheduleId) {
            const deleteResponse = await fetch(`/api/schedules/${newScheduleId}`, { method: "DELETE" })
            if (!deleteResponse.ok) {
              await showApiError(deleteResponse, "Failed to remove the changed schedule")
              return
            }
          }
          const undoResponse = await fetch(`/api/schedules/${job.scheduleId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(originalPayload),
          })
          if (!undoResponse.ok) {
            await showApiError(undoResponse, "Failed to undo schedule change")
            return
          }
          void refreshCalendarData().catch(() => {})
          showSuccess("Change undone")
        })
      } catch {
        showSuccess("Schedule updated")
      }
    } catch {
      showError("Failed to change schedule. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="flex max-h-[94vh] w-[min(94vw,480px)] max-w-[480px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.30)]">
        <div className="shrink-0 px-5 pb-2.5 pt-4">
          <DialogTitle className="min-w-0 truncate text-[17px] font-extrabold text-[#172033]">Change schedule: {job.location.client.name}</DialogTitle>
          <DialogDescription className="pt-0.5 text-[12.5px] text-[#66758b]">Pick the new pattern and when it starts.</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-1.5 pb-3">
          {/* Frequency as pills (mockup) — the 3 primary cadences match the design; the
              rarer ones wrap onto a second row so every option stays available. */}
          <div className="flex flex-wrap gap-1.5">
            {[['WEEKLY', 'Weekly'], ['BI_WEEKLY', 'Every 2 wks'], ['MONTHLY', 'Monthly'], ['EVERY_3_WEEKS', 'Every 3 wks'], ['EVERY_4_WEEKS', 'Every 4 wks'], ['EVERY_6_WEEKS', 'Every 6 wks'], ['2X_MONTHLY', '2× monthly'], ['CUSTOM', 'Custom dates']].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFrequency(value)} className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition-colors ${frequency === value ? 'border-[#0b8557] bg-[#e7f4ee] text-[#0b6b45]' : 'border-[#d9e1ea] bg-white text-[#66758b] hover:bg-[#f6f8fa]'}`}>{label}</button>
            ))}
          </div>
          {weeklyLike && <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-[#66758b]">On these days</p><div className="flex gap-1.5">{dayLetters.map((letter, index) => <button key={index} type="button" onClick={() => setDays(current => current.includes(index) ? current.filter(day => day !== index) : [...current, index].sort())} className={`flex h-9 flex-1 items-center justify-center rounded-lg border text-[12px] font-extrabold ${days.includes(index) ? 'border-[#0b8557] bg-[#0b8557] text-white' : 'border-[#d9e1ea] bg-white text-[#66758b]'}`}>{letter}</button>)}</div></div>}
          <label className="block text-[11px] font-extrabold uppercase tracking-[0.04em] text-[#66758b]">Effective from<input type="date" min={format(new Date(), "yyyy-MM-dd")} value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} className="mt-1 h-[36px] w-full rounded-lg border border-[#cfd8e3] bg-[#f6f7f9] px-3 text-[13px] font-semibold text-[#172033]" /></label>
          {frequency === "CUSTOM" && (
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-extrabold text-[#66758b]">CUSTOM DATES</p><button type="button" onClick={() => setCustomDates(current => [...current, effectiveFrom])} className="flex items-center gap-1 text-[11px] font-extrabold text-[#08744f]"><Plus className="h-3.5 w-3.5" /> Add date</button></div>
              <div className="space-y-2">{customDates.map((value, index) => <div key={`${index}-${value}`} className="flex gap-2"><input type="date" min={effectiveFrom} value={value} onChange={event => setCustomDates(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-10 min-w-0 flex-1 rounded-lg border border-[#cfd8e3] bg-[#f8fafc] px-3 text-[13px] font-semibold" /><button type="button" aria-label="Remove custom date" onClick={() => setCustomDates(current => current.filter((_, itemIndex) => itemIndex !== index))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#d9e1ea] text-[#7f8ea3] hover:bg-[#f8fafc]"><X className="h-4 w-4" /></button></div>)}</div>
            </div>
          )}
          <div className="rounded-xl border border-[#bddbd0] bg-[#e8f4ef] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <p className="text-[10px] font-extrabold tracking-[0.05em] text-[#177454]">NEW SCHEDULE</p>
              {/* Legend sits on the header row so it stays visible without scrolling past the months. */}
              <div className="flex gap-3 text-[10px] text-[#66758b]"><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[#111827]" /> Effective date</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[#0b8557]" /> New clean</span></div>
            </div>
            <p className="mt-0.5 text-[13px] font-extrabold text-[#172033]">{cadenceLabel(frequency)} · {summaryDays}, starting {format(effectiveDate, "EEE, MMM d")}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2"><MiniMonth month={effectiveDate} highlighted={highlighted} effectiveDate={effectiveDate} /><MiniMonth month={addMonths(effectiveDate, 1)} highlighted={highlighted} effectiveDate={effectiveDate} /></div>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#edf0f3] bg-white px-5 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><button type="button" onClick={onBack} className="rounded-lg border border-[#d9e1ea] px-4 py-2 text-[13px] font-bold text-[#66758b]">Back</button><button type="button" onClick={confirm} disabled={saving} className="flex min-w-[144px] items-center justify-center gap-2 rounded-lg bg-[#078556] px-4 py-2 text-[13px] font-extrabold text-white disabled:bg-[#cbd5e1]">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Updating...' : 'Confirm change'}</button></div>
      </DialogContent>
    </Dialog>
  )
}
