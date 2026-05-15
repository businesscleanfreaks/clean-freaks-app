"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScheduleForm } from "./schedule-form"
import { RecurringAddonForm } from "./recurring-addon-form"
import { AddOnCard } from "./add-on-card"
import { formatCurrency, formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getPrimaryScheduleForDisplay, sortSchedulesForDisplay } from "@/lib/schedule-timing"
import {
  Plus, Edit, Trash2, MapPin, ChevronDown, Calendar,
  Sparkles, User, CalendarPlus, CheckCircle,
  PauseCircle, PlayCircle, MoreVertical,
} from "lucide-react"
import type { ClientSchedule, ClientLocation, SubcontractorRecord, BillingType } from "./client-detail-types"
import {
  getAverageMonthlyScheduleOccurrences, parseScheduleDays, getScheduleFrequencyLabel,
  getScheduleTimingBadge, getScheduleHistoryLine,
  getScheduleHistoryOverview, DAY_NAMES, DAY_LETTERS, QUICK_ADD_SERVICES
} from "./client-detail-helpers"
import type { ClientDetailState } from "./use-client-detail"

interface ClientDetailLocationsProps {
  state: ClientDetailState
}

function scheduleTimeSuffix(sch: ClientSchedule) {
  if (sch.timeType === 'WINDOW' && (sch.startWindowBegin || sch.startWindowEnd)) {
    const a = sch.startWindowBegin ? formatTime(sch.startWindowBegin) : ''
    const b = sch.startWindowEnd ? formatTime(sch.startWindowEnd) : ''
    if (!a && !b) return ''
    return ` · ${a}${a && b ? '–' : ''}${b}`
  }
  if (sch.startTime) return ` · ${formatTime(sch.startTime)}`
  return ''
}

function scheduleSummary(sch: ClientSchedule) {
  const days = parseScheduleDays(sch.daysOfWeek)
  const dayText = days.length > 0 ? days.map((d: number) => DAY_NAMES[d]).join(', ') : 'No days set'
  return `${getScheduleFrequencyLabel(sch.frequency)} · ${dayText}${scheduleTimeSuffix(sch)}`
}

function payLabel(amount: number | null | undefined, payType: string | null | undefined) {
  return `${formatCurrency(amount || 0)}${payType === 'FLAT_RATE' ? '/mo' : '/clean'}`
}

function dateInputValue(date: string | Date | null | undefined) {
  if (!date) return ''
  return new Date(date).toISOString().slice(0, 10)
}

const INLINE_FREQUENCIES = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BI_WEEKLY', label: 'Bi-weekly' },
  { value: 'EVERY_3_WEEKS', label: 'Every 3 weeks' },
  { value: 'EVERY_4_WEEKS', label: 'Every 4 weeks' },
  { value: 'EVERY_6_WEEKS', label: 'Every 6 weeks' },
]

function compactLocationName(locationName: string, clientName: string) {
  let name = (locationName || 'Location').trim()
  const client = clientName.trim()
  if (client && name.toLowerCase().startsWith(client.toLowerCase())) {
    name = name.slice(client.length).trim()
  }
  name = name.replace(/^\((.*)\)$/, '$1').trim()
  return name || locationName || 'Location'
}

function getNextJobLabel(location: ClientLocation) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const jobs = ((location as { jobs?: Array<{ date: string | Date; status?: string; startTime?: string | null; startWindowBegin?: string | null; startWindowEnd?: string | null }> }).jobs || [])
    .filter((job) => job.status !== 'CANCELLED' && new Date(job.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const next = jobs[0]
  if (!next) return null
  const date = new Date(next.date)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  const dayLabel = day.getTime() === today.getTime()
    ? 'Today'
    : day.getTime() === tomorrow.getTime()
      ? 'Tomorrow'
      : format(date, 'EEE, MMM d')
  const timeLabel = next.startTime
    ? formatTime(next.startTime)
    : next.startWindowBegin || next.startWindowEnd
      ? `${next.startWindowBegin ? formatTime(next.startWindowBegin) : ''}${next.startWindowBegin && next.startWindowEnd ? '–' : ''}${next.startWindowEnd ? formatTime(next.startWindowEnd) : ''}`
      : 'Anytime'
  return `${dayLabel}, ${timeLabel}`
}

function DetailRow({
  label,
  value,
  onClick,
  muted,
  children,
  wrapValue,
}: {
  label: string
  value: ReactNode
  onClick?: () => void
  muted?: boolean
  children?: ReactNode
  wrapValue?: boolean
}) {
  const content = (
    <>
      <span className="w-24 flex-shrink-0 text-xs font-normal lowercase text-slate-400">{label}</span>
      <span className={`min-w-0 flex-1 text-sm font-semibold ${wrapValue ? 'whitespace-normal break-words leading-snug' : 'truncate'} ${muted ? 'text-slate-400' : 'text-slate-800'}`}>{value}</span>
      {children}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 border-b border-gray-100 px-3.5 py-1.5 text-left hover:bg-gray-50 last:border-b-0"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-3 border-b border-gray-100 px-3.5 py-1.5 last:border-b-0">
      {content}
    </div>
  )
}

export function ClientDetailLocations({ state }: ClientDetailLocationsProps) {
  const [reassignEffectiveDate, setReassignEffectiveDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  )
  const [locationMenuOpen, setLocationMenuOpen] = useState<string | null>(null)
  const [inlineEdit, setInlineEdit] = useState<
    | { type: 'schedule'; scheduleId: string; field: 'defaultClientRate' | 'defaultSubcontractorRate' }
    | { type: 'location'; locationId: string; field: 'accessInfo' }
    | null
  >(null)
  const [locationHeaderEdit, setLocationHeaderEdit] = useState<{
    locationId: string
    name: string
    address: string
  } | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const [scheduleInlineEdit, setScheduleInlineEdit] = useState<{
    scheduleId: string
    frequency: string
    daysOfWeek: number[]
    timeType: 'SPECIFIC' | 'WINDOW'
    startTime: string
    startWindowBegin: string
    startWindowEnd: string
    startDate: string
    endDate: string
  } | null>(null)
  const [savingInline, setSavingInline] = useState(false)
  const {
    client,
    subcontractors,
    addingLocation,
    setAddingLocation,
    newLocation,
    setNewLocation,
    handleAddLocation,
    expandedLocation,
    setExpandedLocation,
    addingScheduleToLocation,
    setAddingScheduleToLocation,
    editingSchedule,
    setEditingSchedule,
    scheduleFormMode,
    setScheduleFormMode,
    closeScheduleEditor,
    reassigningSchedule,
    setReassigningSchedule,
    scheduleMenuOpen,
    setScheduleMenuOpen,
    addingAddonToSchedule,
    setAddingAddonToSchedule,
    addingOneTimeJob,
    setAddingOneTimeJob,
    oneTimeJobDate,
    setOneTimeJobDate,
    oneTimeJobCustomTime,
    setOneTimeJobCustomTime,
    oneTimeJobTime,
    setOneTimeJobTime,
    creatingOneTimeJob,
    togglingScheduleId,
    handleDeleteLocation,
    handleDeleteSchedule,
    handleToggleSchedulePause,
    handleQuickReassign,
    handleCreateOneTimeJob,
    onDataChange,
  } = state

  // Click-outside dismiss for schedule menu and reassign dropdown
  const dropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scheduleMenuOpen && !reassigningSchedule && !locationMenuOpen) return
    const handler = (e: MouseEvent) => {
      // Don't close if clicking inside a dropdown
      const target = e.target as Node
      const dropdowns = document.querySelectorAll('[data-dropdown-menu]')
      for (const dd of dropdowns) {
        if (dd.contains(target)) return
      }
      if (scheduleMenuOpen) setScheduleMenuOpen(null)
      if (reassigningSchedule) setReassigningSchedule(null)
      if (locationMenuOpen) setLocationMenuOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scheduleMenuOpen, reassigningSchedule, locationMenuOpen, setScheduleMenuOpen, setReassigningSchedule])

  const allActiveScheduleIds = useMemo(
    () =>
      (client.locations || []).flatMap((l) =>
        (l.schedules || []).filter((s) => s.isActive !== false).map((s) => s.id)
      ),
    [client.locations]
  )

  const startScheduleRateEdit = (
    scheduleId: string,
    field: 'defaultClientRate' | 'defaultSubcontractorRate',
    value: number | null | undefined
  ) => {
    setInlineEdit({ type: 'schedule', scheduleId, field })
    setInlineValue(String(value ?? 0))
  }

  const startLocationEdit = (locationId: string, field: 'accessInfo', value: string | null | undefined) => {
    setInlineEdit({ type: 'location', locationId, field })
    setInlineValue(value || '')
  }

  const startScheduleInlineEdit = (schedule: ClientSchedule) => {
    setScheduleInlineEdit({
      scheduleId: schedule.id,
      frequency: schedule.frequency || 'WEEKLY',
      daysOfWeek: parseScheduleDays(schedule.daysOfWeek),
      timeType: (schedule.timeType || 'SPECIFIC') as 'SPECIFIC' | 'WINDOW',
      startTime: schedule.startTime || '',
      startWindowBegin: schedule.startWindowBegin || '',
      startWindowEnd: schedule.startWindowEnd || '',
      startDate: dateInputValue(schedule.startDate),
      endDate: dateInputValue(schedule.endDate),
    })
  }

  const startLocationHeaderEdit = (location: ClientLocation) => {
    setLocationHeaderEdit({
      locationId: location.id,
      name: location.name || '',
      address: location.address || '',
    })
  }

  const cancelInlineEdit = () => {
    setInlineEdit(null)
    setInlineValue('')
  }

  const saveInlineEdit = async () => {
    if (!inlineEdit || savingInline) return
    setSavingInline(true)

    try {
      const endpoint = inlineEdit.type === 'schedule'
        ? `/api/schedules/${inlineEdit.scheduleId}`
        : `/api/locations/${inlineEdit.locationId}`
      const value = inlineEdit.type === 'schedule'
        ? Number(inlineValue)
        : inlineValue.trim() || null

      if (inlineEdit.type === 'schedule' && (!Number.isFinite(value as number) || (value as number) < 0)) {
        showError('Enter a valid non-negative amount')
        setSavingInline(false)
        return
      }

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [inlineEdit.field]: value }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to save field')
        return
      }

      showSuccess('Saved')
      cancelInlineEdit()
      onDataChange?.()
    } catch {
      showError('Failed to save field')
    } finally {
      setSavingInline(false)
    }
  }

  const saveScheduleInlineEdit = async () => {
    if (!scheduleInlineEdit || savingInline) return

    if (scheduleInlineEdit.daysOfWeek.length === 0) {
      showError('Select at least one schedule day')
      return
    }

    if (scheduleInlineEdit.timeType === 'SPECIFIC' && !scheduleInlineEdit.startTime) {
      showError('Choose a start time')
      return
    }

    if (scheduleInlineEdit.timeType === 'WINDOW' && !scheduleInlineEdit.startWindowBegin && !scheduleInlineEdit.startWindowEnd) {
      showError('Choose a time window')
      return
    }

    setSavingInline(true)
    try {
      const response = await fetch(`/api/schedules/${scheduleInlineEdit.scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequency: scheduleInlineEdit.frequency,
          daysOfWeek: JSON.stringify([...scheduleInlineEdit.daysOfWeek].sort()),
          timeType: scheduleInlineEdit.timeType,
          startTime: scheduleInlineEdit.timeType === 'SPECIFIC' ? scheduleInlineEdit.startTime : null,
          startWindowBegin: scheduleInlineEdit.timeType === 'WINDOW' ? scheduleInlineEdit.startWindowBegin || null : null,
          startWindowEnd: scheduleInlineEdit.timeType === 'WINDOW' ? scheduleInlineEdit.startWindowEnd || null : null,
          startDate: scheduleInlineEdit.startDate ? new Date(`${scheduleInlineEdit.startDate}T12:00:00Z`).toISOString() : undefined,
          endDate: scheduleInlineEdit.endDate ? new Date(`${scheduleInlineEdit.endDate}T12:00:00Z`).toISOString() : null,
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to save schedule')
        return
      }

      showSuccess('Schedule saved')
      setScheduleInlineEdit(null)
      onDataChange?.()
    } catch {
      showError('Failed to save schedule')
    } finally {
      setSavingInline(false)
    }
  }

  const saveLocationHeaderEdit = async () => {
    if (!locationHeaderEdit || savingInline) return
    if (!locationHeaderEdit.name.trim()) {
      showError('Location name is required')
      return
    }

    setSavingInline(true)
    try {
      const response = await fetch(`/api/locations/${locationHeaderEdit.locationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: locationHeaderEdit.name.trim(),
          address: locationHeaderEdit.address.trim() || null,
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to save location')
        return
      }

      showSuccess('Location saved')
      setLocationHeaderEdit(null)
      onDataChange?.()
    } catch {
      showError('Failed to save location')
    } finally {
      setSavingInline(false)
    }
  }

  const handleInlineKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveInlineEdit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelInlineEdit()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.16em]">Locations</h2>
        <button onClick={() => setAddingLocation(!addingLocation)} className="text-sm font-medium transition-colors" style={{ color: '#00A896' }}>
          + Add Location
        </button>
      </div>

      {addingLocation && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
          <p className="text-sm font-semibold text-gray-800 mb-3">New Location</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs text-slate-500 uppercase tracking-[0.14em]">Name</Label>
              <Input value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })} placeholder="e.g., Main Office" className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs text-slate-500 uppercase tracking-[0.14em]">Address</Label>
              <Input value={newLocation.address} onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })} placeholder="Full street address" className="mt-1 h-9" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddLocation} className="h-9 text-sm text-white" style={{ background: '#00A896' }}>Add</Button>
            <Button variant="outline" onClick={() => { setAddingLocation(false); setNewLocation({ name: '', address: '' }) }} className="h-9 text-sm">Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {client.locations?.length > 0 ? client.locations.map((location: ClientLocation) => {
          const isExpanded = expandedLocation === location.id
          const sortedSchedules = sortSchedulesForDisplay(location.schedules || [])
          const schedule = getPrimaryScheduleForDisplay(sortedSchedules)
          const scheduleDays = parseScheduleDays(schedule?.daysOfWeek)
          const scheduleTiming = schedule ? getScheduleTimingBadge(schedule) : null
          const scheduleHistoryOverview = getScheduleHistoryOverview(sortedSchedules)
          const additionalRuleCount = Math.max(sortedSchedules.length - 1, 0)
          const nextJobLabel = getNextJobLabel(location)
          return (
            <div key={location.id} className="bg-white rounded-lg border border-gray-200 overflow-visible">
              {/* Location name + address */}
              <div className="border-b border-gray-100">
                {locationHeaderEdit?.locationId === location.id ? (
                  <div className="px-3.5 py-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr_auto_auto]">
                      <Input
                        autoFocus
                        value={locationHeaderEdit.name}
                        onChange={(event) => setLocationHeaderEdit((prev) => prev ? { ...prev, name: event.target.value } : prev)}
                        className="h-8 text-sm font-semibold"
                        placeholder="Location name"
                      />
                      <Input
                        value={locationHeaderEdit.address}
                        onChange={(event) => setLocationHeaderEdit((prev) => prev ? { ...prev, address: event.target.value } : prev)}
                        className="h-8 text-sm"
                        placeholder="Address"
                      />
                      <button
                        type="button"
                        onClick={saveLocationHeaderEdit}
                        disabled={savingInline}
                        className="h-8 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingInline ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocationHeaderEdit(null)}
                        className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startLocationHeaderEdit(location)}
                    className="block w-full px-3.5 py-1.5 text-left hover:bg-gray-50"
                  >
                    <p className="text-sm font-semibold text-gray-900">{compactLocationName(location.name, client.name)}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{location.address}</p>
                    {nextJobLabel && (
                      <p className="mt-0.5 text-xs font-medium text-teal-700">Next: {nextJobLabel}</p>
                    )}
                    {scheduleHistoryOverview && (
                      <p className="mt-0.5 text-[11px] text-slate-500">{scheduleHistoryOverview}</p>
                    )}
                  </button>
                )}
              </div>

              {/* Schedules — always flat visible */}
              {sortedSchedules.length > 0 ? sortedSchedules.map((sch: ClientSchedule) => {
                const days = parseScheduleDays(sch.daysOfWeek)
                const timingBadge = getScheduleTimingBadge(sch)
                const clientPayType = sch.clientPayType || client.billingType || 'PER_CLEAN'
                const avgOcc = getAverageMonthlyScheduleOccurrences(sch)
                const subPayType = sch.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN'
                const editingClientRate = inlineEdit?.type === 'schedule' && inlineEdit.scheduleId === sch.id && inlineEdit.field === 'defaultClientRate'
                const editingCleanerRate = inlineEdit?.type === 'schedule' && inlineEdit.scheduleId === sch.id && inlineEdit.field === 'defaultSubcontractorRate'
                const editingAccessInfo = inlineEdit?.type === 'location' && inlineEdit.locationId === location.id && inlineEdit.field === 'accessInfo'
                const effectiveClientRate = editingClientRate && Number.isFinite(Number(inlineValue)) ? Number(inlineValue) : (sch.defaultClientRate || 0)
                const effectiveCleanerRate = editingCleanerRate && Number.isFinite(Number(inlineValue)) ? Number(inlineValue) : (sch.defaultSubcontractorRate || 0)
                const rev = clientPayType === 'FLAT_RATE' ? effectiveClientRate : (effectiveClientRate * avgOcc)
                const cost = subPayType === 'FLAT_RATE' ? effectiveCleanerRate : (effectiveCleanerRate * avgOcc)
                const profit = rev - cost
                return (
                  <Fragment key={sch.id}>
                  <div className={`border-t border-gray-100 ${sch.isActive === false ? 'opacity-60' : ''}`}>
                    <DetailRow
                      label="Schedule"
                      value={(
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{scheduleSummary(sch)}</span>
                          {timingBadge.label !== 'Current' && (
                            <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${timingBadge.className}`}>{timingBadge.label}</span>
                          )}
                          {sch.isActive === false && <span className="shrink-0 text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Paused</span>}
                        </span>
                      )}
                      onClick={() => startScheduleInlineEdit(sch)}
                    />
                    {scheduleInlineEdit?.scheduleId === sch.id && (
                      <div className="border-b border-gray-100 bg-gray-50 px-3.5 py-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr]">
                          <select
                            value={scheduleInlineEdit.frequency}
                            onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, frequency: event.target.value } : prev)}
                            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none focus:border-teal-500"
                          >
                            {INLINE_FREQUENCIES.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-1">
                            {DAY_LETTERS.map((letter, day) => {
                              const active = scheduleInlineEdit.daysOfWeek.includes(day)
                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => setScheduleInlineEdit((prev) => {
                                    if (!prev) return prev
                                    const days = active
                                      ? prev.daysOfWeek.filter((d) => d !== day)
                                      : [...prev.daysOfWeek, day]
                                    return { ...prev, daysOfWeek: days }
                                  })}
                                  className={`h-8 w-8 rounded-md border text-xs font-semibold ${active ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-gray-200 bg-white text-slate-500 hover:bg-gray-100'}`}
                                >
                                  {letter}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={scheduleInlineEdit.timeType}
                            onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, timeType: event.target.value as 'SPECIFIC' | 'WINDOW' } : prev)}
                            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-slate-800 outline-none focus:border-teal-500"
                          >
                            <option value="SPECIFIC">Specific time</option>
                            <option value="WINDOW">Time window</option>
                          </select>
                          {scheduleInlineEdit.timeType === 'SPECIFIC' ? (
                            <Input
                              type="time"
                              value={scheduleInlineEdit.startTime}
                              onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, startTime: event.target.value } : prev)}
                              className="h-8 w-32"
                            />
                          ) : (
                            <>
                              <Input
                                type="time"
                                value={scheduleInlineEdit.startWindowBegin}
                                onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, startWindowBegin: event.target.value } : prev)}
                                className="h-8 w-32"
                              />
                              <span className="text-xs text-slate-400">to</span>
                              <Input
                                type="time"
                                value={scheduleInlineEdit.startWindowEnd}
                                onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, startWindowEnd: event.target.value } : prev)}
                                className="h-8 w-32"
                              />
                            </>
                          )}
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            Start
                            <Input
                              type="date"
                              value={scheduleInlineEdit.startDate}
                              onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, startDate: event.target.value } : prev)}
                              className="h-8 w-36"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            End
                            <Input
                              type="date"
                              value={scheduleInlineEdit.endDate}
                              onChange={(event) => setScheduleInlineEdit((prev) => prev ? { ...prev, endDate: event.target.value } : prev)}
                              className="h-8 w-36"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={saveScheduleInlineEdit}
                            disabled={savingInline}
                            className="h-8 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingInline ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setScheduleInlineEdit(null)}
                            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <DetailRow
                      label="Client Billing"
                      value={editingClientRate ? (
                        <Input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          value={inlineValue}
                          onChange={(event) => setInlineValue(event.target.value)}
                          onKeyDown={handleInlineKeyDown}
                          onBlur={saveInlineEdit}
                          disabled={savingInline}
                          className="h-7 w-28 text-sm font-semibold"
                        />
                      ) : payLabel(sch.defaultClientRate, clientPayType)}
                      onClick={editingClientRate ? undefined : () => startScheduleRateEdit(sch.id, 'defaultClientRate', sch.defaultClientRate)}
                    />
                    <DetailRow
                      label="Cleaner Pay"
                      value={editingCleanerRate ? (
                        <Input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          value={inlineValue}
                          onChange={(event) => setInlineValue(event.target.value)}
                          onKeyDown={handleInlineKeyDown}
                          onBlur={saveInlineEdit}
                          disabled={savingInline}
                          className="h-7 w-28 text-sm font-semibold"
                        />
                      ) : payLabel(sch.defaultSubcontractorRate, subPayType)}
                      onClick={editingCleanerRate ? undefined : () => startScheduleRateEdit(sch.id, 'defaultSubcontractorRate', sch.defaultSubcontractorRate)}
                    />
                    <DetailRow
                      label="Margin"
                      value={`${formatCurrency(profit)}/mo`}
                      muted={profit < 0}
                    />
                    <div data-dropdown-menu>
                      <DetailRow
                        label="Cleaner"
                        value={sch.subcontractor?.name || 'Unassigned'}
                        muted={!sch.subcontractor?.name}
                        onClick={() => setReassigningSchedule(reassigningSchedule === sch.id ? null : sch.id)}
                      />
                      {reassigningSchedule === sch.id && (
                        <div className="border-b border-gray-100 bg-gray-50 px-3.5 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => handleQuickReassign(sch.id, null, reassignEffectiveDate)}
                              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-gray-100"
                            >
                              Unassigned
                            </button>
                            {subcontractors.filter((sub: SubcontractorRecord) => sub.isActive !== false || sub.id === sch.subcontractorId).map((sub: SubcontractorRecord) => (
                              <button
                                key={sub.id}
                                onClick={() => handleQuickReassign(sch.id, sub.id, reassignEffectiveDate)}
                                className={`rounded-md border px-2 py-1 text-xs font-medium ${sch.subcontractorId === sub.id ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-gray-200 bg-white text-slate-600 hover:bg-gray-100'}`}
                              >
                                {sub.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <DetailRow
                      label="Entry Codes"
                      value={editingAccessInfo ? (
                        <Input
                          autoFocus
                          value={inlineValue}
                          onChange={(event) => setInlineValue(event.target.value)}
                          onKeyDown={handleInlineKeyDown}
                          onBlur={saveInlineEdit}
                          disabled={savingInline}
                          className="h-7 text-sm font-semibold"
                        />
                      ) : location.accessInfo || 'Add entry info'}
                      muted={!location.accessInfo}
                      onClick={editingAccessInfo ? undefined : () => startLocationEdit(location.id, 'accessInfo', location.accessInfo)}
                      wrapValue={!editingAccessInfo}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-1.5 bg-gray-50/70">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => {
                            setAddingOneTimeJob(addingOneTimeJob === sch.id ? null : sch.id)
                            if (!oneTimeJobDate) setOneTimeJobDate(new Date().toISOString().split('T')[0])
                          }}
                          className="rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                        >
                          + Add Clean
                        </button>
                        <button
                          onClick={() => setAddingAddonToSchedule(sch.id)}
                          className="rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-50"
                        >
                          + Add-on
                        </button>
                        <button
                          onClick={() => handleToggleSchedulePause(sch.id, sch.isActive !== false)}
                          disabled={togglingScheduleId === sch.id}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-gray-100"
                        >
                          {togglingScheduleId === sch.id
                            ? sch.isActive !== false ? 'Pausing...' : 'Resuming...'
                            : sch.isActive !== false ? 'Pause' : 'Resume'}
                        </button>
                      </div>
                      <div className="relative">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            setLocationMenuOpen(locationMenuOpen === `${location.id}:${sch.id}` ? null : `${location.id}:${sch.id}`)
                          }}
                          className="rounded-lg border border-gray-200 bg-white p-1.5 text-slate-500 hover:bg-gray-100"
                          aria-label="Location options"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {locationMenuOpen === `${location.id}:${sch.id}` && (
                          <div data-dropdown-menu className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
                            <button
                              onClick={() => {
                                setLocationMenuOpen(null)
                                setExpandedLocation(location.id)
                                setAddingScheduleToLocation(location.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <CalendarPlus className="h-3.5 w-3.5 text-gray-400" />
                              Add Recurring Job
                            </button>
                            <button
                              onClick={() => {
                                setLocationMenuOpen(null)
                                setScheduleFormMode('edit')
                                setEditingSchedule({ ...sch, locationId: location.id })
                                setExpandedLocation(location.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Edit className="h-3.5 w-3.5 text-gray-400" />
                              Change Schedule
                            </button>
                            <button
                              onClick={() => {
                                setLocationMenuOpen(null)
                                handleDeleteLocation(location.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete Location
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {addingOneTimeJob === sch.id && (
                    <div className="px-4 py-3 bg-teal-50/40 border-t border-teal-100">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                        <div>
                          <Label className="text-xs text-slate-500 uppercase tracking-[0.14em]">Clean Date</Label>
                          <Input type="date" value={oneTimeJobDate} onChange={(e) => setOneTimeJobDate(e.target.value)} className="mt-1 h-9" />
                        </div>
                        <label className="flex h-9 items-center gap-2 text-sm text-slate-600">
                          <input type="checkbox" checked={oneTimeJobCustomTime} onChange={(e) => setOneTimeJobCustomTime(e.target.checked)} />
                          Custom time
                        </label>
                        {oneTimeJobCustomTime && (
                          <Input type="time" value={oneTimeJobTime} onChange={(e) => setOneTimeJobTime(e.target.value)} className="h-9" />
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          onClick={() => handleCreateOneTimeJob(sch, location.id)}
                          disabled={creatingOneTimeJob}
                          className="h-9 text-sm text-white"
                          style={{ background: '#00A896' }}
                        >
                          {creatingOneTimeJob ? 'Adding...' : 'Add Clean'}
                        </Button>
                        <Button variant="outline" onClick={() => setAddingOneTimeJob(null)} className="h-9 text-sm">Cancel</Button>
                      </div>
                    </div>
                  )}
                  <div className={`hidden px-4 py-2.5 border-t border-gray-100 ${sch.isActive === false ? 'opacity-60' : ''}`}>
                    <p className="text-sm text-gray-700 mb-1 flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{getScheduleFrequencyLabel(sch.frequency)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${timingBadge.className}`}>{timingBadge.label}</span>
                      {sch.isActive === false && <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Paused</span>}
                      {days.length > 0 && <span className="text-slate-500"> · {days.map((d: number) => DAY_NAMES[d]).join(', ')}</span>}
                      {scheduleTimeSuffix(sch) && <span className="text-slate-500">{scheduleTimeSuffix(sch)}</span>}
                    </p>
                    <p className="text-xs text-slate-600 mb-2">{getScheduleHistoryLine(sch)}</p>
                    <div className="flex items-center justify-between">
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setReassigningSchedule(reassigningSchedule === sch.id ? null : sch.id) }}
                          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
                        >
                          <User className="w-3.5 h-3.5" />
                          <span className={sch.subcontractor?.name ? '' : 'text-amber-500'}>{sch.subcontractor?.name || 'Unassigned'}</span>
                          <ChevronDown className={`w-3 h-3 transition-transform ${reassigningSchedule === sch.id ? 'rotate-180' : ''}`} />
                        </button>
                        {reassigningSchedule === sch.id && (
                          <div data-dropdown-menu className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl border border-gray-200 shadow-xl z-50 py-1">
                            <div className="px-3 py-2 border-b border-gray-100">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-[0.14em]">Assign Cleaner</p>
                            </div>
                            <div className="px-3 py-1.5 border-b border-gray-100">
                              <label className="text-[11px] font-medium text-slate-500 block mb-1">Effective from</label>
                              <input
                                type="date"
                                value={reassignEffectiveDate}
                                onChange={(e) => setReassignEffectiveDate(e.target.value)}
                                className="w-full text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                            </div>
                            <button
                              onClick={() => handleQuickReassign(sch.id, null, reassignEffectiveDate)}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 ${!sch.subcontractorId ? 'text-teal-700' : 'text-gray-600'}`}
                            >
                              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">?</div>
                              Unassigned
                              {!sch.subcontractorId && <CheckCircle className="w-4 h-4 ml-auto text-teal-600" />}
                            </button>
                            {subcontractors.filter((sub: SubcontractorRecord) => sub.isActive !== false || sub.id === sch.subcontractorId).map((sub: SubcontractorRecord) => (
                              <button
                                key={sub.id}
                                onClick={() => handleQuickReassign(sch.id, sub.id, reassignEffectiveDate)}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 ${sch.subcontractorId === sub.id ? 'text-teal-700' : 'text-gray-600'}`}
                              >
                                <div className="w-6 h-6 rounded-full bg-teal-600 flex items-center justify-center text-xs font-bold text-white">
                                  {sub.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                                </div>
                                {sub.name}
                                {sch.subcontractorId === sub.id && <CheckCircle className="w-4 h-4 ml-auto text-teal-600" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded">{formatCurrency(rev)}/mo</span>
                        <span className="text-[11px] font-medium text-slate-400">→</span>
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${profit >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                          {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                        </span>
                        {(sch as any).recurringAddOnServices?.length > 0 && (
                          <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-full">
                            {(sch as any).recurringAddOnServices.length} add-on{(sch as any).recurringAddOnServices.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setScheduleMenuOpen(scheduleMenuOpen === sch.id ? null : sch.id) }}
                            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
                            aria-label="Schedule options"
                          >
                            <MoreVertical className="w-4 h-4 text-slate-400" />
                          </button>
                          {scheduleMenuOpen === sch.id && (
                            <div data-dropdown-menu className="absolute top-full right-0 mt-1 w-44 bg-white rounded-xl border border-gray-200 shadow-xl z-50 py-1">
                              <button
                                onClick={() => {
                                  setScheduleMenuOpen(null)
                                  setExpandedLocation(location.id)
                                  setScheduleFormMode('edit')
                                  setEditingSchedule({ ...sch, locationId: location.id })
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Edit className="w-3.5 h-3.5 text-gray-400" />
                                Edit Schedule
                              </button>
                              <button
                                onClick={() => {
                                  setScheduleMenuOpen(null)
                                  setExpandedLocation(location.id)
                                  setScheduleFormMode('future')
                                  setEditingSchedule({ ...sch, locationId: location.id })
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <CalendarPlus className="w-3.5 h-3.5 text-gray-400" />
                                Change Going Forward
                              </button>
                              <button
                                onClick={() => {
                                  setScheduleMenuOpen(null)
                                  handleToggleSchedulePause(sch.id, sch.isActive !== false)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                {sch.isActive !== false ? (
                                  <><PauseCircle className="w-3.5 h-3.5 text-gray-400" /> Pause Schedule</>
                                ) : (
                                  <><PlayCircle className="w-3.5 h-3.5 text-teal-600" /> Resume Schedule</>
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setScheduleMenuOpen(null)
                                  setExpandedLocation(location.id)
                                  setAddingAddonToSchedule(sch.id)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                Add recurring add-on
                              </button>
                              <button
                                onClick={() => {
                                  setScheduleMenuOpen(null)
                                  handleDeleteSchedule(sch.id)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete Schedule
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {addingAddonToSchedule === sch.id && (
                    <div className="px-4 py-3 bg-purple-50/40 border-t border-purple-100">
                      <RecurringAddonForm
                        scheduleId={sch.id}
                        siblingScheduleIds={allActiveScheduleIds.filter((id) => id !== sch.id)}
                        onSuccess={() => { setAddingAddonToSchedule(null); onDataChange?.() }}
                        onCancel={() => setAddingAddonToSchedule(null)}
                      />
                    </div>
                  )}
                  </Fragment>
                )
              }) : (
                <div className="px-4 py-2.5 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setExpandedLocation(location.id)
                      setAddingScheduleToLocation(location.id)
                    }}
                    className="flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: '#F59E0B' }}
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    No schedule — tap to add
                  </button>
                </div>
              )}

              {/* Expanded edit area */}
              {isExpanded && (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                  {addingScheduleToLocation === location.id && (
                    <div className="mb-3 p-4 bg-white rounded-xl border border-gray-200">
                      <ScheduleForm
                        locationId={location.id}
                        clientBillingType={client.billingType as BillingType}
                        clientCleanerPayType={(client.cleanerPayType || 'PER_CLEAN') as BillingType}
                        onSuccess={() => { setAddingScheduleToLocation(null); onDataChange?.() }}
                        onCancel={() => setAddingScheduleToLocation(null)}
                      />
                    </div>
                  )}
                  {editingSchedule?.locationId === location.id && (
                    <div className="mb-3 p-4 bg-white rounded-xl border border-gray-200">
                      <ScheduleForm
                        locationId={location.id}
                        clientBillingType={client.billingType as BillingType}
                        clientCleanerPayType={(client.cleanerPayType || 'PER_CLEAN') as BillingType}
                        schedule={editingSchedule}
                        mode={scheduleFormMode}
                        onSuccess={() => { closeScheduleEditor(); onDataChange?.() }}
                        onCancel={closeScheduleEditor}
                      />
                    </div>
                  )}
                  {sortedSchedules.map((sch: ClientSchedule) => {
                    if (editingSchedule?.id === sch.id) return null
                    const recurring = (sch as { recurringAddOnServices?: Array<{
                      id: string
                      description: string
                      clientRate: number
                      subcontractorRate: number
                      frequency?: string | null
                      isRecurring: boolean
                    }> }).recurringAddOnServices
                    if (!recurring?.length) return null
                    return (
                      <div key={`addon-list-${sch.id}`} className="mt-2 mb-2 p-3 bg-white rounded-lg border border-purple-100">
                        <p className="text-xs font-semibold text-purple-800 mb-2">{getScheduleFrequencyLabel(sch.frequency)} — recurring add-ons</p>
                        <div className="space-y-2">
                          {recurring.map((addon) => (
                            <AddOnCard
                              key={addon.id}
                              addOn={{ ...addon, isRecurring: true }}
                              onDelete={() => onDataChange?.()}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }) : (
          <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
            <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500 mb-3">No locations added yet</p>
            <Button onClick={() => setAddingLocation(true)} className="text-sm h-9 text-white" style={{ background: '#00A896' }}>+ Add Location</Button>
          </div>
        )}
      </div>
    </div>
  )
}
