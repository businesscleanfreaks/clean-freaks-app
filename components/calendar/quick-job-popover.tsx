"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { format, addMonths, startOfMonth, endOfMonth, isSameDay, addDays } from "date-fns"
import { ArrowLeft, Loader2, Plus, Repeat2, X } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { hasFinalInvoice } from "@/lib/invoice-status"
import { calculateDayPauseCredit, calculateVisitPauseCredit } from "@/lib/pause-credit"
import { showApiError, showError, showSuccess, showUndoToast } from "@/lib/toast"
import { refreshCalendarData } from "./calendar-client"
import type { AddOnService, JobWithFullRelations, Subcontractor } from "@/types"

type QuickJob = JobWithFullRelations & {
  notes?: string | null
  cancellationFee?: number | null
  vendor?: { id: string; name: string } | null
}

interface QuickJobPopoverProps {
  job: QuickJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChangeSchedule: () => void
  subcontractors: Subcontractor[]
  anchor?: { left: number; top: number } | null
}

const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? 0 : 30
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  const period = hour >= 12 ? "PM" : "AM"
  const displayHour = hour % 12 || 12
  return { value, label: `${displayHour}:${String(minute).padStart(2, "0")} ${period}` }
})

function addMinutes(time: string, amount: number) {
  const [hour, minute] = time.split(":").map(Number)
  const total = (hour * 60 + minute + amount) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function dateOnly(value: string | Date | null | undefined) {
  if (!value) return ""
  return typeof value === "string" ? value.slice(0, 10) : format(value, "yyyy-MM-dd")
}

function scheduleSummary(job: QuickJob) {
  if (!job.schedule) return "One-time"
  const frequencyLabels: Record<string, string> = {
    WEEKLY: "Weekly",
    BIWEEKLY: "Every other week",
    EVERY_3_WEEKS: "Every 3 weeks",
    EVERY_4_WEEKS: "Every 4 weeks",
    EVERY_6_WEEKS: "Every 6 weeks",
    TWICE_MONTHLY: "Twice monthly",
    MONTHLY: "Monthly",
  }
  const frequency = frequencyLabels[job.schedule.frequency] || job.schedule.frequency.replaceAll("_", " ").toLowerCase()
  if (!job.schedule.daysOfWeek) return frequency
  try {
    const days = JSON.parse(job.schedule.daysOfWeek) as number[]
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return `${frequency} · ${days.map(day => labels[day]).filter(Boolean).join(", ")}`
  } catch {
    return frequency
  }
}

type PausePreviewSchedule = {
  frequency?: string
  startDate?: string | Date | null
  daysOfWeek?: string | null
  monthlyPattern?: string | null
  customDates?: string | null
}

// Mirrors the schedule generator for the calendar preview without importing
// the server-only regeneration module into the client bundle.
function pauseCleanEstimate(
  schedule: PausePreviewSchedule | null | undefined,
  fromStr: string,
  toStr: string,
): { count: number; cleanDays: Set<string> } {
  const cleanDays = new Set<string>()
  if (!schedule || !fromStr || !toStr) return { count: 0, cleanDays }
  const from = new Date(`${fromStr}T12:00:00`)
  const to = new Date(`${toStr}T12:00:00`)
  if (to < from) return { count: 0, cleanDays }

  const scheduleStartString = dateOnly(schedule.startDate) || fromStr
  const scheduleStart = new Date(`${scheduleStartString}T12:00:00`)
  const frequency = schedule.frequency || "WEEKLY"
  const weekIntervals: Record<string, number> = {
    WEEKLY: 1,
    BI_WEEKLY: 2,
    BIWEEKLY: 2,
    EVERY_3_WEEKS: 3,
    EVERY_4_WEEKS: 4,
    EVERY_6_WEEKS: 6,
  }
  const weekInterval = weekIntervals[frequency]

  if (weekInterval) {
    let days: number[] = []
    try { days = schedule.daysOfWeek ? (JSON.parse(schedule.daysOfWeek) as number[]) : [] } catch { days = [] }
    if (!days.length) days = [scheduleStart.getDay()]

    let weekCount = 0
    for (let date = new Date(scheduleStart); date <= to; date = addDays(date, 1)) {
      if (date >= from && weekCount % weekInterval === 0 && days.includes(date.getDay())) {
        cleanDays.add(format(date, "yyyy-MM-dd"))
      }
      const nextDate = addDays(date, 1)
      if (date.getDay() === 6 && nextDate.getDay() === 0) weekCount++
    }
    return { count: cleanDays.size, cleanDays }
  }

  let pattern: {
    type?: string
    dates?: number[]
    weekday?: number
    weeks?: Array<number | "last">
  } | null = null
  try { pattern = schedule.monthlyPattern ? JSON.parse(schedule.monthlyPattern) : null } catch { pattern = null }

  if (frequency === "CUSTOM" && schedule.customDates) {
    try {
      const customDates = JSON.parse(schedule.customDates) as string[]
      customDates.forEach(value => {
        const dateString = value.slice(0, 10)
        if (dateString >= fromStr && dateString <= toStr && dateString >= scheduleStartString) cleanDays.add(dateString)
      })
    } catch {
      return { count: 0, cleanDays }
    }
    return { count: cleanDays.size, cleanDays }
  }

  const rangeStart = scheduleStart > from ? scheduleStart : from
  for (let date = new Date(rangeStart); date <= to; date = addDays(date, 1)) {
    const day = date.getDate()
    const daysInMonth = endOfMonth(date).getDate()
    const ordinal = Math.floor((day - 1) / 7) + 1
    const isLastWeekday = day + 7 > daysInMonth
    let isScheduled = false

    if (frequency === "MONTHLY") {
      if (pattern?.type === "FIXED_DATES" && pattern.dates?.length) {
        isScheduled = day === pattern.dates[0]
      } else if (pattern?.type === "NTH_WEEKDAY" && pattern.weekday != null) {
        isScheduled = date.getDay() === pattern.weekday
          && Boolean(pattern.weeks?.some(week => week === ordinal || (week === "last" && isLastWeekday)))
      } else {
        isScheduled = day === scheduleStart.getDate()
      }
    } else if ((frequency === "2X_MONTHLY" || frequency === "TWICE_MONTHLY") && pattern) {
      if (pattern.type === "FIXED_DATES") {
        isScheduled = Boolean(pattern.dates?.includes(day))
      } else if (pattern.type === "NTH_WEEKDAY" && pattern.weekday != null) {
        isScheduled = date.getDay() === pattern.weekday
          && Boolean(pattern.weeks?.some(week => week === ordinal || (week === "last" && isLastWeekday)))
      }
    }

    if (isScheduled) cleanDays.add(format(date, "yyyy-MM-dd"))
  }

  return { count: cleanDays.size, cleanDays }
}

// A clickable month grid for selecting the pause range.
function PauseMonth({ month, fromStr, toStr, cleanDays, onPick }: {
  month: Date
  fromStr: string
  toStr: string
  cleanDays: Set<string>
  onPick: (dateStr: string) => void
}) {
  const monthStart = startOfMonth(month)
  const offset = monthStart.getDay()
  const dayCount = endOfMonth(month).getDate()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const from = fromStr ? new Date(`${fromStr}T12:00:00`) : null
  const to = toStr ? new Date(`${toStr}T12:00:00`) : null
  return (
    <div>
      <div className="mb-1 text-center text-[11px] font-extrabold text-[#475569]">{format(month, "MMMM yyyy")}</div>
      <div className="grid grid-cols-7 gap-px">
        {["S", "M", "T", "W", "T", "F", "S"].map((l, i) => <span key={`${l}-${i}`} className="py-0.5 text-center text-[9px] font-extrabold text-[#c3cad3]">{l}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`b-${i}`} />)}
        {Array.from({ length: dayCount }, (_, i) => {
          const date = new Date(month.getFullYear(), month.getMonth(), i + 1, 12)
          const ds = format(date, "yyyy-MM-dd")
          const past = date < today
          const inRange = Boolean(from && to && date >= from && date <= to)
          const isEnd = Boolean((from && isSameDay(date, from)) || (to && isSameDay(date, to)))
          const isClean = cleanDays.has(ds)
          return (
            <button
              key={i}
              type="button"
              disabled={past}
              onClick={() => onPick(ds)}
              className={`relative flex min-h-[26px] w-full items-center justify-center rounded-md pb-1.5 pt-1 text-[11px] font-semibold ${past ? "text-[#cbd5e1]" : isEnd ? "bg-[#0b7a4e] text-white" : inRange ? "bg-[#d7efe6] text-[#0b6b45]" : "text-[#0f172a] hover:bg-[#f1f5f9]"}`}
            >
              {i + 1}
              {isClean && !isEnd && <span className={`absolute bottom-0.5 h-[3px] w-[3px] rounded-full ${inRange ? "bg-[#0b6b45]" : "bg-[#c3cad3]"}`} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function jobType(job: QuickJob) {
  if (job.addOnServices?.length) return { label: "ADD-ON", color: "#1597B8" }
  if (job.isTrial) return { label: "TRIAL CLEAN", color: "#D97706" }
  if (job.scheduleId) return { label: "RECURRING CLEAN", color: "#B17C25" }
  return { label: "ONE-OFF CLEAN", color: "#0D9488" }
}

export function QuickJobPopover({ job, open, onOpenChange, onChangeSchedule, subcontractors, anchor }: QuickJobPopoverProps) {
  const [date, setDate] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [subcontractorId, setSubcontractorId] = useState("unassigned")
  const [clientRate, setClientRate] = useState("0")
  const [providerRate, setProviderRate] = useState("0")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [localAddOns, setLocalAddOns] = useState<AddOnService[]>([])
  const [changeScope, setChangeScope] = useState<"this" | "future">("this")
  const [addServiceOpen, setAddServiceOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([])
  const [serviceDescription, setServiceDescription] = useState("")
  const [servicePerformer, setServicePerformer] = useState("unassigned")
  const [serviceRecurring, setServiceRecurring] = useState(false)
  const [serviceStartDate, setServiceStartDate] = useState("")
  const [serviceFrequency, setServiceFrequency] = useState("WEEKLY")
  const [serviceDays, setServiceDays] = useState<number[]>([])
  const [serviceClientRate, setServiceClientRate] = useState("")
  const [serviceProviderRate, setServiceProviderRate] = useState("")
  // Inline edit of an existing add-on (the mockup's expandable/editable add-on row)
  const [editAddOnId, setEditAddOnId] = useState<string | null>(null)
  const [editAddOnDesc, setEditAddOnDesc] = useState("")
  const [editAddOnClientRate, setEditAddOnClientRate] = useState("")
  const [editAddOnProviderRate, setEditAddOnProviderRate] = useState("")
  const [cancelFee, setCancelFee] = useState("0")
  const [pauseFrom, setPauseFrom] = useState("")
  const [pauseTo, setPauseTo] = useState("")
  const [pauseName, setPauseName] = useState("")
  const [pauseBilling, setPauseBilling] = useState<"reduce" | "full">("reduce")
  const [pauseCreditMode, setPauseCreditMode] = useState<"visits" | "days" | "custom">("visits")
  const [pauseCustomCredit, setPauseCustomCredit] = useState("")
  const [pauseCalMonth, setPauseCalMonth] = useState<Date>(() => new Date())
  const addServicePanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!job || !open) return
    const initialStart = job.startTime || job.startWindowBegin || "09:00"
    setDate(format(new Date(job.date), "yyyy-MM-dd"))
    setStartTime(initialStart)
    setEndTime(job.startWindowEnd || addMinutes(initialStart, 60))
    setSubcontractorId(job.subcontractor?.id || "unassigned")
    setClientRate(String(Number(job.clientRate || 0)))
    setProviderRate(String(Number(job.subcontractorRate || 0)))
    setNotes(job.notes || "")
    setLocalAddOns(job.addOnServices || [])
    setChangeScope("this")
    setAddServiceOpen(false)
    setCancelOpen(false)
    setPauseOpen(false)
    setServiceDescription("")
    setServicePerformer(job.subcontractor?.id ? `cleaner:${job.subcontractor.id}` : "unassigned")
    setServiceRecurring(false)
    setServiceStartDate(format(new Date(job.date), "yyyy-MM-dd"))
    setServiceFrequency("WEEKLY")
    setServiceDays([new Date(job.date).getDay()])
    setServiceClientRate("")
    setServiceProviderRate("")
    setCancelFee("0")
    const today = format(new Date(), "yyyy-MM-dd")
    const jobDate = format(new Date(job.date), "yyyy-MM-dd")
    const initialPauseFrom = jobDate >= today ? jobDate : today
    setPauseFrom(initialPauseFrom)
    setPauseTo(format(new Date(`${initialPauseFrom}T12:00:00`).getTime() + 7 * 86400000, "yyyy-MM-dd"))
  }, [job, open])

  useEffect(() => {
    if (!open) return
    fetch("/api/vendors")
      .then(response => response.ok ? response.json() : [])
      .then(data => setVendors(Array.isArray(data) ? data.filter(vendor => vendor.isActive !== false) : []))
      .catch(() => setVendors([]))
  }, [open])

  useEffect(() => {
    if (!addServiceOpen) return
    const frame = window.requestAnimationFrame(() => {
      addServicePanelRef.current?.scrollIntoView({ block: "end", behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [addServiceOpen])

  const locked = Boolean(job && (hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || job.vendorPaid || job.status === "CANCELLED"))
  const margin = (Number(clientRate) || 0) - (Number(providerRate) || 0)
  const type = job ? jobType(job) : { label: "CLEAN", color: "#0D9488" }
  const activeSubcontractors = useMemo(
    () => subcontractors.filter(person => (person as Subcontractor & { isActive?: boolean }).isActive !== false || person.id === job?.subcontractor?.id),
    [job?.subcontractor?.id, subcontractors]
  )

  if (!job) return null

  const originalClientRate = Number(job.clientRate || 0)
  const originalProviderRate = Number(job.subcontractorRate || 0)
  const originalSubcontractorId = job.subcontractor?.id || "unassigned"
  const clientRateChanged = Number(clientRate) !== originalClientRate
  const providerRateChanged = Number(providerRate) !== originalProviderRate
  const cleanerChanged = !job.vendor && subcontractorId !== originalSubcontractorId
  const ratesChanged = clientRateChanged || providerRateChanged
  const showChangeScope = Boolean(job.scheduleId && (ratesChanged || cleanerChanged))
  const scopeWhat = cleanerChanged && ratesChanged
    ? "new cleaner & rate"
    : cleanerChanged
      ? "new cleaner"
      : "new rate"

  const save = async () => {
    const nextClientRate = Number(clientRate)
    const nextProviderRate = Number(providerRate)
    if (!date || !startTime || Number.isNaN(nextClientRate) || Number.isNaN(nextProviderRate) || nextClientRate < 0 || nextProviderRate < 0) {
      showError("Enter a valid date, time, and rates")
      return
    }

    setSaving(true)
    try {
      const usesWindow = Boolean(job.startWindowBegin || job.startWindowEnd)
      const originalDate = format(new Date(job.date), "yyyy-MM-dd")
      const originalStart = job.startTime || job.startWindowBegin || ""
      const originalEnd = job.startWindowEnd || addMinutes(originalStart || "09:00", 60)
      const payload: Record<string, string | number | null> = {}

      if (date !== originalDate) payload.date = date
      if (!job.vendor && subcontractorId !== originalSubcontractorId) {
        payload.subcontractorId = subcontractorId === "unassigned" ? null : subcontractorId
      }
      if (nextClientRate !== originalClientRate) payload.clientRate = nextClientRate
      if (nextProviderRate !== originalProviderRate) payload.subcontractorRate = nextProviderRate
      if ((notes.trim() || "") !== (job.notes || "").trim()) payload.notes = notes.trim() || null
      if (usesWindow) {
        if (startTime !== originalStart) payload.startWindowBegin = startTime
        if (endTime !== originalEnd) payload.startWindowEnd = endTime
      } else if (startTime !== originalStart) {
        payload.startTime = startTime
      }

      const undoPayload: Record<string, string | number | null> = {}
      if ("date" in payload) undoPayload.date = originalDate
      if ("subcontractorId" in payload) undoPayload.subcontractorId = originalSubcontractorId === "unassigned" ? null : originalSubcontractorId
      if ("clientRate" in payload) undoPayload.clientRate = originalClientRate
      if ("subcontractorRate" in payload) undoPayload.subcontractorRate = originalProviderRate
      if ("notes" in payload) undoPayload.notes = job.notes || null
      if ("startTime" in payload) undoPayload.startTime = originalStart || null
      if ("startWindowBegin" in payload) undoPayload.startWindowBegin = originalStart || null
      if ("startWindowEnd" in payload) undoPayload.startWindowEnd = originalEnd || null

      if (Object.keys(payload).length === 0) {
        onOpenChange(false)
        return
      }

      const applyForward = changeScope === "future" && showChangeScope
      const forwardKeys = new Set(["clientRate", "subcontractorRate", "subcontractorId"])
      const occurrencePayload = applyForward
        ? Object.fromEntries(Object.entries(payload).filter(([key]) => !forwardKeys.has(key)))
        : payload
      const occurrenceUndoPayload = applyForward
        ? Object.fromEntries(Object.entries(undoPayload).filter(([key]) => !forwardKeys.has(key)))
        : undoPayload
      const forwardPayload: Record<string, string | number | null> = {}
      let forwardResult: {
        updated: number
        skipped: number
        previous: { clientRate: number; subcontractorRate: number; subcontractorId: string | null }
      } | null = null

      if (applyForward) {
        if (clientRateChanged) forwardPayload.clientRate = nextClientRate
        if (providerRateChanged) forwardPayload.subcontractorRate = nextProviderRate
        if (cleanerChanged) forwardPayload.subcontractorId = subcontractorId === "unassigned" ? null : subcontractorId

        const forwardResponse = await fetch(`/api/jobs/${job.id}/apply-rate-forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forwardPayload),
        })
        if (!forwardResponse.ok) {
          await showApiError(forwardResponse, "Failed to save future cleans")
          return
        }
        forwardResult = await forwardResponse.json()
      }

      if (Object.keys(occurrencePayload).length > 0) {
        const response = await fetch(`/api/jobs/${job.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(occurrencePayload),
        })
        if (!response.ok) {
          if (forwardResult) {
            const rollbackPayload: Record<string, string | number | null> = {}
            if ("clientRate" in forwardPayload) rollbackPayload.clientRate = forwardResult.previous.clientRate
            if ("subcontractorRate" in forwardPayload) rollbackPayload.subcontractorRate = forwardResult.previous.subcontractorRate
            if ("subcontractorId" in forwardPayload) rollbackPayload.subcontractorId = forwardResult.previous.subcontractorId
            await fetch(`/api/jobs/${job.id}/apply-rate-forward`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(rollbackPayload),
            }).catch(() => {})
          }
          await showApiError(response, "Failed to save booking")
          return
        }
      }

      refreshCalendarData()
      const successMessage = forwardResult
        ? `Saved going forward${forwardResult.skipped > 0 ? ` · ${forwardResult.skipped} locked clean${forwardResult.skipped === 1 ? "" : "s"} unchanged` : ""}`
        : "Booking updated"
      showUndoToast(successMessage, async () => {
        if (forwardResult) {
          const rollbackPayload: Record<string, string | number | null> = {}
          if ("clientRate" in forwardPayload) rollbackPayload.clientRate = forwardResult.previous.clientRate
          if ("subcontractorRate" in forwardPayload) rollbackPayload.subcontractorRate = forwardResult.previous.subcontractorRate
          if ("subcontractorId" in forwardPayload) rollbackPayload.subcontractorId = forwardResult.previous.subcontractorId
          const rollbackResponse = await fetch(`/api/jobs/${job.id}/apply-rate-forward`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rollbackPayload),
          })
          if (!rollbackResponse.ok) {
            await showApiError(rollbackResponse, "Failed to undo future changes")
            return
          }
        }
        if (Object.keys(occurrenceUndoPayload).length > 0) {
          const undoResponse = await fetch(`/api/jobs/${job.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(occurrenceUndoPayload),
          })
          if (!undoResponse.ok) {
            await showApiError(undoResponse, "Failed to undo booking update")
            return
          }
        }
        refreshCalendarData()
        showSuccess("Change undone")
      })
      onOpenChange(false)
    } catch {
      showError("Failed to save booking. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const addService = async () => {
    const nextClientRate = Number(serviceClientRate)
    const nextProviderRate = Number(serviceProviderRate)
    if (!serviceDescription.trim() || Number.isNaN(nextClientRate) || Number.isNaN(nextProviderRate)) {
      showError("Choose a service and enter valid rates")
      return
    }
    if (serviceRecurring && !job.scheduleId) {
      showError("Recurring add-ons need an existing recurring schedule")
      return
    }
    setBusyAction("add-service")
    try {
      const response = await fetch("/api/add-on-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: serviceRecurring ? null : job.id,
          scheduleId: serviceRecurring ? job.scheduleId : null,
          description: serviceDescription.trim(),
          clientRate: nextClientRate,
          subcontractorRate: nextProviderRate,
          isRecurring: serviceRecurring,
          frequency: serviceRecurring ? serviceFrequency : null,
          dayOfWeek: serviceRecurring ? serviceDays[0] ?? new Date(`${serviceStartDate}T12:00:00`).getDay() : null,
          vendorId: servicePerformer.startsWith("vendor:") ? servicePerformer.slice(7) : null,
          subcontractorId: servicePerformer.startsWith("cleaner:") ? servicePerformer.slice(8) : null,
        }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to add service")
        return
      }
      const created = await response.json() as AddOnService
      setLocalAddOns(current => [...current, created])
      setAddServiceOpen(false)
      refreshCalendarData()
      showUndoToast("Add-on service added", async () => {
        const undoResponse = await fetch(`/api/add-on-services/${created.id}`, { method: "DELETE" })
        if (!undoResponse.ok) {
          await showApiError(undoResponse, "Failed to undo add-on")
          return
        }
        setLocalAddOns(current => current.filter(addOn => addOn.id !== created.id))
        refreshCalendarData()
        showSuccess("Change undone")
      })
    } catch {
      showError("Failed to add service. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  // Resolve a friendly "who performs it" subtitle for an existing add-on row.
  const addOnPerformerLabel = (addOn: AddOnService) => {
    const vendorId = (addOn as AddOnService & { vendorId?: string | null }).vendorId
    const subId = (addOn as AddOnService & { subcontractorId?: string | null }).subcontractorId
    if (vendorId) {
      const v = vendors.find(vendor => vendor.id === vendorId)
      return v ? `${v.name} · vendor` : "Vendor"
    }
    if (subId) {
      const c = subcontractors.find(person => person.id === subId)
      return c ? c.name : "In-house"
    }
    return job.vendor?.name ? `${job.vendor.name} · vendor` : (selectedCleanerName || "This clean's cleaner")
  }

  const startEditAddOn = (addOn: AddOnService) => {
    setEditAddOnId(addOn.id)
    setEditAddOnDesc(addOn.description)
    setEditAddOnClientRate(String(Number(addOn.clientRate || 0)))
    setEditAddOnProviderRate(String(Number(addOn.subcontractorRate || 0)))
  }

  const saveAddOnEdit = async (addOnId: string) => {
    setBusyAction(`edit-addon:${addOnId}`)
    try {
      const response = await fetch(`/api/add-on-services/${addOnId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editAddOnDesc.trim(),
          clientRate: Number(editAddOnClientRate) || 0,
          subcontractorRate: Number(editAddOnProviderRate) || 0,
        }),
      })
      if (!response.ok) { await showApiError(response, "Failed to update add-on"); return }
      const updated = await response.json() as AddOnService
      setLocalAddOns(current => current.map(item => item.id === addOnId ? { ...item, ...updated } : item))
      setEditAddOnId(null)
      refreshCalendarData()
      showSuccess("Add-on updated")
    } catch {
      showError("Failed to update add-on. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const removeAddOn = async (addOnId: string) => {
    setBusyAction(`remove-addon:${addOnId}`)
    try {
      const response = await fetch(`/api/add-on-services/${addOnId}`, { method: "DELETE" })
      if (!response.ok) { await showApiError(response, "Failed to remove add-on"); return }
      setLocalAddOns(current => current.filter(item => item.id !== addOnId))
      if (editAddOnId === addOnId) setEditAddOnId(null)
      refreshCalendarData()
      showSuccess("Add-on removed")
    } catch {
      showError("Failed to remove add-on. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const cancelSingleClean = async () => {
    setBusyAction("cancel-single")
    try {
      const fee = Number(cancelFee)
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", cancellationFee: fee > 0 ? fee : null }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to cancel clean")
        return
      }
      setCancelOpen(false)
      onOpenChange(false)
      void refreshCalendarData({
        jobId: job.id,
        updates: { status: "CANCELLED", cancellationFee: fee > 0 ? fee : null },
      }).catch(() => {})
      try {
        const previousStatus = job.status || "SCHEDULED"
        const previousFee = job.cancellationFee ?? null
        showUndoToast("Clean cancelled", async () => {
          // Revert the card immediately so undo feels instant; the PUT confirms
          // in the background and we re-apply the cancel only if it fails.
          void refreshCalendarData({
            jobId: job.id,
            updates: { status: previousStatus, cancellationFee: previousFee },
          }).catch(() => {})
          const undoResponse = await fetch(`/api/jobs/${job.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: previousStatus, cancellationFee: previousFee }),
          })
          if (!undoResponse.ok) {
            void refreshCalendarData({
              jobId: job.id,
              updates: { status: "CANCELLED", cancellationFee: fee > 0 ? fee : null },
            }).catch(() => {})
            await showApiError(undoResponse, "Failed to undo cancellation")
            return
          }
          showSuccess("Change undone")
        })
      } catch {
        showSuccess("Clean cancelled")
      }
    } catch {
      showError("Failed to cancel clean. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const restoreClean = async () => {
    setBusyAction("restore")
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SCHEDULED", cancellationFee: null }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to restore clean")
        return
      }
      onOpenChange(false)
      refreshCalendarData()
      showUndoToast("Clean restored", async () => {
        await fetch(`/api/jobs/${job.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CANCELLED", cancellationFee: job.cancellationFee ?? null }),
        })
        refreshCalendarData()
      })
    } catch {
      showError("Failed to restore clean. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const stopFutureCleans = async () => {
    if (!job.scheduleId) return
    setBusyAction("cancel-future")
    const originalEndDate = dateOnly(job.schedule?.endDate) || null
    try {
      const today = format(new Date(), "yyyy-MM-dd")
      const jobDate = format(new Date(job.date), "yyyy-MM-dd")
      const pauseFromDate = jobDate >= today ? jobDate : today
      const response = await fetch(`/api/schedules/${job.scheduleId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pauseFrom: pauseFromDate, indefinite: true }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to cancel future cleans")
        return
      }
      setCancelOpen(false)
      onOpenChange(false)
      refreshCalendarData()
      showUndoToast("Future cleans cancelled", async () => {
        const undoResponse = await fetch(`/api/schedules/${job.scheduleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endDate: originalEndDate }),
        })
        if (!undoResponse.ok) {
          await showApiError(undoResponse, "Failed to restore schedule")
          return
        }
        refreshCalendarData()
        showSuccess("Change undone")
      })
    } catch {
      showError("Failed to cancel future cleans. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const deleteSchedule = async () => {
    if (!job.scheduleId) return
    setBusyAction("delete-schedule")
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}`, { method: "DELETE" })
      if (!response.ok) {
        await showApiError(response, "Failed to delete schedule")
        return
      }
      setCancelOpen(false)
      onOpenChange(false)
      refreshCalendarData()
      showSuccess("Schedule deleted")
    } catch {
      showError("Failed to delete schedule. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  const pauseSchedule = async () => {
    if (!job.scheduleId || !pauseFrom || !pauseTo) {
      showError("Choose the first and last day of the pause")
      return
    }
    setBusyAction("pause")
    const originalEndDate = dateOnly(job.schedule?.endDate) || null
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pauseFrom, pauseTo, indefinite: false, carryForwardRecurringAddOns: true, breakName: pauseName.trim() || undefined, billing: pauseBilling, creditMode: pauseBilling === "reduce" ? pauseCreditMode : undefined, creditAmount: pauseBilling === "reduce" && pauseCreditMode === "custom" ? Number(pauseCustomCredit) || 0 : undefined }),
      })
      if (!response.ok) {
        await showApiError(response, "Failed to pause schedule")
        return
      }
      const result = await response.json() as { resumeScheduleId?: string | null }
      setPauseOpen(false)
      onOpenChange(false)
      refreshCalendarData()
      showUndoToast("Schedule paused", async () => {
        if (result.resumeScheduleId) {
          const deleteResponse = await fetch(`/api/schedules/${result.resumeScheduleId}`, { method: "DELETE" })
          if (!deleteResponse.ok) {
            await showApiError(deleteResponse, "Failed to remove resumed schedule")
            return
          }
        }
        const restoreResponse = await fetch(`/api/schedules/${job.scheduleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endDate: originalEndDate }),
        })
        if (!restoreResponse.ok) {
          await showApiError(restoreResponse, "Failed to restore schedule")
          return
        }
        refreshCalendarData()
        showSuccess("Change undone")
      })
    } catch {
      showError("Failed to pause schedule. Please try again.")
    } finally {
      setBusyAction(null)
    }
  }

  // Range selection for the pause calendar: first click sets the start, second
  // sets the end; clicking before the start (or when a range exists) restarts.
  const pickPauseDate = (ds: string) => {
    if (!pauseFrom || (pauseFrom && pauseTo)) { setPauseFrom(ds); setPauseTo(""); return }
    if (ds < pauseFrom) { setPauseFrom(ds); return }
    setPauseTo(ds)
  }
  const pausePreview = pauseCleanEstimate(job.schedule, pauseFrom, pauseTo)
  const isFlatRatePause = job.schedule?.clientPayType === "FLAT_RATE"
  const pausePerClean = Number(job.clientRate || job.schedule?.defaultClientRate || 0)
  const pauseMonthlyRate = Number(job.schedule?.defaultClientRate || job.clientRate || 0)
  const formatCredit = (value: number) => value.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const pausePreviewRows = (() => {
    if (!pauseFrom || !pauseTo) return []

    const rows: Array<{ label: string; value: string }> = []
    if (pauseBilling === "full") {
      rows.push({
        label: `${pausePreview.count} clean${pausePreview.count === 1 ? "" : "s"} skipped`,
        value: "bills as usual",
      })
    } else if (!isFlatRatePause) {
      const monthCounts = new Map<string, number>()
      Array.from(pausePreview.cleanDays).sort().forEach(dateString => {
        const month = format(new Date(`${dateString}T12:00:00`), "MMMM")
        monthCounts.set(month, (monthCounts.get(month) || 0) + 1)
      })
      monthCounts.forEach((count, month) => {
        rows.push({
          label: month,
          value: `-$${formatCredit(pausePerClean * count)} · ${count} clean${count === 1 ? "" : "s"}`,
        })
      })
    } else if (pauseCreditMode === "custom") {
      const customCredit = Number(pauseCustomCredit) || 0
      rows.push({
        label: "One-time credit",
        value: `-$${formatCredit(customCredit)} on ${format(new Date(`${pauseFrom}T12:00:00`), "MMMM")}'s invoice`,
      })
    } else {
      const pauseStart = new Date(`${pauseFrom}T12:00:00`)
      const pauseEnd = new Date(`${pauseTo}T12:00:00`)
      for (
        let month = startOfMonth(pauseStart);
        month <= startOfMonth(pauseEnd);
        month = addMonths(month, 1)
      ) {
        const monthStart = startOfMonth(month)
        const monthEnd = endOfMonth(month)
        const overlapStart = pauseStart > monthStart ? pauseStart : monthStart
        const overlapEnd = pauseEnd < monthEnd ? pauseEnd : monthEnd
        const monthLabel = format(month, "MMMM")
        let credit = 0
        let detail = ""

        if (pauseCreditMode === "days") {
          const pausedDays = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000) + 1
          credit = calculateDayPauseCredit(pauseMonthlyRate, pausedDays, monthEnd.getDate())
          detail = `${pausedDays} day${pausedDays === 1 ? "" : "s"}`
        } else {
          const monthStartString = format(monthStart, "yyyy-MM-dd")
          const monthEndString = format(monthEnd, "yyyy-MM-dd")
          const expectedVisits = pauseCleanEstimate(job.schedule, monthStartString, monthEndString).count
          const skippedVisits = Array.from(pausePreview.cleanDays).filter(
            dateString => dateString >= monthStartString && dateString <= monthEndString,
          ).length
          credit = calculateVisitPauseCredit(pauseMonthlyRate, skippedVisits, expectedVisits)
          detail = `${skippedVisits} clean${skippedVisits === 1 ? "" : "s"}`
        }

        if (credit <= 0) continue
        rows.push({
          label: monthLabel,
          value: `-$${formatCredit(credit)} · ${detail}`,
        })
      }
    }

    rows.push({
      label: "Resumes",
      value: format(addDays(new Date(`${pauseTo}T12:00:00`), 1), "MMM d"),
    })
    rows.push({ label: "Cleaner pay", value: "pauses automatically" })
    return rows
  })()

  const selectedCleanerName = activeSubcontractors.find(person => person.id === subcontractorId)?.name
  const performerName = job.vendor?.name || selectedCleanerName || "Unassigned"
  const initials = performerName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?"
  const accessNotes = job.location.client.notes
    ?.replace(/^TRIAL CLIENT[^\n]*\n*/i, "")
    .trim()
  const changeScopeSelector = showChangeScope ? (
    <div className="mt-2.5">
      <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.03em] text-[#7f8ea3]">Apply {scopeWhat} to</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          aria-pressed={changeScope === "this"}
          onClick={() => setChangeScope("this")}
          className={`min-w-0 flex-1 rounded-[7px] border px-1 py-2 text-[11.5px] font-bold ${changeScope === "this" ? "border-[#0d9488] bg-[#0d9488] text-white" : "border-[#e2e8f0] bg-white text-[#475569]"}`}
        >
          Just this clean
        </button>
        <button
          type="button"
          aria-pressed={changeScope === "future"}
          onClick={() => setChangeScope("future")}
          className={`min-w-0 flex-1 rounded-[7px] border px-1 py-2 text-[11.5px] font-bold ${changeScope === "future" ? "border-[#0d9488] bg-[#0d9488] text-white" : "border-[#e2e8f0] bg-white text-[#475569]"}`}
        >
          All future
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-calendar-quick-editor
        hideClose
        overlayClassName={anchor ? "bg-transparent" : undefined}
        className={`flex max-h-[92vh] !w-[min(94vw,398px)] !max-w-[398px] flex-col gap-0 overflow-hidden rounded-xl border border-[#dfe5eb] bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)] ${anchor ? "sm:translate-x-0 sm:translate-y-0 [animation:none]" : ""}`}
        style={anchor ? { left: anchor.left, top: anchor.top, transform: "none", animation: "none" } : undefined}
      >
        <DialogTitle className="sr-only">Quick edit {job.location.client.name}</DialogTitle>
        <DialogDescription className="sr-only">Update this booking or open the complete job details.</DialogDescription>

        <div className="shrink-0 border-b border-[#edf0f3] px-4 pb-3 pt-3">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: type.color }} />
            {type.label}
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#aeb7c3] hover:bg-[#f1f4f6] hover:text-[#64748b]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-2 truncate text-[20px] font-extrabold text-[#111827]">
            <Link
              href={`/clients/${job.location.client.id}`}
              title="Open client profile"
              className="hover:underline"
            >
              {job.location.client.name}
            </Link>
          </h2>
          <div className="mt-2.5 flex max-w-[270px] items-center gap-2">
            {job.vendor ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e7ebef] bg-[#f7f8fa] py-1 pl-1 pr-3 text-[13px] font-semibold text-[#425066]"><span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ backgroundColor: type.color }}>{initials}</span>{job.vendor.name} · vendor</div>
            ) : (
              <><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-[10px] font-extrabold text-white shadow-sm" style={{ backgroundColor: type.color }}>{initials}</span><Select value={subcontractorId} onValueChange={setSubcontractorId} disabled={locked}>
                <SelectTrigger className="h-9 min-w-0 flex-1 rounded-lg border-[#e1e7ed] bg-[#f7f8fa] px-3 text-[13px] font-semibold text-[#425066] shadow-none focus:ring-1 focus:ring-[#9ad6c4]">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent className="max-h-64 rounded-lg border-[#dfe5eb] p-1 shadow-xl">
                  <SelectItem value="unassigned" className="rounded-md">Unassigned</SelectItem>
                  {activeSubcontractors.map(person => <SelectItem key={person.id} value={person.id} className="rounded-md">{person.name}</SelectItem>)}
                </SelectContent>
              </Select></>
            )}
          </div>
          {cleanerChanged && changeScopeSelector}
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5 pb-6">
          {locked && <div className="rounded-md border border-[#f1d6a8] bg-[#fff8e8] px-3 py-2 text-[11px] font-semibold text-[#8a5a12]">This job is locked because it is cancelled, paid, or on a finalized invoice. More options explains the available next step.</div>}

          <section>
            <p className="mb-2 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">DAY &amp; TIME</p>
            <div className="grid grid-cols-[1.35fr_1fr_1fr] gap-2">
              <input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={locked} className="min-w-0 rounded-lg border border-[#d7dee7] bg-[#f8fafc] px-2.5 py-2.5 text-[13px] font-semibold text-[#1f2937] outline-none focus:border-[#0d9488] disabled:opacity-60" />
              <select value={startTime} onChange={event => { setStartTime(event.target.value); if (!job.startWindowEnd) setEndTime(addMinutes(event.target.value, 60)) }} disabled={locked} className="min-w-0 rounded-lg border border-[#d7dee7] bg-[#f8fafc] px-2 py-2.5 text-[12px] font-semibold outline-none focus:border-[#0d9488] disabled:opacity-60">
                {timeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select value={endTime} onChange={event => setEndTime(event.target.value)} disabled={locked || !job.startWindowBegin} title={!job.startWindowBegin ? "Exact-time jobs use the schedule duration" : undefined} className="min-w-0 rounded-lg border border-[#d7dee7] bg-[#f8fafc] px-2 py-2.5 text-[12px] font-semibold outline-none focus:border-[#0d9488] disabled:opacity-60">
                {timeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">RATE</p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[9px] font-bold text-[#7f8ea3]">Client charged<input type="number" min="0" step="0.01" value={clientRate} onFocus={event => /^0(?:\.0+)?$/.test(event.currentTarget.value) && event.currentTarget.select()} onChange={event => setClientRate(event.target.value)} disabled={locked} className="mt-1 w-full rounded-lg border border-[#dfe5ec] px-2.5 py-2 text-[14px] font-bold text-[#1f2937] outline-none focus:border-[#0d9488] disabled:bg-[#f4f6f8]" /></label>
              <label className="text-[9px] font-bold text-[#7f8ea3]">{job.vendor ? "Vendor is paid" : "Cleaner is paid"}<input type="number" min="0" step="0.01" value={providerRate} onFocus={event => /^0(?:\.0+)?$/.test(event.currentTarget.value) && event.currentTarget.select()} onChange={event => setProviderRate(event.target.value)} disabled={locked} className="mt-1 w-full rounded-lg border border-[#dfe5ec] px-2.5 py-2 text-[14px] font-bold text-[#1f2937] outline-none focus:border-[#0d9488] disabled:bg-[#f4f6f8]" /></label>
              <div className="rounded-lg bg-[#e7f2ee] px-2.5 py-2"><span className="block text-[8px] font-extrabold text-[#4b9b82]">MARGIN</span><span className={`text-[15px] font-extrabold ${margin < 0 ? "text-[#b42318]" : "text-[#066846]"}`}>${margin.toFixed(2)}</span></div>
            </div>
            {!cleanerChanged && ratesChanged && changeScopeSelector}
          </section>

          <section>
            <p className="mb-2 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">ADD-ON SERVICE</p>
            {localAddOns.map(addOn => {
              const editing = editAddOnId === addOn.id
              const editBusy = busyAction === `edit-addon:${addOn.id}`
              const removeBusy = busyAction === `remove-addon:${addOn.id}`
              return (
                <div key={addOn.id} className="mb-2 rounded-lg border border-[#dfe5ec]">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: addOn.isRecurring ? '#0b8557' : '#3b82f6' }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-bold text-[#1f2937]">{addOn.description}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${addOn.isRecurring ? 'bg-[#dff0e9] text-[#075f40]' : 'bg-[#eef2f7] text-[#5a6b82]'}`}>{addOn.isRecurring ? 'Recurring' : 'One-time'}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-[#7f8ea3]">{addOnPerformerLabel(addOn)} · ${Number(addOn.clientRate).toFixed(0)} / ${Number(addOn.subcontractorRate).toFixed(0)}</p>
                    </div>
                    {!locked && (
                      <>
                        <button type="button" aria-label={editing ? 'Close editor' : 'Edit add-on'} onClick={() => editing ? setEditAddOnId(null) : startEditAddOn(addOn)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#94a3b8] hover:bg-[#f1f4f6] hover:text-[#475569]"><svg className={`h-4 w-4 transition-transform ${editing ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></button>
                        <button type="button" aria-label="Remove add-on" onClick={() => removeAddOn(addOn.id)} disabled={removeBusy} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#aeb7c3] hover:bg-[#fdecec] hover:text-[#c11f1f] disabled:opacity-40">{removeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-4 w-4" />}</button>
                      </>
                    )}
                  </div>
                  {editing && (
                    <div className="space-y-2 border-t border-[#eef2f5] px-3 py-2.5">
                      <input value={editAddOnDesc} onChange={e => setEditAddOnDesc(e.target.value)} placeholder="Service" className="h-9 w-full rounded-lg border border-[#dfe5ec] px-2.5 text-[13px] font-semibold outline-none focus:border-[#0d9488]" />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[9px] font-bold text-[#718096]">Client charged<input type="number" min="0" step="0.01" value={editAddOnClientRate} onChange={e => setEditAddOnClientRate(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#dfe5ec] px-2 text-[13px] font-bold outline-none focus:border-[#0d9488]" /></label>
                        <label className="text-[9px] font-bold text-[#718096]">We pay<input type="number" min="0" step="0.01" value={editAddOnProviderRate} onChange={e => setEditAddOnProviderRate(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#dfe5ec] px-2 text-[13px] font-bold outline-none focus:border-[#0d9488]" /></label>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditAddOnId(null)} className="rounded-lg bg-[#f1f4f6] px-3 py-1.5 text-[11px] font-bold text-[#66758b]">Cancel</button>
                        <button type="button" onClick={() => saveAddOnEdit(addOn.id)} disabled={editBusy || !editAddOnDesc.trim()} className="flex min-w-[72px] items-center justify-center gap-1.5 rounded-lg bg-[#0B7A4E] px-3 py-1.5 text-[11px] font-extrabold text-white disabled:bg-[#a8cbbf]">{editBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {!addServiceOpen ? (
              // Mockup styling: reads as a select (chevron on the right), opens the service picker
              <button type="button" onClick={() => setAddServiceOpen(true)} disabled={locked} className="flex w-full items-center justify-between rounded-lg border border-[#d7dee7] bg-white px-3 py-2.5 text-left text-[14px] font-medium text-[#718096] hover:border-[#a9cfc6] disabled:opacity-50">Add a service…<svg className="h-4 w-4 text-[#94a3b8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></button>
            ) : (
              <div ref={addServicePanelRef} className="scroll-mb-5 space-y-3 rounded-xl border border-[#b9d8cd] bg-[#eaf5f0] p-3">
                <Select value={serviceDescription} onValueChange={setServiceDescription}>
                  <SelectTrigger className="h-11 rounded-lg border-[#b9d8cd] bg-white text-[13px] font-semibold"><SelectValue placeholder="Choose a service..." /></SelectTrigger>
                  <SelectContent><SelectItem value="Window Cleaning">Window Cleaning</SelectItem><SelectItem value="Carpet Cleaning">Carpet Cleaning</SelectItem><SelectItem value="Fridge Deep Clean">Fridge Deep Clean</SelectItem><SelectItem value="Pressure Washing">Pressure Washing</SelectItem><SelectItem value="Custom service">Custom service</SelectItem></SelectContent>
                </Select>
                <div><p className="mb-1.5 text-[9px] font-extrabold text-[#08744f]">WHO PERFORMS IT?</p><Select value={servicePerformer} onValueChange={setServicePerformer}><SelectTrigger className="h-10 rounded-lg border-[#c9d8d2] bg-white text-[13px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{activeSubcontractors.map(person => <SelectItem key={`cleaner:${person.id}`} value={`cleaner:${person.id}`}>{person.name}</SelectItem>)}{vendors.map(vendor => <SelectItem key={`vendor:${vendor.id}`} value={`vendor:${vendor.id}`}>{vendor.name} · vendor</SelectItem>)}</SelectContent></Select></div>
                <div><p className="mb-1.5 text-[9px] font-extrabold text-[#08744f]">SCHEDULE</p><div className="flex h-9 w-[200px] rounded-lg bg-[#e4e9ee] p-1 text-[11px] font-bold"><button type="button" onClick={() => setServiceRecurring(false)} className={`flex-1 rounded-md ${!serviceRecurring ? 'bg-white text-[#172033] shadow-sm' : 'text-[#66758b]'}`}>One-time</button><button type="button" onClick={() => setServiceRecurring(true)} disabled={!job.scheduleId} className={`flex-1 rounded-md ${serviceRecurring ? 'bg-white text-[#172033] shadow-sm' : 'text-[#66758b]'} disabled:opacity-50`}>Recurring</button></div></div>
                <label className="block text-[9px] font-bold text-[#718096]">Start date<input type="date" value={serviceStartDate} onChange={event => setServiceStartDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#c9d8d2] bg-white px-3 text-[13px]" /></label>
                {serviceRecurring && <><div className="grid grid-cols-3 gap-2">{[['WEEKLY', 'Weekly'], ['BI_WEEKLY', 'Every 2 wks'], ['MONTHLY', 'Monthly']].map(([value, label]) => <button key={value} type="button" onClick={() => setServiceFrequency(value)} className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${serviceFrequency === value ? 'border-[#0b8557] bg-[#dff0e9] text-[#075f40]' : 'border-white bg-white text-[#66758b]'}`}>{label}</button>)}</div>{serviceFrequency !== 'MONTHLY' && <div className="flex gap-1.5">{['S','M','T','W','T','F','S'].map((letter, index) => <button key={index} type="button" onClick={() => setServiceDays(current => current.includes(index) ? current.filter(day => day !== index) : [...current, index].sort())} className={`flex h-8 flex-1 items-center justify-center rounded-md text-[10px] font-bold ${serviceDays.includes(index) ? 'bg-[#0b8557] text-white' : 'bg-white text-[#66758b]'}`}>{letter}</button>)}</div>}</>}
                <div className="grid grid-cols-3 gap-2"><label className="text-[9px] font-bold text-[#718096]">Client charged<input type="number" min="0" step="0.01" placeholder="0" value={serviceClientRate} onChange={event => setServiceClientRate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-white bg-white px-2 text-[13px] font-bold" /></label><label className="text-[9px] font-bold text-[#718096]">We pay<input type="number" min="0" step="0.01" placeholder="0" value={serviceProviderRate} onChange={event => setServiceProviderRate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-white bg-white px-2 text-[13px] font-bold" /></label><div className="pt-4 text-[9px] font-extrabold text-[#4b9b82]">MARGIN<span className="block text-[14px] text-[#066846]">${((Number(serviceClientRate) || 0) - (Number(serviceProviderRate) || 0)).toFixed(2)}</span></div></div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setAddServiceOpen(false)} className="rounded-lg bg-white px-3 py-2 text-[11px] font-bold text-[#66758b]">Cancel</button><button type="button" onClick={addService} disabled={busyAction === 'add-service'} className="flex min-w-[106px] items-center justify-center gap-1.5 rounded-lg bg-[#0B7A4E] px-3 py-2 text-[11px] font-extrabold text-white disabled:bg-[#a8cbbf]">{busyAction === 'add-service' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Add to clean</button></div>
              </div>
            )}
          </section>

          <section>
            <p className="mb-2 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">REPEATS</p>
            <div className="flex items-center gap-2 rounded-lg border border-[#dfe5ec] px-3 py-3 text-[13px] font-bold text-[#263246]"><Repeat2 className="h-4 w-4 text-[#08744f]" /><span className="min-w-0 flex-1 truncate capitalize">{scheduleSummary(job)}</span>{job.scheduleId && <button type="button" onClick={onChangeSchedule} className="shrink-0 text-[11px] font-extrabold text-[#08744f]">Change →</button>}</div>
          </section>

          {accessNotes && (
            <section className="border-t border-[#edf0f3] pt-3">
              <p className="mb-1.5 text-[10px] font-bold tracking-[0.4px] text-[#7f8ea3]">ACCESS &amp; CODES</p>
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#52627a]">{accessNotes}</p>
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(accessNotes); showSuccess("Access notes copied") }} className="shrink-0 rounded-md border border-[#b9d8cd] bg-[#edf7f3] px-2.5 py-1.5 text-[10px] font-extrabold text-[#08744f]">Copy</button>
              </div>
            </section>
          )}

          <textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={locked} placeholder="Add a note..." rows={2} className="w-full resize-none rounded-lg border border-[#dfe5ec] px-3 py-2.5 text-[13px] outline-none focus:border-[#0d9488] disabled:bg-[#f4f6f8]" />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-[#edf0f3] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {job.status === 'CANCELLED' ? <button type="button" onClick={restoreClean} disabled={busyAction === 'restore'} className="text-[12px] font-bold text-[#08744f]">Restore clean</button> : <button type="button" onClick={() => setCancelOpen(true)} disabled={locked} className="text-[12px] font-bold text-[#c11f1f] disabled:opacity-40">Cancel this job</button>}
          {job.scheduleId && job.status !== 'CANCELLED' && <button type="button" onClick={() => { const base = new Date(job.date); const today = new Date(); const start = base >= today ? base : today; setPauseFrom(""); setPauseTo(""); setPauseName(""); setPauseBilling("reduce"); setPauseCreditMode("visits"); setPauseCustomCredit(""); setPauseCalMonth(startOfMonth(start)); setPauseOpen(true) }} disabled={locked} className="text-[12px] font-bold text-[#66758b] disabled:opacity-40">Pause schedule...</button>}
          <button type="button" onClick={save} disabled={saving || locked} className="ml-auto flex min-w-[82px] items-center justify-center gap-1.5 rounded-lg bg-[#0B7A4E] px-4 py-2.5 text-[13px] font-extrabold text-white shadow-sm hover:bg-[#08633F] disabled:cursor-not-allowed disabled:bg-[#cbd5e1]">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{saving ? "Saving" : "Save"}</button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <DialogContent hideClose className="w-[min(92vw,516px)] max-w-[516px] gap-0 rounded-2xl border-0 p-0 shadow-2xl">
        <div className="flex items-center gap-2 px-5 pt-5">
          <button type="button" onClick={() => setCancelOpen(false)} aria-label="Back to booking" className="flex h-8 w-8 items-center justify-center rounded-md text-[#64748b] hover:bg-[#f1f4f6]"><ArrowLeft className="h-4 w-4" /></button>
          <DialogTitle className="text-[19px] font-extrabold text-[#172033]">Cancel this clean?</DialogTitle>
        </div>
        <DialogDescription className="px-6 pt-1 text-[13px] text-[#66758b]">{job.location.client.name}{job.scheduleId ? ' is recurring. How much should be cancelled?' : ' is a one-time clean.'}</DialogDescription>
        <div className="space-y-2.5 px-6 py-4">
          <label className="mb-2 block text-[10px] font-bold text-[#718096]">Cancellation fee for this clean (optional)<input type="number" min="0" step="0.01" value={cancelFee} onChange={event => setCancelFee(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#d9e1ea] px-3 text-[13px]" /></label>
          <button type="button" onClick={cancelSingleClean} disabled={Boolean(busyAction)} aria-busy={busyAction === 'cancel-single'} className="flex w-full items-center gap-3 rounded-xl border border-[#dfe5eb] px-4 py-3 text-left hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-70">
            {busyAction === 'cancel-single' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#078556]" />}
            <span><span className="block text-[14px] font-extrabold text-[#263246]">{busyAction === 'cancel-single' ? 'Cancelling clean...' : 'Cancel just this clean'}</span><span className="mt-0.5 block text-[11px] text-[#718096]">{format(new Date(job.date), 'EEE, MMM d')} only · the schedule continues</span></span>
          </button>
          {job.scheduleId && <button type="button" onClick={stopFutureCleans} disabled={Boolean(busyAction)} className="w-full rounded-xl border border-[#dfe5eb] px-4 py-3 text-left hover:bg-[#f8fafc]"><span className="block text-[14px] font-extrabold text-[#263246]">Cancel this &amp; all future cleans</span><span className="mt-0.5 block text-[11px] text-[#718096]">Ends the schedule from this date forward</span></button>}
          {job.scheduleId && <button type="button" onClick={deleteSchedule} disabled={Boolean(busyAction)} className="w-full rounded-xl border border-[#f5b6b6] px-4 py-3 text-left hover:bg-[#fff7f7]"><span className="block text-[14px] font-extrabold text-[#c11f1f]">Delete entire schedule</span><span className="mt-0.5 block text-[11px] text-[#d97878]">Removes the schedule and all unprotected cleans</span></button>}
          <button type="button" onClick={() => setCancelOpen(false)} className="w-full py-2 text-[12px] font-bold text-[#66758b]">Keep job</button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
      <DialogContent
        hideClose
        overlayClassName="bg-[#0f172a]/[0.34]"
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden border-0 bg-white p-[18px] shadow-[0_24px_64px_rgba(16,24,40,0.28)] sm:!h-auto sm:!max-h-[90vh] sm:!w-[min(95vw,790px)] sm:!max-w-[790px] sm:!gap-0 sm:!rounded-[14px] sm:!border-0 sm:!p-[20px_22px]"
      >
        <div className="flex items-center justify-between">
          <DialogTitle className="text-[17px] font-extrabold text-[#172033]">Pause schedule</DialogTitle>
          <button type="button" onClick={() => setPauseOpen(false)} aria-label="Close" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[#8a93a0] hover:bg-[#e6ebf1]"><X className="h-3.5 w-3.5" /></button>
        </div>
        <DialogDescription className="mt-[5px] text-[13px] leading-[1.5] text-[#64748b]">{job.location.client.name} — cleans in this range are skipped. The schedule resumes on its own.</DialogDescription>
        <div className="-mx-2 mt-[13px] grid min-h-0 flex-1 content-start gap-[18px] overflow-y-auto px-2 sm:grid-cols-[1.2fr_1fr]">
          {/* Left: calendar range picker */}
          <div className="self-start rounded-[11px] border border-[#e8ecf1] px-3 py-2.5">
            <div className="mb-[7px] flex items-center justify-between">
              <button type="button" onClick={() => setPauseCalMonth(addMonths(pauseCalMonth, -1))} className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f1f5f9] text-[#8a93a0] hover:bg-[#e6ebf1]">‹</button>
              <span className="text-[11px] font-semibold text-[#7f8ea3]">{pauseFrom && pauseTo ? "Dots are scheduled cleans." : pauseFrom ? "Now tap the last day off." : "Tap the first day off."}</span>
              <button type="button" onClick={() => setPauseCalMonth(addMonths(pauseCalMonth, 1))} className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f1f5f9] text-[#8a93a0] hover:bg-[#e6ebf1]">›</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <PauseMonth month={pauseCalMonth} fromStr={pauseFrom} toStr={pauseTo} cleanDays={pausePreview.cleanDays} onPick={pickPauseDate} />
              <PauseMonth month={addMonths(pauseCalMonth, 1)} fromStr={pauseFrom} toStr={pauseTo} cleanDays={pausePreview.cleanDays} onPick={pickPauseDate} />
            </div>
          </div>
          {/* Right: name + billing + preview */}
          <div className="flex flex-col gap-3">
            <input value={pauseName} onChange={e => setPauseName(e.target.value)} placeholder="Name (optional — e.g. Winter break)" className="w-full rounded-[9px] border border-[#d2d8e0] bg-[#f6f7f9] px-[11px] py-[9px] text-[13px] outline-none focus:border-[#0b8557]" />
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#7f8ea3]">Billing during the pause</p>
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setPauseBilling("full")} className={`flex-1 rounded-[10px] border px-3 py-2.5 text-left ${pauseBilling === "full" ? "border-[#0b8557] bg-[#eaf5f0]" : "border-[#e2e8f0] bg-white"}`}><span className="block text-[12.5px] font-bold text-[#0f172a]">Bill full rate</span><span className="mt-0.5 block text-[10.5px] text-[#7f8ea3]">Invoice stays the same</span></button>
                <button type="button" onClick={() => setPauseBilling("reduce")} className={`flex-1 rounded-[10px] border px-3 py-2.5 text-left ${pauseBilling === "reduce" ? "border-[#0b8557] bg-[#eaf5f0]" : "border-[#e2e8f0] bg-white"}`}><span className="block text-[12.5px] font-bold text-[#0f172a]">Reduce invoice</span><span className="mt-0.5 block text-[10.5px] text-[#7f8ea3]">Credit per skipped clean</span></button>
              </div>
              {pauseBilling === "reduce" && isFlatRatePause && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-1.5">
                    {([["visits", "By visits"], ["days", "By days"], ["custom", "Custom amount"]] as const).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setPauseCreditMode(v)} className={`flex-1 rounded-md border px-1 py-1.5 text-[11px] font-bold ${pauseCreditMode === v ? "border-[#0b8557] bg-[#dff0e9] text-[#075f40]" : "border-[#e2e8f0] bg-white text-[#66758b]"}`}>{label}</button>
                    ))}
                  </div>
                  {pauseCreditMode === "custom" && (
                    <div className="flex items-center gap-1.5"><span className="text-[13px] text-[#7f8ea3]">$</span><input type="number" min="0" value={pauseCustomCredit} onChange={e => setPauseCustomCredit(e.target.value)} placeholder="Credit amount" className="h-9 flex-1 rounded-lg border border-[#d2d8e0] bg-[#f6f7f9] px-3 text-[13px] outline-none focus:border-[#0b8557]" /></div>
                  )}
                </div>
              )}
              {pauseBilling === "reduce" && !isFlatRatePause && (
                <div className="mt-2 rounded-[9px] border border-[#cdeee5] bg-[#f2fbf9] px-3 py-2.5 text-[11px] leading-relaxed text-[#0f766e]">
                  Per-clean billing automatically removes skipped cleans from the invoice. No proration method is needed.
                </div>
              )}
            </div>
            {pauseFrom && pauseTo && (
              <div className="flex flex-col gap-[5px] rounded-[10px] border border-[#cdeee5] bg-[#f2fbf9] px-[13px] py-[11px] text-[12.5px]">
                {pausePreviewRows.map(row => (
                  <div key={row.label} className="flex items-center justify-between gap-3">
                    <span className="font-bold text-[#0f766e]">{row.label}</span>
                    <strong className="text-right tabular-nums text-[#0f172a]">{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2"><button type="button" onClick={() => setPauseOpen(false)} className="rounded-[9px] border border-[#e8ecf1] bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-[#64748b]">Keep as is</button><button type="button" onClick={pauseSchedule} disabled={busyAction === 'pause' || !pauseFrom || !pauseTo} className="flex min-w-[134px] items-center justify-center gap-2 rounded-[9px] bg-[#0B7A4E] px-4 py-[9px] text-[12.5px] font-extrabold text-white disabled:bg-[#a8cbbf]">{busyAction === 'pause' && <Loader2 className="h-4 w-4 animate-spin" />}Pause schedule</button></div>
      </DialogContent>
    </Dialog>
    </>
  )
}
