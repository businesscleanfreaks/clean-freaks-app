"use client"

import { useEffect, useState } from "react"
import { addDays, addMonths, endOfMonth, format, isSameDay, startOfMonth, startOfWeek } from "date-fns"
import { Loader2 } from "lucide-react"

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
  }) | null
}

interface QuickScheduleChangeDialogProps {
  job: ScheduleJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
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
  }[frequency] || frequency
}

function previewDates(startDate: Date, frequency: string, selectedDays: number[], count = 18) {
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
    <div className="rounded-xl border border-[#bddbd0] bg-white p-3">
      <h3 className="text-center text-[12px] font-extrabold text-[#263246]">{format(month, "MMMM yyyy")}</h3>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-[8px] font-bold text-[#a2adba]">{dayLetters.map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-y-1 text-center text-[9px]">
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1, 12)
          const active = highlighted.some(item => isSameDay(item, date))
          const effective = isSameDay(effectiveDate, date)
          return <span key={index + 1} className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full font-bold ${effective ? "bg-[#111827] text-white" : active ? "bg-[#0b8557] text-white" : "text-[#536177]"}`}>{index + 1}</span>
        })}
      </div>
    </div>
  )
}

export function QuickScheduleChangeDialog({ job, open, onOpenChange }: QuickScheduleChangeDialogProps) {
  const [frequency, setFrequency] = useState("WEEKLY")
  const [days, setDays] = useState<number[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!job?.schedule || !open) return
    const today = format(new Date(), "yyyy-MM-dd")
    const jobDate = format(new Date(job.date), "yyyy-MM-dd")
    const initialEffective = jobDate >= today ? jobDate : today
    setFrequency(job.schedule.frequency || "WEEKLY")
    setDays(parseDays(job.schedule.daysOfWeek).length ? parseDays(job.schedule.daysOfWeek) : [new Date(`${initialEffective}T12:00:00`).getDay()])
    setEffectiveFrom(initialEffective)
  }, [job, open])

  const effectiveDate = effectiveFrom ? new Date(`${effectiveFrom}T12:00:00`) : new Date()
  const highlighted = previewDates(effectiveDate, frequency, days)
  if (!job?.schedule || !job.scheduleId) return null

  const weeklyLike = Boolean(weeklyCadences[frequency])
  const summaryDays = weeklyLike ? days.map(day => dayNames[day]).join(", ") : format(effectiveDate, "MMM d")

  const confirm = async () => {
    if (!effectiveFrom || (weeklyLike && days.length === 0)) {
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
      const existingEndDate = dateOnly(schedule.endDate)
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: job.location.id,
          frequency,
          daysOfWeek: weeklyLike ? JSON.stringify(days) : null,
          monthlyPattern,
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
      refreshCalendarData()
      const originalPayload = {
        frequency: schedule.frequency,
        daysOfWeek: schedule.daysOfWeek ?? null,
        monthlyPattern: schedule.monthlyPattern ?? null,
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
        refreshCalendarData()
        showSuccess("Change undone")
      })
      onOpenChange(false)
    } catch {
      showError("Failed to change schedule. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="w-[min(94vw,578px)] max-w-[578px] gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.30)]">
        <DialogTitle className="px-7 pt-6 text-[21px] font-extrabold text-[#172033]">Change schedule: {job.location.client.name}</DialogTitle>
        <DialogDescription className="px-7 pt-1 text-[13px] text-[#66758b]">Pick the new pattern and when it starts.</DialogDescription>
        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-7 py-4">
          <div className="grid grid-cols-3 gap-2">
            {[['WEEKLY', 'Weekly'], ['BI_WEEKLY', 'Every other week'], ['MONTHLY', 'Monthly']].map(([value, label]) => <button key={value} type="button" onClick={() => setFrequency(value)} className={`rounded-xl border px-3 py-3 text-[14px] font-extrabold ${frequency === value ? 'border-[#0b8557] bg-[#e7f3ee] text-[#076342]' : 'border-[#d9e1ea] text-[#536177]'}`}>{label}</button>)}
          </div>
          <label className="block text-[11px] font-extrabold text-[#66758b]">OTHER CADENCE<select value={frequency} onChange={event => setFrequency(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[#d9e1ea] bg-[#f8fafc] px-3 text-[13px] font-semibold text-[#263246]"><option value="WEEKLY">Every week</option><option value="BI_WEEKLY">Every other week</option><option value="EVERY_3_WEEKS">Every 3 weeks</option><option value="EVERY_4_WEEKS">Every 4 weeks</option><option value="EVERY_6_WEEKS">Every 6 weeks</option><option value="2X_MONTHLY">Twice monthly</option><option value="MONTHLY">Monthly</option></select></label>
          {weeklyLike && <div><p className="mb-2 text-[11px] font-extrabold text-[#66758b]">ON THESE DAYS</p><div className="flex gap-2">{dayLetters.map((letter, index) => <button key={index} type="button" onClick={() => setDays(current => current.includes(index) ? current.filter(day => day !== index) : [...current, index].sort())} className={`flex h-10 flex-1 items-center justify-center rounded-lg border text-[12px] font-extrabold ${days.includes(index) ? 'border-[#0b8557] bg-[#0b8557] text-white' : 'border-[#d9e1ea] bg-white text-[#66758b]'}`}>{letter}</button>)}</div></div>}
          <label className="block text-[11px] font-extrabold text-[#66758b]">EFFECTIVE FROM<input type="date" min={format(new Date(), "yyyy-MM-dd")} value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#cfd8e3] bg-[#f8fafc] px-3 text-[14px] font-semibold text-[#172033]" /></label>
          <div className="rounded-xl border border-[#bddbd0] bg-[#e8f4ef] p-4">
            <p className="text-[10px] font-extrabold tracking-[0.05em] text-[#177454]">NEW SCHEDULE</p>
            <p className="mt-1 text-[15px] font-extrabold text-[#172033]">{cadenceLabel(frequency)} · {summaryDays}, starting {format(effectiveDate, "EEE, MMM d")}</p>
            <div className="mt-3 grid grid-cols-2 gap-3"><MiniMonth month={effectiveDate} highlighted={highlighted} effectiveDate={effectiveDate} /><MiniMonth month={addMonths(effectiveDate, 1)} highlighted={highlighted} effectiveDate={effectiveDate} /></div>
            <div className="mt-3 flex gap-4 text-[10px] text-[#66758b]"><span className="flex items-center gap-1"><i className="h-3 w-3 rounded-full bg-[#111827]" /> Effective date</span><span className="flex items-center gap-1"><i className="h-3 w-3 rounded-full bg-[#0b8557]" /> New clean</span></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#edf0f3] px-7 py-3.5"><button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-[#d9e1ea] px-4 py-2.5 text-[13px] font-bold text-[#66758b]">Cancel</button><button type="button" onClick={confirm} disabled={saving} className="flex min-w-[144px] items-center justify-center gap-2 rounded-lg bg-[#078556] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:bg-[#cbd5e1]">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Updating...' : 'Confirm change'}</button></div>
      </DialogContent>
    </Dialog>
  )
}
