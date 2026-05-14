"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScheduleForm } from "./schedule-form"
import { RecurringAddonForm } from "./recurring-addon-form"
import { AddOnCard } from "./add-on-card"
import { formatCurrency, formatTime } from "@/lib/utils"
import { format } from "date-fns"
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
}: {
  label: string
  value: ReactNode
  onClick?: () => void
  muted?: boolean
}) {
  const content = (
    <>
      <span className="w-28 flex-shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${muted ? 'text-slate-400' : 'text-slate-700'}`}>{value}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-2.5 text-left hover:bg-gray-50 last:border-b-0"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0">
      {content}
    </div>
  )
}

export function ClientDetailLocations({ state }: ClientDetailLocationsProps) {
  const [reassignEffectiveDate, setReassignEffectiveDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  )
  const [locationMenuOpen, setLocationMenuOpen] = useState<string | null>(null)
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

      <div className="space-y-3">
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
            <div key={location.id} className="bg-white rounded-xl border border-gray-200 overflow-visible">
              {/* Location name + address */}
              <div className="px-4 py-3 flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm">{location.name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{location.address}</p>
                  {nextJobLabel && (
                    <p className="text-xs font-medium text-teal-700 mt-1">Next: {nextJobLabel}</p>
                  )}
                  {location.accessInfo && (
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                      <span className="inline-block w-3 h-3 text-slate-300">🔑</span>
                      {location.accessInfo}
                    </p>
                  )}
                  {scheduleHistoryOverview && (
                    <p className="text-[11px] text-slate-500 mt-1">{scheduleHistoryOverview}</p>
                  )}
                </div>
                <div className="relative ml-3 flex-shrink-0">
                  <button
                    onClick={() => setLocationMenuOpen(locationMenuOpen === location.id ? null : location.id)}
                    className="rounded-lg p-1.5 transition-colors hover:bg-gray-50"
                    aria-label="Location options"
                  >
                    <MoreVertical className="h-4 w-4 text-slate-400" />
                  </button>
                  {locationMenuOpen === location.id && (
                    <div data-dropdown-menu className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
                      <button
                        onClick={() => {
                          setLocationMenuOpen(null)
                          setExpandedLocation(isExpanded ? null : location.id)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {isExpanded ? 'Done Editing' : 'Edit Location'}
                      </button>
                      <button
                        onClick={() => {
                          setLocationMenuOpen(null)
                          setExpandedLocation(location.id)
                          setAddingScheduleToLocation(location.id)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Add Recurring Job
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Schedules — always flat visible */}
              {sortedSchedules.length > 0 ? sortedSchedules.map((sch: ClientSchedule) => {
                const days = parseScheduleDays(sch.daysOfWeek)
                const timingBadge = getScheduleTimingBadge(sch)
                const clientPayType = sch.clientPayType || client.billingType || 'PER_CLEAN'
                const avgOcc = getAverageMonthlyScheduleOccurrences(sch)
                const rev = clientPayType === 'FLAT_RATE' ? (sch.defaultClientRate || 0) : ((sch.defaultClientRate || 0) * avgOcc)
                const subPayType = sch.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN'
                const cost = subPayType === 'FLAT_RATE' ? (sch.defaultSubcontractorRate || 0) : ((sch.defaultSubcontractorRate || 0) * avgOcc)
                const profit = rev - cost
                return (
                  <Fragment key={sch.id}>
                  <div className={`border-t border-gray-100 ${sch.isActive === false ? 'opacity-60' : ''}`}>
                    <DetailRow
                      label="Schedule"
                      value={(
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{scheduleSummary(sch)}</span>
                          <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${timingBadge.className}`}>{timingBadge.label}</span>
                          {sch.isActive === false && <span className="shrink-0 text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Paused</span>}
                        </span>
                      )}
                      onClick={() => {
                        setExpandedLocation(location.id)
                        setScheduleFormMode('edit')
                        setEditingSchedule({ ...sch, locationId: location.id })
                      }}
                    />
                    <DetailRow
                      label="Client Billing"
                      value={payLabel(sch.defaultClientRate, clientPayType)}
                      onClick={() => {
                        setExpandedLocation(location.id)
                        setScheduleFormMode('edit')
                        setEditingSchedule({ ...sch, locationId: location.id })
                      }}
                    />
                    <DetailRow
                      label="Cleaner Pay"
                      value={payLabel(sch.defaultSubcontractorRate, subPayType)}
                      onClick={() => {
                        setExpandedLocation(location.id)
                        setScheduleFormMode('edit')
                        setEditingSchedule({ ...sch, locationId: location.id })
                      }}
                    />
                    <DetailRow
                      label="Cleaner"
                      value={sch.subcontractor?.name || 'Unassigned'}
                      muted={!sch.subcontractor?.name}
                      onClick={() => setExpandedLocation(location.id)}
                    />
                    <DetailRow
                      label="Entry Codes"
                      value={location.accessInfo || 'Add entry info'}
                      muted={!location.accessInfo}
                      onClick={() => setExpandedLocation(location.id)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-gray-50/70">
                      <div className="flex flex-wrap items-center gap-2">
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
                      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                        <span className="font-medium text-slate-500">Client: {formatCurrency(rev)}/mo</span>
                        <span className="text-slate-300">/</span>
                        <span className="font-medium text-slate-500">Cleaner: {formatCurrency(cost)}/mo</span>
                        <span className="text-slate-300">/</span>
                        <span className={`font-semibold ${profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          Margin: {formatCurrency(profit)}/mo
                        </span>
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
                  <div className="flex gap-4 mb-3">
                    <button
                      onClick={() => setAddingScheduleToLocation(location.id)}
                      className="text-sm font-medium transition-colors"
                      style={{ color: '#00A896' }}
                    >
                      + Add Recurring Job
                    </button>
                    <button
                      onClick={() => handleDeleteLocation(location.id)}
                      className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
                    >
                      Delete Location
                    </button>
                  </div>
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
                    const timingBadge = getScheduleTimingBadge(sch)
                    return (
                      <div key={sch.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-700">{getScheduleFrequencyLabel(sch.frequency)}</span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${timingBadge.className}`}>
                            {timingBadge.label}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => { setScheduleFormMode('edit'); setEditingSchedule(sch) }} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit schedule"><Edit className="w-3.5 h-3.5 text-gray-400" /></button>
                          <button onClick={() => { setScheduleFormMode('future'); setEditingSchedule(sch) }} className="p-1.5 hover:bg-blue-50 rounded-lg" title="Change going forward"><CalendarPlus className="w-3.5 h-3.5 text-blue-500" /></button>
                          <button onClick={() => handleDeleteSchedule(sch.id)} className="p-1.5 hover:bg-gray-100 rounded-lg"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                        </div>
                      </div>
                    )
                  })}
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
