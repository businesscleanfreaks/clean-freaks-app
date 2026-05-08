"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScheduleForm } from "./schedule-form"
import { RecurringAddonForm } from "./recurring-addon-form"
import { AddOnCard } from "./add-on-card"
import { SimpleTooltip } from "@/components/ui/simple-tooltip"
import { formatCurrency, formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getPrimaryScheduleForDisplay, sortSchedulesForDisplay } from "@/lib/schedule-timing"
import {
  Plus, Edit, Trash2, MapPin, ChevronDown, Calendar,
  Sparkles, User, CalendarPlus, CheckCircle, TrendingUp,
  PauseCircle, PlayCircle, MoreVertical, Clock,
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

export function ClientDetailLocations({ state }: ClientDetailLocationsProps) {
  const [reassignEffectiveDate, setReassignEffectiveDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  )
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
    if (!scheduleMenuOpen && !reassigningSchedule) return
    const handler = (e: MouseEvent) => {
      // Don't close if clicking inside a dropdown
      const target = e.target as Node
      const dropdowns = document.querySelectorAll('[data-dropdown-menu]')
      for (const dd of dropdowns) {
        if (dd.contains(target)) return
      }
      if (scheduleMenuOpen) setScheduleMenuOpen(null)
      if (reassigningSchedule) setReassigningSchedule(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scheduleMenuOpen, reassigningSchedule, setScheduleMenuOpen, setReassigningSchedule])

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
          return (
            <div key={location.id} className="bg-white rounded-xl border border-gray-200 overflow-visible">
              {/* Location name + address */}
              <div className="px-4 py-3 flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm">{location.name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{location.address}</p>
                  {scheduleHistoryOverview && (
                    <p className="text-[11px] text-slate-500 mt-1">{scheduleHistoryOverview}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                  <button
                    onClick={() => {
                      setExpandedLocation(location.id)
                      setAddingScheduleToLocation(location.id)
                    }}
                    className="text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:bg-gray-50"
                    style={{ color: '#00A896' }}
                  >
                    + Add Recurring Job
                  </button>
                  <button
                    onClick={() => setExpandedLocation(isExpanded ? null : location.id)}
                    className="text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:bg-gray-50"
                    style={{ color: '#00A896' }}
                  >
                    {isExpanded ? 'Done' : 'Edit'}
                  </button>
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
                  <div key={sch.id} className={`px-4 py-2.5 border-t border-gray-100 ${sch.isActive === false ? 'opacity-60' : ''}`}>
                    <p className="text-sm text-gray-700 mb-1 flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{getScheduleFrequencyLabel(sch.frequency)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${timingBadge.className}`}>{timingBadge.label}</span>
                      {sch.isActive === false && <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Paused</span>}
                      {days.length > 0 && <span className="text-slate-500"> · {days.map((d: number) => DAY_NAMES[d]).join(', ')}</span>}
                      <span className="text-slate-500"> · {formatTime(sch.startTime || '09:00')}</span>
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
                            {subcontractors.map((sub: SubcontractorRecord) => (
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: '#00A896' }}>{formatCurrency(profit)}/mo</span>
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
