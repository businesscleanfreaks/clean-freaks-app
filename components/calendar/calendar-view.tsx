"use client"

import { Fragment, type CSSProperties, type ReactNode, useState, useMemo, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { 
  ChevronLeft, ChevronRight,
  AlertCircle, Plus, ChevronDown, X, Loader2,
  Search, MoreHorizontal, SlidersHorizontal, Check, Star
} from "lucide-react"
import { 
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, 
  subMonths, format, isSameMonth, isSameDay, addWeeks, subWeeks,
  isToday, isBefore, startOfToday
} from "date-fns"
import { formatTime } from "@/lib/utils"
import { JobDetailDialog } from "./job-detail-dialog"
import { CompactCreateJobDialog } from "./compact-create-job-dialog"
import { QuickAssignModal } from "./quick-assign-modal"
import { BulkJobActions } from "./bulk-job-actions"


import { JobWithFullRelations, ClientWithLocations, Subcontractor } from "@/types"
import { refreshCalendarData } from "./calendar-client"
import { DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { getCleanerColorInfo, JOB_GRADIENTS, JOB_SPINE_COLORS, CLEANER_HEX_COLORS } from '@/lib/calendar-design-tokens'
import { useCalendarFilters } from '@/lib/calendar-filter-context'
import { CalendarFilterDrawer } from './calendar-filter-drawer'
import { hasFinalInvoice } from '@/lib/invoice-status'

interface CalendarViewProps {
  jobs: JobWithFullRelations[]
  clients: ClientWithLocations[]
  subcontractors: Subcontractor[]
}

type ViewMode = 'day' | 'week' | 'month' | 'list'
type MobileViewMode = 'day' | '3day' | 'week' | 'month'
type WeekDensity = 'Comfortable' | 'Compact' | 'Dense'

const COLOR_KEY_TO_TAILWIND: Record<string, { bg: string; dot: string }> = {
  teal: { bg: 'bg-teal-100', dot: 'bg-teal-500' },
  purple: { bg: 'bg-purple-100', dot: 'bg-purple-500' },
  amber: { bg: 'bg-amber-100', dot: 'bg-amber-500' },
  orange: { bg: 'bg-orange-100', dot: 'bg-orange-500' },
  rose: { bg: 'bg-rose-100', dot: 'bg-rose-500' },
  red: { bg: 'bg-red-100', dot: 'bg-red-500' },
  blue: { bg: 'bg-blue-100', dot: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-100', dot: 'bg-emerald-500' },
  default: { bg: 'bg-gray-100', dot: 'bg-gray-500' },
}

function getWorkerColor(cleanerName: string | null) {
  if (!cleanerName) return { bg: 'bg-stone-100', dot: 'bg-stone-400' }
  const { colorKey } = getCleanerColorInfo(cleanerName)
  return COLOR_KEY_TO_TAILWIND[colorKey] || COLOR_KEY_TO_TAILWIND.default
}

function getPerformerName(job: { subcontractor?: { name?: string | null } | null; vendor?: { name?: string | null } | null }) {
  return job.subcontractor?.name || job.vendor?.name || null
}

// Design rule: the ★ marks ONE-OFF cleans only (no recurring schedule). Trials,
// first cleans, and add-ons are NOT starred — the reference calendar's special
// rail is "one-offs flagged ahead".
function isSpecialClean(job: JobWithFullRelations) {
  return !job.scheduleId
}

function getSpecialCleanLabel(job: JobWithFullRelations) {
  if (job.isTrial) return 'Trial'
  if (!job.scheduleId) return 'One-off'
  if (job.schedule?.startDate && isSameDay(new Date(job.date), new Date(job.schedule.startDate))) return 'First clean'
  return 'Add-on'
}

type TimelinePosition = {
  job: JobWithFullRelations
  start: number
  end: number
  column: number
  columnCount: number
  groupId: number
}

type TimelineOverflow = {
  groupId: number
  jobs: JobWithFullRelations[]
  start: number
  end: number
  column: number
  columnCount: number
}

function timeToMinutes(time: string | null | undefined) {
  if (!time) return 0
  const [hour, minute] = time.split(':').map(Number)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0
  return hour * 60 + minute
}

function minutesToShortTime(totalMinutes: number, includePeriod = true) {
  const hour24 = Math.floor(totalMinutes / 60) % 24
  const minute = totalMinutes % 60
  const period = hour24 >= 12 ? 'pm' : 'am'
  const hour = hour24 % 12 || 12
  return `${hour}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${includePeriod ? period : ''}`
}

function formatTimelineRange(start: number, end: number) {
  const samePeriod = (start >= 12 * 60) === (end >= 12 * 60)
  return `${minutesToShortTime(start, !samePeriod)} - ${minutesToShortTime(end)}`
}

export function buildTimelineLayout(jobs: JobWithFullRelations[], maxColumns = 3) {
  const timed = jobs
    .map(job => {
      const startValue = job.startTime || job.startWindowBegin
      if (!startValue) return null
      const start = timeToMinutes(startValue)
      const explicitEnd = job.startWindowBegin ? job.startWindowEnd : null
      let end = explicitEnd ? timeToMinutes(explicitEnd) : start + 60
      if (end <= start) end = start + 60
      return { job, start, end: Math.max(end, start + 15) }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const clusters: Array<typeof timed> = []
  let activeCluster: typeof timed | null = null
  let activeEnd = -1

  for (const item of timed) {
    if (!activeCluster || item.start >= activeEnd) {
      activeCluster = [item]
      clusters.push(activeCluster)
      activeEnd = item.end
    } else {
      activeCluster.push(item)
      activeEnd = Math.max(activeEnd, item.end)
    }
  }

  const positions: TimelinePosition[] = []
  const overflow: TimelineOverflow[] = []

  clusters.forEach((cluster, groupId) => {
    const laneEnds: number[] = []
    const assigned = cluster.map(item => {
      let column = laneEnds.findIndex(end => end <= item.start)
      if (column === -1) {
        column = laneEnds.length
        laneEnds.push(item.end)
      } else {
        laneEnds[column] = item.end
      }
      return { ...item, column }
    })
    const actualColumnCount = Math.max(laneEnds.length, 1)
    const visibleColumnCount = Math.min(actualColumnCount, maxColumns)
    const hidden = actualColumnCount > maxColumns
      ? assigned.filter(item => item.column >= maxColumns - 1)
      : []

    assigned.forEach(item => {
      if (hidden.includes(item)) return
      positions.push({
        ...item,
        columnCount: visibleColumnCount,
        groupId,
      })
    })

    if (hidden.length > 0) {
      overflow.push({
        groupId,
        jobs: hidden.map(item => item.job),
        start: Math.min(...hidden.map(item => item.start)),
        end: Math.max(...hidden.map(item => item.end)),
        column: maxColumns - 1,
        columnCount: maxColumns,
      })
    }
  })

  return { positions, overflow }
}

// SearchSelect: combobox-style dropdown for the inline header filters (Team / Clients).
// Per calendar_dev_notes.md item 2: replaces the side-panel filter drawer. Each dropdown has
// a search input + filtered list of options. Click outside to close.
type SearchSelectOption = { value: string; label: string; hex?: string; badge?: string }

function SearchSelect({
  defaultLabel,
  selectedValues,
  options,
  allSelected,
  onToggle,
  onSelectOnly,
  onSelectAll,
}: {
  defaultLabel: string
  selectedValues: Set<string>
  options: SearchSelectOption[]
  allSelected: boolean
  onToggle: (value: string) => void
  onSelectOnly: (value: string) => void
  onSelectAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)
  const selectedOptions = options.filter(option => selectedValues.has(option.value))
  const isActive = !allSelected
  const label = allSelected
    ? defaultLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${defaultLabel} (${selectedOptions.length})`
  const filtered = query.trim() ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())) : options

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
          isActive
            ? 'border-[var(--cf-green-rule)] bg-[var(--cf-green-soft)] text-[var(--cf-green)] hover:bg-[var(--cf-green-soft-hover)]'
            : 'border-[var(--cf-rule)] bg-white text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]'
        }`}
      >
        {selectedOptions.length === 1 && selectedOptions[0].hex && (
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: selectedOptions[0].hex, flexShrink: 0 }} />
        )}
        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: isActive ? '#0D9488' : '#94A3B8' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #E6E0D4',
            borderRadius: 8,
            boxShadow: '0 14px 36px rgba(40,30,10,0.14)',
            width: 240,
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 6px' }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7F8EA3' }}>{defaultLabel}</span>
            <button type="button" onClick={onSelectAll} style={{ border: 0, background: 'transparent', color: '#0B7A4E', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {allSelected ? 'Clear' : 'Select all'}
            </button>
          </div>
          <div style={{ padding: '0 8px 7px', borderBottom: '1px solid #F1F5F9' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search..."
              autoFocus
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #E6E0D4', fontSize: 11, outline: 'none', background: '#FAF8F3' }}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: 5 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>No results</div>
            ) : filtered.map(o => {
              const active = selectedValues.has(o.value)
              return (
                <div
                  key={o.value}
                  onClick={() => onToggle(o.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px',
                    fontSize: 12, fontWeight: active ? 600 : 400,
                    color: '#1A1A1A', background: 'transparent', borderRadius: 7,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${active ? '#0B7A4E' : '#CBD5E1'}`, background: active ? '#0B7A4E' : '#FFFFFF', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {active && <Check style={{ width: 10, height: 10, strokeWidth: 3 }} />}
                  </span>
                  {o.hex && (
                    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: o.hex, flexShrink: 0 }} />
                  )}
                  <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {o.badge && <span style={{ fontSize: 9, fontWeight: 800, color: '#64748B', background: '#EEF2F6', padding: '1px 5px', borderRadius: 4 }}>{o.badge}</span>}
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onSelectOnly(o.value); setOpen(false); setQuery('') }}
                    style={{ border: 0, background: 'transparent', color: '#AAB2BD', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Only
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// HeaderSearch: expandable search icon → input. Sits next to the filter dropdowns in the
// calendar header per Josh's feedback ("still missing the search function right next to the filters").
function HeaderSearch({ value, onChange, results, onPick }: {
  value: string
  onChange: (v: string) => void
  results: Array<{ id: string; primary: string; secondary: string; kind: string; hex: string }>
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
      <div className="relative flex min-w-[160px] max-w-[222px] flex-1 items-center" style={{ animation: 'fadeIn 100ms ease' }}>
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#7f8ea3]" />
        <input
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder="Search clients, jobs, notes..."
          className="w-full rounded-lg border border-[#d2d8e0] bg-[#f6f7f9] py-1.5 pl-8 pr-7 text-xs font-medium text-[#334155] outline-none focus:border-[var(--cf-green)]"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {open && value.trim() && results.length > 0 && (
          <div className="absolute left-0 top-full z-[70] mt-1.5 w-[308px] max-w-[80vw] rounded-lg border border-[#e6e9ee] bg-white p-1 shadow-[0_14px_36px_rgba(16,24,40,0.18)]">
            {results.map(result => (
              <button
                type="button"
                key={result.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onPick(result.id); setOpen(false) }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[#f5f8fa]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: result.hex }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-[#1e293b]">{result.primary}</span>
                  <span className="block truncate text-[10px] text-[#7f8ea3]">{result.secondary}</span>
                </span>
                <span className="text-[9px] font-bold uppercase tracking-[0.04em] text-[#b6bdc7]">{result.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>
  )
}

function DraggableTimelineJob({ job, disabled, title, className, style, onClick, onMouseEnter, onMouseLeave, children }: {
  job: JobWithFullRelations
  disabled: boolean
  title: string
  className: string
  style: CSSProperties
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { job, date: new Date(job.date) },
    disabled,
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={title}
      data-calendar-job-id={job.id}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={className}
      style={{ ...style, transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : style.opacity }}
    >
      {children}
    </div>
  )
}

function TimelineDayColumn({ date, children, onCreate }: { date: Date; children: ReactNode; onCreate: (event: React.MouseEvent<HTMLDivElement>) => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `timeline-${format(date, 'yyyy-MM-dd')}`,
    data: { date, type: 'day-cell' },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onCreate}
      className="relative overflow-visible border-r border-[#eef1f4] last:border-r-0"
      style={{ backgroundColor: isOver ? 'rgba(13,148,136,0.08)' : isToday(date) ? 'rgba(13,148,136,0.025)' : '#FFFFFF' }}
    >
      {children}
    </div>
  )
}

// NavArrow: prev/next button with a custom dark tooltip popup (not the browser title attribute).
// Per calendar_dev_notes.md, browser tooltips are slow + ugly; this matches the JSX reference's
// NavArrow component with a small triangle pointer.
function NavArrow({ direction, label, onClick }: { direction: 'prev' | 'next'; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label={label}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--cf-rule)] text-[var(--cf-ink-secondary)] transition-colors hover:border-[var(--cf-rule-strong)] hover:bg-[var(--cf-field)]"
      >
        <Icon className="w-4 h-4" />
      </button>
      {hover && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 8,
            padding: '4px 10px',
            borderRadius: 6,
            background: '#1A1A1A',
            color: '#FFFFFF',
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 60,
            pointerEvents: 'none',
          }}
        >
          {label}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -3,
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 7,
              height: 7,
              background: '#1E293B',
            }}
          />
        </span>
      )}
    </span>
  )
}

export function CalendarView({ jobs: initialJobs, clients, subcontractors }: CalendarViewProps) {
  const searchParams = useSearchParams()
  const [currentDate, setCurrentDate] = useState(new Date())
  const calendarWrapperRef = useRef<HTMLDivElement>(null)
  const [weekColumnWidth, setWeekColumnWidth] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [mobileView, setMobileView] = useState<MobileViewMode>('3day')
  const [weekDensity, setWeekDensity] = useState<WeekDensity>('Compact')
  const [expandedOverlapJobId, setExpandedOverlapJobId] = useState<string | null>(null)
  const [hoveredOverlapJobId, setHoveredOverlapJobId] = useState<string | null>(null)
  const [specialRailOpen, setSpecialRailOpen] = useState(true)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobWithFullRelations | null>(null)
  const [jobDialogOpen, setJobDialogOpen] = useState(false)
  const [createJobDialogOpen, setCreateJobDialogOpen] = useState(false)
  const [selectedDateForNewJob, setSelectedDateForNewJob] = useState<Date | null>(null)
  const [quickAssignOpen, setQuickAssignOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [draggedJob, setDraggedJob] = useState<JobWithFullRelations | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedTimeForNewJob, setSelectedTimeForNewJob] = useState<string | undefined>(undefined)
  const [dragTarget, setDragTarget] = useState<{ date: Date | null; time: string | null }>({ date: null, time: null })
  const [originalJobPosition, setOriginalJobPosition] = useState<{ date: Date; time: string | null } | null>(null)
  const [originalJobPositions, setOriginalJobPositions] = useState<Map<string, { date: Date; time: string | null }>>(new Map())
  const [clientSearchQuery, setClientSearchQuery] = useState('')
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const overflowMenuRef = useRef<HTMLDivElement>(null)

  // Day popover state for "+N more" click in month view
  const [dayPopoverDate, setDayPopoverDate] = useState<Date | null>(null)
  const [dayPopoverJobs, setDayPopoverJobs] = useState<JobWithFullRelations[]>([])
  const dayPopoverRef = useRef<HTMLDivElement>(null)

  // Undo stack for calendar job moves (Cmd+Z / Ctrl+Z)
  const [undoStack, setUndoStack] = useState<Array<{
    jobId: string
    jobLabel: string
    fromDate: string
    fromTime: string | null
    toDate: string
    toTime: string | null
  }>>([])
  const undoInProgressRef = useRef(false)
  
  // Lazy loading state for calendar navigation
  const [allJobs, setAllJobs] = useState<JobWithFullRelations[]>(initialJobs)
  const vendorOptions = useMemo(() => {
    const vendors = new Map<string, string>()
    for (const job of allJobs) {
      const vendor = (job as JobWithFullRelations & { vendor?: { id: string; name: string } | null }).vendor
      if (vendor) vendors.set(vendor.id, vendor.name)
    }
    return Array.from(vendors, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [allJobs])
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    for (const job of initialJobs) {
      const vendor = (job as JobWithFullRelations & { vendor?: { id: string } | null }).vendor
      if (vendor) ids.add(vendor.id)
    }
    return ids
  })
  const [loadedRanges, setLoadedRanges] = useState<Set<string>>(() => {
    const ranges = new Set<string>()
    const now = new Date()
    ranges.add(`${now.getFullYear()}-${now.getMonth()}`)
    return ranges
  })
  const prefetchingRangesRef = useRef<Set<string>>(new Set())
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  
  // Use allJobs instead of initialJobs throughout the component
  const jobs = allJobs

  useEffect(() => {
    setSelectedVendorIds(current => {
      const next = new Set(current)
      let changed = false
      for (const vendor of vendorOptions) {
        if (!next.has(vendor.id)) {
          next.add(vendor.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [vendorOptions])
  
  const calFilters = useCalendarFilters()
  const noop = useMemo(() => (() => {}) as (...args: unknown[]) => void, [])
  const defaultCleanerIds = useMemo(() => new Set(subcontractors.map(s => s.id)), [subcontractors])
  const emptyClientIds = useMemo(() => new Set<string>(), [])
  const selectedCleanerIds = calFilters?.selectedCleanerIds ?? defaultCleanerIds
  const setSelectedCleanerIds = calFilters?.setSelectedCleanerIds ?? noop
  const filterBarClientIds = calFilters?.filterBarClientIds ?? emptyClientIds
  const setFilterBarClientIds = calFilters?.setFilterBarClientIds ?? noop
  const toggleFilterBarClient = calFilters?.toggleFilterBarClient ?? noop
  const showUnassigned = calFilters?.showUnassigned ?? true
  const setShowUnassigned = calFilters?.setShowUnassigned ?? noop

  useEffect(() => {
    calFilters?.initCleaners(subcontractors.map(s => s.id))
  }, [subcontractors, calFilters])
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    if (showOverflowMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showOverflowMenu])

  useEffect(() => {
    if (!expandedOverlapJobId) return
    const collapse = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest(`[data-calendar-job-id="${expandedOverlapJobId}"]`)) {
        setExpandedOverlapJobId(null)
      }
    }
    document.addEventListener('mousedown', collapse)
    return () => document.removeEventListener('mousedown', collapse)
  }, [expandedOverlapJobId])

  useEffect(() => {
    setExpandedOverlapJobId(null)
    setHoveredOverlapJobId(null)
  }, [currentDate, viewMode])

  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    const dt = Date.now() - touchStartRef.current.t
    touchStartRef.current = null

    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) || dt > 400) return

    const direction = dx > 0 ? -1 : 1
    if (mobileView === 'day') {
      setCurrentDate(d => addDays(d, direction))
    } else if (mobileView === '3day') {
      setCurrentDate(d => addDays(d, direction * 3))
    } else if (mobileView === 'week') {
      setCurrentDate(d => addDays(d, direction * 7))
    } else if (mobileView === 'month') {
      setCurrentDate(d => direction > 0 ? addMonths(d, 1) : subMonths(d, 1))
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 25 }
    })
  )

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobIds(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) {
        next.delete(jobId)
      } else {
        next.add(jobId)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedJobIds(new Set())
    setIsSelectionMode(false)
  }

  const handleJobsUpdated = () => {
    refreshCalendarData()
  }

  useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem('cleanfreaks-mobile-view') as MobileViewMode
      if (saved && ['day', '3day', 'week', 'month'].includes(saved)) {
        setMobileView(saved)
      }
      const savedDensity = localStorage.getItem('cleanfreaks-week-density') as WeekDensity
      if (savedDensity && ['Comfortable', 'Compact', 'Dense'].includes(savedDensity)) {
        setWeekDensity(savedDensity)
      }
    } catch {}
  }, [])

  useEffect(() => {
    const el = calendarWrapperRef.current
    if (!el) return

    const updateWeekColumnWidth = () => {
      const width = el.getBoundingClientRect().width
      setWeekColumnWidth(Math.max(0, (width - 56) / 7))
    }

    updateWeekColumnWidth()
    const resizeObserver = new ResizeObserver(updateWeekColumnWidth)
    resizeObserver.observe(el)
    window.addEventListener('resize', updateWeekColumnWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateWeekColumnWidth)
    }
  }, [])

  const changeMobileView = (view: MobileViewMode) => {
    setMobileView(view)
    try { localStorage.setItem('cleanfreaks-mobile-view', view) } catch {}
  }

  const changeWeekDensity = (density: WeekDensity) => {
    setWeekDensity(density)
    try { localStorage.setItem('cleanfreaks-week-density', density) } catch {}
  }

  // Lazy load jobs when navigating to a month that hasn't been loaded
  useEffect(() => {
    const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`
    
    // If this month is already loaded, skip
    if (loadedRanges.has(monthKey)) return
    
    // Fetch only the visible calendar month (plus leading/trailing week days).
    // Loading three months at a time made historical navigation feel frozen
    // because each jump also generated jobs for adjacent months.
    const fetchMoreJobs = async () => {
      setIsLoadingMore(true)
      try {
        const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
        start.setDate(start.getDate() - start.getDay())
        start.setHours(0, 0, 0, 0)
        const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59)
        end.setDate(end.getDate() + (6 - end.getDay()))
        
        const response = await fetch(
          `/api/jobs/by-date-range?start=${start.toISOString()}&end=${end.toISOString()}`
        )
        
        if (response.ok) {
          const data = await response.json()
          const newJobs = data.jobs as JobWithFullRelations[]
          
          // Merge new jobs with existing (avoid duplicates by id)
          setAllJobs(prev => {
            const existingIds = new Set(prev.map(j => j.id))
            const uniqueNewJobs = newJobs.filter(j => !existingIds.has(j.id))
            return [...prev, ...uniqueNewJobs]
          })
          
          // Mark this month as loaded
          setLoadedRanges(prev => {
            const next = new Set(prev)
            next.add(monthKey)
            return next
          })

        }
      } catch (error) {
        console.error('Failed to load more jobs:', error)
      } finally {
        setIsLoadingMore(false)
      }
    }
    
    fetchMoreJobs()
  }, [currentDate, loadedRanges])

  useEffect(() => {
    const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`
    if (!loadedRanges.has(monthKey)) return

    const prefetchMonth = (offset: number) => {
      const target = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1)
      const targetKey = `${target.getFullYear()}-${target.getMonth()}`
      if (loadedRanges.has(targetKey)) return
      if (prefetchingRangesRef.current.has(targetKey)) return
      prefetchingRangesRef.current.add(targetKey)

      const start = new Date(target.getFullYear(), target.getMonth(), 1)
      start.setDate(start.getDate() - start.getDay())
      start.setHours(0, 0, 0, 0)
      const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59)
      end.setDate(end.getDate() + (6 - end.getDay()))

      fetch(`/api/jobs/by-date-range?start=${start.toISOString()}&end=${end.toISOString()}`)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (!data?.jobs) return
          setAllJobs(prev => {
            const existingIds = new Set(prev.map(j => j.id))
            const uniqueNewJobs = (data.jobs as JobWithFullRelations[]).filter(j => !existingIds.has(j.id))
            return uniqueNewJobs.length > 0 ? [...prev, ...uniqueNewJobs] : prev
          })
          setLoadedRanges(prev => {
            const next = new Set(prev)
            next.add(targetKey)
            return next
          })
        })
        .catch(() => {})
        .finally(() => {
          prefetchingRangesRef.current.delete(targetKey)
        })
    }

    const timers = [
      window.setTimeout(() => prefetchMonth(-1), 0),
      window.setTimeout(() => prefetchMonth(1), 150),
      window.setTimeout(() => prefetchMonth(-2), 500),
      window.setTimeout(() => prefetchMonth(2), 750),
      window.setTimeout(() => prefetchMonth(-3), 1100),
      window.setTimeout(() => prefetchMonth(3), 1400),
    ]

    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [currentDate, loadedRanges])

  // Initialize filter selections when data loads
  useEffect(() => {
    setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
  }, [subcontractors, setSelectedCleanerIds])

  // Sync allJobs with initialJobs when they change (e.g., after SWR revalidation)
  useEffect(() => {
    // Calculate which months the initial data covers (the API's default window)
    const initialMonths = new Set<string>()
    const now = new Date()
    initialMonths.add(`${now.getFullYear()}-${now.getMonth()}`)

    setAllJobs(prev => {
      // Keep only lazily-loaded jobs that are OUTSIDE the initial API window.
      // For months covered by initialJobs, use the fresh data exclusively —
      // this ensures deleted jobs are properly removed.
      const initialJobIds = new Set(initialJobs.map(j => j.id))
      const keptJobs = prev.filter(j => {
        // If this job exists in the fresh data, it'll be included from initialJobs
        if (initialJobIds.has(j.id)) return false
        // If this job is in a month covered by the initial window, it was
        // deleted from the DB — drop it
        const jobDate = new Date(j.date)
        const jobMonthKey = `${jobDate.getFullYear()}-${jobDate.getMonth()}`
        if (initialMonths.has(jobMonthKey)) return false
        // Job is from a lazily-loaded month outside the API window — keep it
        return true
      })
      // Deduplicate by job ID to prevent duplicates from race conditions
      const merged = [...initialJobs, ...keptJobs]
      const seen = new Set<string>()
      return merged.filter(job => {
        if (seen.has(job.id)) return false
        seen.add(job.id)
        return true
      })
    })

    // Reset loadedRanges to only the initial months — this forces
    // lazily-loaded months to re-fetch on next navigation, clearing any
    // stale deleted jobs from those months too
    setLoadedRanges(initialMonths)
  }, [initialJobs])

  // Handle jobId from URL query parameter
  useEffect(() => {
    const jobId = searchParams?.get('jobId')
    if (jobId && jobs.length > 0) {
      const job = jobs.find(j => j.id === jobId)
      if (job) {
        setSelectedJob(job)
        setJobDialogOpen(true)
        // Navigate to the job's date
        setCurrentDate(new Date(job.date))
      }
    }
  }, [searchParams, jobs])

  const handleJobClick = (job: JobWithFullRelations) => {
    setSelectedJob(job)
    setJobDialogOpen(true)
  }

  const handleDateClick = (date: Date) => {
    setSelectedDateForNewJob(date)
    setCreateJobDialogOpen(true)
  }

  const handleTimeSlotClick = (date: Date, time: string) => {
    setSelectedDateForNewJob(date)
    setSelectedTimeForNewJob(time)
    setCreateJobDialogOpen(true)
  }

  const performUndo = async () => {
    if (undoInProgressRef.current || undoStack.length === 0) return
    undoInProgressRef.current = true

    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))

    // Optimistic update: move job back instantly
    const previousJobs = [...allJobs]
    const originalDate = new Date(entry.fromDate)
    setAllJobs(prev => prev.map(j => {
      if (j.id !== entry.jobId) return j
      return { ...j, date: originalDate, startTime: entry.fromTime ?? j.startTime }
    }))

    try {
      const updateData: Record<string, string> = { date: entry.fromDate.split('T')[0] }
      if (entry.fromTime) updateData.startTime = entry.fromTime

      const response = await fetch(`/api/jobs/${entry.jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) throw new Error('Failed to undo')

      const { showSuccess } = await import('@/lib/toast')
      showSuccess(`Undone: ${entry.jobLabel} moved back`)
      refreshCalendarData()
    } catch {
      setAllJobs(previousJobs)
      const { showError } = await import('@/lib/toast')
      showError('Failed to undo the move')
    } finally {
      undoInProgressRef.current = false
    }
  }

  const handleJobDragEnd = async (jobId: string, newDate: Date, newTime?: string) => {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return

    if (hasFinalInvoice(job.invoiceLineItems)) {
      const { showError } = await import('@/lib/toast')
      showError('This job is on a sent or paid invoice and cannot be moved')
      return
    }

    if (job.subcontractorPaid) {
      const { showError } = await import('@/lib/toast')
      showError('Cleaner has already been paid, so this job is locked')
      return
    }

    if (job.status === 'CANCELLED') {
      const { showError } = await import('@/lib/toast')
      showError('Cancelled jobs cannot be moved')
      return
    }

    // Save original position for undo
    const originalDate = typeof job.date === 'string' ? job.date : (job.date as Date).toISOString()
    const originalTime = job.startTime || null
    const originalDateKey = format(new Date(originalDate), 'yyyy-MM-dd')
    const newDateKey = format(newDate, 'yyyy-MM-dd')
    const nextTime = newTime !== undefined ? newTime : originalTime
    const jobLabel = job.location?.client?.name || 'Job'

    if (originalDateKey === newDateKey && nextTime === originalTime) {
      return
    }

    // Optimistic update: move job instantly in local state
    const previousJobs = [...allJobs]
    setAllJobs(prev => prev.map(j => {
      if (j.id !== jobId) return j
      return {
        ...j,
        date: newDate,
        startTime: nextTime,
      }
    }))

    try {
      const updateData: { date: string; startTime?: string } = {
        date: newDateKey,
      }
      if (nextTime) {
        updateData.startTime = nextTime
      }

      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update job')
      }

      // Push to undo stack (max 10 entries)
      setUndoStack(prev => [
        ...prev.slice(-9),
        {
          jobId,
          jobLabel,
          fromDate: originalDate,
          fromTime: originalTime,
          toDate: newDate.toISOString(),
          toTime: nextTime || null,
        },
      ])

      // Show undo toast
      const { showUndoToast } = await import('@/lib/toast')
      const newDateLabel = format(newDate, 'MMM d')
      const timeChanged = (nextTime || null) !== (originalTime || null)
      const timeLabel = nextTime ? ` at ${formatTime(nextTime)}` : ''
      const moveLabel = timeChanged
        ? `Moved ${jobLabel} to ${newDateLabel}${timeLabel}`
        : `Moved ${jobLabel} to ${newDateLabel}`

      showUndoToast(moveLabel, () => {
        performUndo()
      })

      refreshCalendarData()
    } catch (error) {
      // Revert optimistic update on failure
      setAllJobs(previousJobs)
      const { showError } = await import('@/lib/toast')
      showError(error instanceof Error ? error.message : 'Failed to reschedule job')
    }
  }

  const handleTimelineDragEnd = (jobId: string, newDate: Date, newTime?: string) => {
    handleJobDragEnd(jobId, newDate, newTime).catch(console.error)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const job = jobs.find(j => j.id === active.id)
    if (job) {
      setDraggedJob(job)
      setIsDragging(true)
      // Store original position for comparison
      const originalDate = new Date(job.date)
      const originalTime = job.startTime || null
      setOriginalJobPosition({
        date: originalDate,
        time: originalTime,
      })
      // Track original positions in a Map for passing to TimelineView
      const originalPositions = new Map<string, { date: Date; time: string | null }>()
      originalPositions.set(job.id, { date: originalDate, time: originalTime })
      setOriginalJobPositions(originalPositions)
      // Initialize drag target with current job position
      setDragTarget({
        date: originalDate,
        time: originalTime,
      })
    }
  }

  // Throttle drag over updates to reduce re-renders
  const dragOverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const handleDragOver = (event: DragOverEvent) => {
    // Update dragTarget immediately (no throttle) to ensure opacity updates instantly
    // The throttle was causing delays in detecting when we're over the original position
    const { over } = event
    if (!over) {
      setDragTarget({ date: null, time: null })
      return
    }

    const dropData = over.data.current
    if (dropData?.date) {
      const targetDate = dropData.date instanceof Date ? dropData.date : new Date(dropData.date)
      const targetTime = dropData.type === 'timeline-slot' ? dropData.time : (draggedJob?.startTime || null)
      
      // Only update if target actually changed to prevent unnecessary re-renders
      setDragTarget(prev => {
        const prevDateStr = prev.date ? format(prev.date, 'yyyy-MM-dd') : null
        const newDateStr = format(targetDate, 'yyyy-MM-dd')
        if (prevDateStr === newDateStr && prev.time === targetTime) {
          return prev // No change, return previous to prevent re-render
        }
        return { date: targetDate, time: targetTime }
      })
    }
  }

  useEffect(() => {
    if (!isDragging && dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current)
      dragOverTimeoutRef.current = null
    }
  }, [isDragging])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const originalPosition = originalJobPosition
    
    // Immediately reset drag state to restore normal appearance
    setIsDragging(false)
    setDraggedJob(null)
    setDragTarget({ date: null, time: null })
    
    // Clear original positions map
    setOriginalJobPositions(new Map())
    
    // Small delay before clearing original position to ensure comparison works
    const positionToCompare = originalPosition
    setTimeout(() => {
      setOriginalJobPosition(null)
    }, 0)

    if (!over || !positionToCompare) {
      // No drop target or no original position - just reset state
      return
    }

    const job = jobs.find(j => j.id === active.id)
    if (!job) return

    // Extract date and time from drop target
    const dropData = over.data.current
    if (dropData?.date) {
      const newDate = dropData.date instanceof Date ? dropData.date : new Date(dropData.date)
      // For timeline slots, use the time from the slot
      // For day cells, keep existing time
      const newTime = dropData.type === 'timeline-slot' ? dropData.time : (job.startTime || undefined)
      
      // Normalize dates for comparison (compare only date, not time)
      const originalDateStr = format(positionToCompare.date, 'yyyy-MM-dd')
      const newDateStr = format(newDate, 'yyyy-MM-dd')
      
      // Check if position actually changed
      const dateChanged = originalDateStr !== newDateStr
      const timeChanged = positionToCompare.time !== newTime
      
      // Only reschedule if position actually changed
      if (dateChanged || timeChanged) {
        await handleJobDragEnd(job.id, newDate, newTime)
      }
      // If position didn't change, do nothing (job stays in place and should look normal)
    }
  }

  const matchingClientIds = useMemo(() => {
    if (!clientSearchQuery.trim()) return null
    const q = clientSearchQuery.toLowerCase().trim()
    const ids = new Set<string>()
    for (const c of clients) {
      if (c.name.toLowerCase().includes(q)) ids.add(c.id)
    }
    return ids
  }, [clientSearchQuery, clients])

  const [headerSearch, setHeaderSearch] = useState('')
  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (selectedClientId && job.location.client.id !== selectedClientId) return false
      if (selectedSubcontractorId && job.subcontractor?.id !== selectedSubcontractorId) return false

      if (job.subcontractor) {
        if (!selectedCleanerIds.has(job.subcontractor.id)) return false
      } else if ((job as JobWithFullRelations & { vendor?: { id: string } | null }).vendor) {
        const vendor = (job as JobWithFullRelations & { vendor?: { id: string } | null }).vendor
        if (!vendor || !selectedVendorIds.has(vendor.id)) return false
      } else {
        if (!showUnassigned) return false
      }

      if (filterBarClientIds.size > 0 && !filterBarClientIds.has(job.location.client.id)) return false

      return true
    })
  }, [jobs, selectedClientId, selectedSubcontractorId, selectedCleanerIds, selectedVendorIds, filterBarClientIds, showUnassigned])

  const dimmedClientIds = matchingClientIds

  // Helper to get date string in YYYY-MM-DD format for timezone-safe comparison
  // This prevents midnight UTC dates from appearing on the wrong day in local timezone
  const getDateString = (date: Date | string): string => {
    if (typeof date === 'string') {
      // If it's an ISO string, extract the date part directly (YYYY-MM-DD)
      return date.slice(0, 10)
    }
    if (date instanceof Date) {
      // For Date objects, extract UTC date components to get the stored date
      // This handles both noon UTC (new) and midnight UTC (legacy) dates correctly
      return date.toISOString().slice(0, 10)
    }
    // Fallback: try to convert and format
    return format(new Date(date), 'yyyy-MM-dd')
  }

  // Stats calculations
  const stats = useMemo(() => {
    const today = startOfToday()
    const todayStr = format(today, 'yyyy-MM-dd')
    
    const todayJobs = filteredJobs.filter(j => getDateString(j.date) === todayStr)
    const unassigned = filteredJobs.filter(j => !getPerformerName(j) && getDateString(j.date) >= todayStr)
    
    return {
      todayJobs: todayJobs.sort((a, b) => {
        const timeA = a.startTime || a.startWindowBegin || '00:00'
        const timeB = b.startTime || b.startWindowBegin || '00:00'
        return timeA.localeCompare(timeB)
      }),
      unassignedJobs: unassigned,
    }
  }, [filteredJobs])

  // Navigation
  const navigate = (direction: 'prev' | 'next') => {
    if (viewMode === 'month') {
      setCurrentDate(d => direction === 'next' ? addMonths(d, 1) : subMonths(d, 1))
    } else if (viewMode === 'day') {
      setCurrentDate(d => addDays(d, direction === 'next' ? 1 : -1))
    } else {
      setCurrentDate(d => direction === 'next' ? addWeeks(d, 1) : subWeeks(d, 1))
    }
  }

  const goToToday = () => setCurrentDate(new Date())

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+Z / Ctrl+Z — undo last calendar move
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (undoStack.length > 0) {
          e.preventDefault()
          performUndo()
        }
        return
      }

      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return

      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault()
          goToToday()
          break
        case 'ArrowLeft':
          e.preventDefault()
          navigate('prev')
          break
        case 'ArrowRight':
          e.preventDefault()
          navigate('next')
          break
        case 'n':
        case 'N':
          e.preventDefault()
          handleDateClick(new Date())
          break
        case 'Escape':
          setSelectedJob(null)
          setSelectedDateForNewJob(null)
          setShowMonthPicker(false)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack])

  const getJobsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return filteredJobs.filter(job => {
      // Extract the UTC date from the job (stored at noon UTC)
      const jobDateStr = getDateString(job.date)
      return jobDateStr === dateStr
    })
  }

  const getJobStatus = (job: JobWithFullRelations) => {
    if (job.status === 'CANCELLED') return 'cancelled'
    if (job.status === 'COMPLETED') return 'completed'
    const jobDate = new Date(job.date)
    if (isBefore(jobDate, startOfToday())) return 'completed'
    return 'scheduled'
  }

  const clearFilters = () => {
    setSelectedClientId(null)
    setSelectedSubcontractorId(null)
    setClientSearchQuery('')
  }

  const hasActiveFilters = selectedClientId || selectedSubcontractorId

  // Problems banner removed — unassigned count is now inline in the header filter row

  // State for month picker
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [monthPickerYear, setMonthPickerYear] = useState(currentDate.getFullYear())

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  const selectMonth = (monthIndex: number) => {
    setCurrentDate(new Date(monthPickerYear, monthIndex, 1))
    setShowMonthPicker(false)
  }

  // Get week days for Google Calendar-style week strip
  const getWeekDays = () => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }

  // Mobile Header - Google Calendar style (light, clean)
  const renderMobileHeader = () => {
    const isAllActive = selectedCleanerIds.size === subcontractors.length && showUnassigned

    return (
    <div className="relative bg-white lg:hidden">
      <div className="border-b border-[var(--cf-rule)] px-3 py-2">
        <div
          className="px-1"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <button
                onClick={() => {
                  setMonthPickerYear(currentDate.getFullYear())
                  setShowMonthPicker(!showMonthPicker)
                }}
                className="flex items-center gap-1"
              >
                <span style={{ fontSize: '19px', fontWeight: 800, color: '#111827', lineHeight: 1.1 }}>
                  {monthLabel}
                </span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${showMonthPicker ? 'rotate-180' : ''}`}
                  style={{ color: '#5F6368' }}
                />
              </button>
            </div>

            <button
              onClick={goToToday}
              className="flex-shrink-0 rounded-full px-3 py-1.5"
              style={{
                border: '1px solid #D8DDD8',
                backgroundColor: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                color: '#0F766E',
              }}
            >
              Today
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-[#f1f5f9] p-0.5">
            {(['3day', 'week'] as MobileViewMode[]).map((view) => (
              <button
                key={view}
                onClick={() => changeMobileView(view)}
                style={{
                  minHeight: '32px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                  backgroundColor: mobileView === view ? '#0F766E' : 'transparent',
                  color: mobileView === view ? 'white' : '#4B5563',
                  border: 'none',
                }}
              >
                {view === '3day' ? '3 Day View' : 'Week View'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--cf-rule)] px-3 py-1.5">
        <div
          className="overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            backgroundColor: '#FFFFFF',
          }}
        >
        <div
          className="flex items-center"
          style={{ paddingLeft: '2px', paddingRight: '4px', gap: '6px', width: 'max-content' }}
        >
          {/* All pill */}
          <button
            onClick={() => {
              setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
              setShowUnassigned(true)
            }}
            style={{
              height: '28px',
              padding: '0 10px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: isAllActive ? '#0F766E' : '#FFFFFF',
              color: isAllActive ? 'white' : '#5F6368',
              border: isAllActive ? '1px solid #0F766E' : '1px solid #E0E0E0',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            All
          </button>

          {/* Individual cleaner pills */}
          {subcontractors.map(sub => {
            const { hex } = getCleanerColorInfo(sub.name)
            const isActive = selectedCleanerIds.has(sub.id)
            return (
              <button
                key={sub.id}
                onClick={() => {
                  const next = new Set(selectedCleanerIds)
                  if (next.has(sub.id)) next.delete(sub.id)
                  else next.add(sub.id)
                  setSelectedCleanerIds(next)
                }}
                style={{
                  height: '28px',
                  padding: '0 10px',
                  borderRadius: '14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: isActive ? hex : 'white',
                  color: isActive ? 'white' : '#5F6368',
                  border: isActive ? `1px solid ${hex}` : '1px solid #E0E0E0',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {sub.name}
              </button>
            )
          })}

          {/* Unassigned pill */}
          <button
            onClick={() => setShowUnassigned(!showUnassigned)}
            style={{
              height: '28px',
              padding: '0 10px',
              borderRadius: '14px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: showUnassigned ? '#6b7280' : 'white',
              color: showUnassigned ? 'white' : '#5F6368',
              border: showUnassigned ? '1px solid #6b7280' : '1px solid #E0E0E0',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Unassigned
          </button>
        </div>
      </div>
      </div>

      {/* Week strip - shown for day/3day/week views */}
      {mobileView !== 'month' && (
        <div className="flex bg-white" style={{ borderBottom: '1px solid #EEEEEE' }}>
          {getWeekDays().map((day, idx) => {
            const isTodayDate = isToday(day)
            const isSelected = isSameDay(day, currentDate)
            const dayJobs = getJobsForDate(day)

            return (
              <button
                key={idx}
                onClick={() => setCurrentDate(day)}
                className="flex flex-1 flex-col items-center py-1.5"
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: isTodayDate ? '#00A896' : '#5F6368',
                    marginBottom: '4px',
                  }}
                >
                  {format(day, 'EEEEE')}
                </span>
                {/* 32px diameter circle */}
                <span
                  className={`rounded-full flex items-center justify-center transition-all font-bold ${
                    isSelected && isTodayDate ? 'bg-teal-600 text-white' :
                    isSelected ? 'bg-gray-900 text-white' :
                    isTodayDate ? 'bg-teal-600 text-white' :
                    'text-gray-900'
                  }`}
                  style={{ width: '28px', height: '28px', fontSize: '14px', fontWeight: 700 }}
                >
                  {format(day, 'd')}
                </span>
                {/* Job dots: max 3 + "+N" overflow, reflect filter state */}
                {dayJobs.length > 0 && !isSelected && (
                  <div className="flex items-center mt-1" style={{ gap: '2px' }}>
                    {dayJobs.slice(0, 3).map((job, i) => {
                      const { hex } = getCleanerColorInfo(getPerformerName(job))
                      return (
                        <div
                          key={i}
                          className="rounded-full flex-shrink-0"
                          style={{ width: '5px', height: '5px', backgroundColor: hex }}
                        />
                      )
                    })}
                    {dayJobs.length > 3 && (
                      <span style={{ fontSize: '9px', color: '#888888', lineHeight: '1', marginLeft: '1px' }}>
                        +{dayJobs.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Mobile Month Picker popup */}
      {showMonthPicker && (
        <div className="absolute left-4 right-4 bg-white rounded-[18px] shadow-xl p-4 z-50" style={{ top: '126px', border: '1px solid #e8eaed' }}>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setMonthPickerYear(y => y - 1)}
              className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-bold text-gray-900">{monthPickerYear}</span>
            <button
              onClick={() => setMonthPickerYear(y => y + 1)}
              className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MONTHS.map((month, idx) => (
              <button
                key={month}
                onClick={() => selectMonth(idx)}
                className={`py-2 rounded-lg text-sm font-medium ${
                  currentDate.getMonth() === idx && currentDate.getFullYear() === monthPickerYear
                    ? 'bg-teal-500 text-white'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {month}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )}

  // Mobile Month View - compact grid with job dots
  const renderMobileMonthView = () => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(monthStart)
    const calStart = startOfWeek(monthStart)
    const calEnd = endOfWeek(monthEnd)

    const weeks: Date[][] = []
    let d = calStart
    while (d <= calEnd) {
      const week: Date[] = []
      for (let i = 0; i < 7; i++) {
        week.push(d)
        d = addDays(d, 1)
      }
      weeks.push(week)
    }

    return (
      <div className="px-2">
        <div className="grid grid-cols-7 text-center mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((day) => {
              const dayJobs = getJobsForDate(day)
              const isCurrent = isSameMonth(day, monthStart)
              const isTodayDate = isToday(day)
              const isSelected = isSameDay(day, currentDate)

              return (
                <button
                  key={day.toString()}
                  onClick={() => {
                    setCurrentDate(day)
                    changeMobileView('day')
                  }}
                  className={`py-2 flex flex-col items-center ${!isCurrent ? 'opacity-30' : ''}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    isSelected && isTodayDate ? 'bg-teal-500 text-white' :
                    isSelected ? 'bg-gray-900 text-white' :
                    isTodayDate ? 'bg-teal-600 text-white font-bold' :
                    'text-gray-700'
                  }`}>
                    {format(day, 'd')}
                  </span>
                  {dayJobs.length > 0 && (
                    <div className="flex items-center mt-0.5" style={{ gap: '2px' }}>
                      {dayJobs.slice(0, 3).map((job, i) => {
                        const { hex } = getCleanerColorInfo(getPerformerName(job))
                        return (
                          <div
                            key={i}
                            className="rounded-full flex-shrink-0"
                            style={{ width: '5px', height: '5px', backgroundColor: hex }}
                          />
                        )
                      })}
                      {dayJobs.length > 3 && (
                        <span style={{ fontSize: '9px', color: '#888888', lineHeight: '1' }}>
                          +{dayJobs.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // Mobile content area - renders based on mobileView
  const renderMobileContent = () => {
    if (mobileView === 'month') {
      return (
        <div className="lg:hidden flex-1 min-h-0 overflow-y-auto" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {renderMobileMonthView()}
        </div>
      )
    }

    const rangeStart = mobileView === 'week' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : currentDate
    const dayCount = mobileView === 'day' ? 1 : mobileView === 'week' ? 7 : 3
    const visibleDays = Array.from({ length: dayCount }, (_, index) => addDays(rangeStart, index))

    return (
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--cf-canvas)] px-3 pb-28 pt-2 lg:hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {visibleDays.map(day => {
          const dayJobs = getJobsForDate(day).sort((a, b) => (a.startTime || a.startWindowBegin || '99:99').localeCompare(b.startTime || b.startWindowBegin || '99:99'))
          return (
            <section key={day.toISOString()} className="mb-3 overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-white">
              <div className="flex items-center justify-between border-b border-[var(--cf-grid-rule)] px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-extrabold ${isToday(day) ? 'text-[var(--cf-green)]' : 'text-[var(--cf-ink)]'}`}>{format(day, 'EEEE')}</span>
                  <span className="text-xs font-semibold text-[var(--cf-ink-muted)]">{format(day, 'MMM d')}</span>
                </div>
                <button type="button" onClick={() => handleDateClick(day)} aria-label={`Add job on ${format(day, 'MMMM d')}`} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--cf-green)] hover:bg-[var(--cf-green-soft)]">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {dayJobs.length > 0 ? (
                <div className="divide-y divide-[var(--cf-grid-rule)]">
                  {dayJobs.map(job => {
                    const performerName = getPerformerName(job)
                    const { hex } = getCleanerColorInfo(performerName)
                    const status = getJobStatus(job)
                    const time = job.startTime || job.startWindowBegin
                    return (
                      <button
                        type="button"
                        key={job.id}
                        onClick={() => handleJobClick(job)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[var(--cf-field)]"
                      >
                        <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: status === 'cancelled' ? '#9CA3AF' : hex }} />
                        <span className="w-[58px] shrink-0 text-xs font-extrabold text-[var(--cf-ink-secondary)]">{time ? formatTime(time) : 'TBD'}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-bold text-[var(--cf-ink)] ${status === 'cancelled' ? 'line-through opacity-60' : ''}`}>{job.location.client.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-[var(--cf-ink-muted)]">{performerName || 'Unassigned'}{job.location.name && job.location.name !== job.location.client.name ? ` | ${job.location.name}` : ''}</span>
                        </span>
                        {isSpecialClean(job) && <Star className="h-3 w-3 shrink-0 fill-[#FCD34D] text-[#D97706]" />}
                        {job.isTrial && <span className="shrink-0 rounded bg-[#fff0dc] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#9a4c0d]">Trial</span>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <button type="button" onClick={() => handleDateClick(day)} className="w-full px-3 py-5 text-center text-xs font-semibold text-[var(--cf-ink-muted)]">No jobs scheduled</button>
              )}
            </section>
          )
        })}
      </div>
    )
  }

  const isAllCleanersSelected = selectedCleanerIds.size === subcontractors.length && showUnassigned
  const monthLabel = format(currentDate, 'MMMM yyyy')

  const handleCleanerClick = (clickedId: string) => {
    if (isAllCleanersSelected) {
      setSelectedCleanerIds(new Set([clickedId]))
      setShowUnassigned(false)
    } else if (selectedCleanerIds.has(clickedId)) {
      if (selectedCleanerIds.size === 1 && !showUnassigned) {
        setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
        setShowUnassigned(true)
      } else {
        const next = new Set(selectedCleanerIds)
        next.delete(clickedId)
        setSelectedCleanerIds(next)
      }
    } else {
      const next = new Set(selectedCleanerIds)
      next.add(clickedId)
      setSelectedCleanerIds(next)
    }
  }

  const handleUnassignedClick = () => {
    if (isAllCleanersSelected) {
      setSelectedCleanerIds(new Set())
      setShowUnassigned(true)
    } else if (showUnassigned) {
      if (selectedCleanerIds.size === 0) {
        setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
        setShowUnassigned(true)
      } else {
        setShowUnassigned(false)
      }
    } else {
      setShowUnassigned(true)
    }
  }

  // Desktop header — Google Calendar style, compact toolbar
  const renderHeader = () => {
    const isAllCleanersSelected = selectedCleanerIds.size === subcontractors.length && showUnassigned
    const isAllClientsSelected = filterBarClientIds.size === 0
    const isAllTeamSelected = isAllCleanersSelected && selectedVendorIds.size === vendorOptions.length
    const filterCount = (isAllTeamSelected ? 0 : 1) + (isAllClientsSelected ? 0 : 1)
    
    // Build active filter summary text
    let activeSummaryParts: string[] = []
    if (!isAllTeamSelected) {
      const names = Array.from(selectedCleanerIds).map(id => subcontractors.find(s => s.id === id)?.name.split(' ')[0]).filter(Boolean)
      names.push(...Array.from(selectedVendorIds).map(id => vendorOptions.find(vendor => vendor.id === id)?.name).filter(Boolean) as string[])
      if (showUnassigned) names.push("Unassigned")
      if (names.length > 0) activeSummaryParts.push(names.join(", "))
    }
    if (!isAllClientsSelected) {
      const names = Array.from(filterBarClientIds).map(id => clients.find(c => c.id === id)?.name).filter(Boolean)
      if (names.length > 0) activeSummaryParts.push(names.join(", "))
    }
    const activeSummaryText = activeSummaryParts.join(" · ")

    // Density slider: snaps to one of three discrete WeekDensity values.
    const densityToSlider = (d: WeekDensity) => d === 'Comfortable' ? 0 : d === 'Compact' ? 50 : 100
    const sliderToDensity = (v: number): WeekDensity => v < 25 ? 'Comfortable' : v < 75 ? 'Compact' : 'Dense'
    const sliderValue = densityToSlider(weekDensity)
    const navLabel = viewMode === 'month' ? 'month' : viewMode === 'day' ? 'day' : 'week'
    const desktopHeaderLabel = viewMode === 'day'
      ? format(currentDate, 'EEE, MMM d, yyyy')
      : viewMode === 'month'
        ? monthLabel
        : `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d')} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
    const selectedTeamValues = new Set<string>([
      ...Array.from(selectedCleanerIds),
      ...Array.from(selectedVendorIds).map(id => `vendor:${id}`),
      ...(showUnassigned ? ['__unassigned__'] : []),
    ])
    const teamOptions: SearchSelectOption[] = [
      ...subcontractors.map(subcontractor => ({ value: subcontractor.id, label: subcontractor.name, hex: getCleanerColorInfo(subcontractor.name).hex })),
      ...vendorOptions.map(vendor => ({ value: `vendor:${vendor.id}`, label: vendor.name, hex: getCleanerColorInfo(vendor.name).hex, badge: 'Vendor' })),
      { value: '__unassigned__', label: 'Unassigned', hex: '#64748B' },
    ]
    const selectedClientValues = isAllClientsSelected
      ? new Set(clients.map(client => client.id))
      : filterBarClientIds
    const clientOptions: SearchSelectOption[] = clients.map(client => ({ value: client.id, label: client.name }))
    const specialRangeStart = viewMode === 'month' ? startOfMonth(currentDate) : startOfWeek(currentDate, { weekStartsOn: 1 })
    const specialRangeEnd = viewMode === 'month' ? endOfMonth(currentDate) : addDays(specialRangeStart, 6)
    const specialCount = filteredJobs.filter(job => {
      const jobTime = new Date(job.date).getTime()
      return isSpecialClean(job)
        && jobTime >= new Date(specialRangeStart).setHours(0, 0, 0, 0)
        && jobTime <= new Date(specialRangeEnd).setHours(23, 59, 59, 999)
    }).length
    const searchResults = headerSearch.trim()
      ? jobs
          .filter(job => {
            const query = headerSearch.trim().toLowerCase()
            return job.location.client.name.toLowerCase().includes(query)
              || job.location.name.toLowerCase().includes(query)
              || ((job as JobWithFullRelations & { notes?: string | null }).notes || '').toLowerCase().includes(query)
              || (getPerformerName(job) || '').toLowerCase().includes(query)
          })
          .slice(0, 6)
          .map(job => ({
            id: job.id,
            primary: job.location.client.name,
            secondary: `${format(new Date(job.date), 'EEE, MMM d')} | ${getPerformerName(job) || 'Unassigned'}`,
            kind: job.isTrial ? 'Trial' : job.scheduleId ? 'Job' : 'One-off',
            hex: getCleanerColorInfo(getPerformerName(job)).hex,
          }))
      : []

    const setTeamSelection = (values: Set<string>) => {
      setSelectedCleanerIds(new Set(Array.from(values).filter(value => !value.startsWith('vendor:') && value !== '__unassigned__')))
      setSelectedVendorIds(new Set(Array.from(values).filter(value => value.startsWith('vendor:')).map(value => value.slice(7))))
      setShowUnassigned(values.has('__unassigned__'))
    }

    return (
      <div className="hidden shrink-0 flex-col border-b border-[var(--cf-rule)] bg-[var(--cf-surface-soft)] shadow-[var(--cf-panel-shadow)] lg:flex">
        <div className="flex h-16 w-full items-center gap-2 px-3">
          {/* LEFT: arrows + month label/picker + Today */}
          <div className="flex items-center gap-0.5">
            <NavArrow direction="prev" label={`Previous ${navLabel}`} onClick={() => navigate('prev')} />
            <NavArrow direction="next" label={`Next ${navLabel}`} onClick={() => navigate('next')} />
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setMonthPickerYear(currentDate.getFullYear())
                setShowMonthPicker(!showMonthPicker)
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--cf-field)]"
            >
              <span className="whitespace-nowrap text-[18px] font-extrabold leading-none text-[var(--cf-ink)]">{desktopHeaderLabel}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-[var(--cf-ink-muted)] transition-transform ${showMonthPicker ? 'rotate-180' : ''}`} />
            </button>
            {showMonthPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-lg border border-[var(--cf-rule)] bg-white p-4 shadow-[0_14px_36px_rgba(40,30,10,0.14)]">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setMonthPickerYear(y => y - 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]"
                    aria-label="Previous year"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[15px] font-extrabold text-[var(--cf-ink)]">{monthPickerYear}</span>
                  <button
                    onClick={() => setMonthPickerYear(y => y + 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]"
                    aria-label="Next year"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {MONTHS.map((m, mi) => {
                    const isActive = currentDate.getMonth() === mi && currentDate.getFullYear() === monthPickerYear
                    return (
                      <button
                        key={m}
                        onClick={() => selectMonth(mi)}
                        className={`py-2 text-[13px] font-medium rounded-md transition-colors ${
                          isActive ? 'bg-[var(--cf-green)] text-white' : 'text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]'
                        }`}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-3 flex justify-end border-t border-[var(--cf-grid-rule)] pt-2">
                  <button
                    onClick={() => { goToToday(); setShowMonthPicker(false) }}
                    className="text-[12px] font-bold text-[var(--cf-green)] hover:text-[var(--cf-green-hover)]"
                  >
                    This {navLabel}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={goToToday}
            className="rounded-lg border border-[var(--cf-green-rule)] bg-[var(--cf-green-soft)] px-3 py-1.5 text-xs font-bold text-[var(--cf-green)] transition-colors hover:bg-[var(--cf-green-soft-hover)]"
          >
            Today
          </button>

          {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin text-teal-600" />}

          <div className="mx-1 h-6 w-px bg-[var(--cf-rule)]" />

          <HeaderSearch
            value={headerSearch}
            onChange={setHeaderSearch}
            results={searchResults}
            onPick={(jobId) => {
              const job = jobs.find(item => item.id === jobId)
              if (!job) return
              setCurrentDate(new Date(job.date))
              setHeaderSearch(job.location.client.name)
              handleJobClick(job)
            }}
          />
          <SearchSelect
            defaultLabel="Team"
            selectedValues={selectedTeamValues}
            options={teamOptions}
            allSelected={isAllTeamSelected}
            onToggle={(value) => {
              const next = new Set(selectedTeamValues)
              if (next.has(value)) next.delete(value)
              else next.add(value)
              setTeamSelection(next)
            }}
            onSelectOnly={(value) => setTeamSelection(new Set([value]))}
            onSelectAll={() => setTeamSelection(isAllTeamSelected ? new Set() : new Set(teamOptions.map(option => option.value)))}
          />
          <SearchSelect
            defaultLabel="Clients"
            selectedValues={selectedClientValues}
            options={clientOptions}
            allSelected={isAllClientsSelected}
            onToggle={(value) => {
              const next = new Set(selectedClientValues)
              if (next.has(value)) next.delete(value)
              else next.add(value)
              setFilterBarClientIds(next.size === clients.length ? new Set() : next)
            }}
            onSelectOnly={(value) => setFilterBarClientIds(new Set([value]))}
            onSelectAll={() => setFilterBarClientIds(isAllClientsSelected ? new Set(['__none__']) : new Set())}
          />
          {filterCount > 0 && (
            <button
              onClick={() => {
                setTeamSelection(new Set(teamOptions.map(option => option.value)))
                setFilterBarClientIds(new Set())
              }}
              aria-label="Clear all filters"
              title="Clear all filters"
              className="flex h-6 w-6 items-center justify-center rounded-md text-red-500 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <div className="flex-1" />

          {/* RIGHT: View toggle + density slider + Add Job + overflow */}
          <button
            type="button"
            onClick={() => setSpecialRailOpen(current => !current)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
              specialRailOpen
                ? 'border-[#99e6db] bg-[#ecfdf9] text-[#0f766e]'
                : 'border-[var(--cf-rule)] bg-white text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]'
            }`}
          >
            <Star className="h-3.5 w-3.5 fill-[#d97706] text-[#d97706]" />
            Special cleans
            <span className="rounded-full bg-[#d97706] px-1.5 py-0.5 text-[9px] leading-none text-white">{specialCount}</span>
          </button>
          <div className="flex items-center rounded-lg bg-[#f1f5f9] p-0.5">
            {(['day', 'week', 'month', 'list'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-all ${
                  viewMode === mode
                    ? 'bg-white text-[var(--cf-ink)] shadow-sm'
                    : 'text-[#7f8ea3] hover:text-[#334155]'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Density slider — always rendered to reserve space so the Week/Month toggle and
              Add Job button don't shift when switching views. Visibility is hidden in month view. */}
          <div
            className="hidden 2xl:flex items-center gap-2"
            title={`Density: ${weekDensity}`}
            style={{ visibility: viewMode === 'week' || viewMode === 'day' ? 'visible' : 'hidden' }}
            aria-hidden={viewMode !== 'week' && viewMode !== 'day'}
          >
            <span className="text-[9px] text-gray-300 leading-none">☰</span>
            <div
              className="relative flex h-5 w-[88px] cursor-pointer items-center"
              onMouseDown={() => {
                if (viewMode !== 'week' && viewMode !== 'day') return
                // Prevent text selection / grabbing cursor while dragging the slider.
                document.body.style.userSelect = 'none'
                document.body.style.cursor = 'grabbing'
                const onUp = () => {
                  document.body.style.userSelect = ''
                  document.body.style.cursor = ''
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mouseup', onUp)
              }}
            >
              <div className="absolute inset-x-0 h-1 rounded-full bg-[var(--cf-rule)]" />
              <div
                className="absolute h-1 rounded-full bg-[var(--cf-green)]"
                style={{ width: `${sliderValue}%` }}
              />
              <input
                type="range"
                min={0}
                max={100}
                step={50}
                value={sliderValue}
                onChange={(e) => changeWeekDensity(sliderToDensity(Number(e.target.value)))}
                aria-label="Week density"
                disabled={viewMode !== 'week' && viewMode !== 'day'}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
              <div
                className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-[var(--cf-green)] bg-white shadow-sm transition-all"
                style={{ left: `calc(${sliderValue}% - 7px)` }}
              />
            </div>
            <span className="text-[9px] text-gray-300 leading-none">≡</span>
          </div>

          <button
            onClick={() => handleDateClick(currentDate)}
            className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--cf-green)] px-3.5 py-2 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-[var(--cf-green-hover)]"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Job
          </button>

          {/* Three-dots overflow menu removed per Josh's feedback. Bulk Edit can be re-added
              later as a more discoverable affordance if needed. */}
          {false && <div className="relative" ref={overflowMenuRef}>
            <button
              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-500"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showOverflowMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50 w-48">
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode)
                    if (isSelectionMode) clearSelection()
                    setShowOverflowMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {isSelectionMode ? 'Exit Bulk Edit' : 'Bulk Edit Jobs'}
                </button>
                {viewMode === 'week' && (
                  <>
                    <div className="h-px bg-gray-100 my-1" />
                    <div className="px-4 py-1.5">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Week Density</p>
                      <div className="flex flex-col">
                        {(['Comfortable', 'Compact', 'Dense'] as WeekDensity[]).map(d => (
                          <button
                            key={d}
                            onClick={() => {
                              changeWeekDensity(d)
                              setShowOverflowMenu(false)
                            }}
                            className={`text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                              weekDensity === d ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>}
        </div>

        {/* Active Filter Summary Row */}
        {filterCount > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--cf-rule-soft)] bg-[var(--cf-surface-hover)] px-5 py-1.5 text-xs">
            <div className="flex items-center gap-2 overflow-hidden text-[var(--cf-ink-secondary)]">
              <span className="shrink-0 font-bold text-[var(--cf-ink)]">Filters:</span>
              <span className="truncate">{activeSummaryText}</span>
            </div>
            <button
              onClick={() => {
                setTeamSelection(new Set(teamOptions.map(option => option.value)))
                setFilterBarClientIds(new Set())
              }}
              className="ml-4 shrink-0 font-bold text-[var(--cf-green)] hover:text-[var(--cf-green-hover)]"
            >
              Clear All
            </button>
          </div>
        )}
      </div>
    )
  }

  // Old filter panel removed — filters now live in the header


  // Helper for parsing time
  const getCompactTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const isPM = h >= 12;
    const hour = h % 12 || 12;
    const min = m > 0 ? `:${m.toString().padStart(2, '0')}` : '';
    return `${hour}${min}${isPM ? 'p' : 'a'}`;
  };

  const renderCompactWeekTable = (days: Date[]) => {
    const densityConfig = {
      Comfortable: { cellMinHeight: 86, cardMinHeight: 58, cardPadding: '7px 9px', cardGap: 6 },
      Compact: { cellMinHeight: 66, cardMinHeight: 48, cardPadding: '6px 8px', cardGap: 5 },
      Dense: { cellMinHeight: 46, cardMinHeight: 34, cardPadding: '4px 6px', cardGap: 4 },
    }[weekDensity]

    const getMinutes = (timeStr: string | null | undefined) => {
      if (!timeStr) return 0
      const [h, m] = timeStr.split(':').map(Number)
      if (isNaN(h) || isNaN(m)) return 0
      return h * 60 + m
    }

    const getJobStart = (job: JobWithFullRelations) => job.startTime || job.startWindowBegin || null

    const getJobEnd = (job: JobWithFullRelations) => {
      const start = getJobStart(job)
      if (!start) return null
      if (job.startWindowBegin && job.startWindowEnd) return job.startWindowEnd
      const endMinutes = getMinutes(start) + 60
      const hours = Math.floor(endMinutes / 60)
      const minutes = endMinutes % 60
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    }

    const getHourLabel = (hour: number) => {
      if (hour === 0) return '12a'
      if (hour < 12) return `${hour}a`
      if (hour === 12) return '12p'
      return `${hour - 12}p`
    }

    const getCleanerShort = (name: string | null | undefined) => {
      if (!name) return 'Unassigned'
      const parts = name.split(' ').filter(Boolean)
      if (parts.length <= 1) return parts[0] || name
      return `${parts[0]} ${parts[1][0]}.`
    }

    const getCompactLocationName = (job: JobWithFullRelations) => {
      const clientName = job.location.client.name
      const locationName = job.location.name
      if (!locationName || locationName === clientName) return ''
      return locationName.replace(clientName, '').replace(/[()]/g, '').trim()
    }

    const getJobTimeRange = (job: JobWithFullRelations) => {
      const start = getJobStart(job)
      if (!start) return 'TBD'
      const end = getJobEnd(job)
      return end ? `${getCompactTime(start)}-${getCompactTime(end)}` : getCompactTime(start)
    }

    const timedJobsByDay = days.map(day =>
      getJobsForDate(day)
        .filter(job => !!getJobStart(job))
        .sort((a, b) => getMinutes(getJobStart(a)) - getMinutes(getJobStart(b)))
    )

    const timeSlots = Array.from(new Set(
      timedJobsByDay.flatMap(dayJobs =>
        dayJobs.map(job => Math.floor(getMinutes(getJobStart(job)) / 60))
      )
    )).sort((a, b) => a - b)
    const visibleTimeSlots = timeSlots.length > 0 ? timeSlots : [9]
    const unscheduledJobsByDay = days.map(day => getJobsForDate(day).filter(job => !getJobStart(job)))
    const hasUnscheduledJobs = unscheduledJobsByDay.some(dayJobs => dayJobs.length > 0)

    const getJobsForHour = (dayIndex: number, hour: number) =>
      timedJobsByDay[dayIndex].filter(job => Math.floor(getMinutes(getJobStart(job)) / 60) === hour)

    const renderCompactJobCard = (job: JobWithFullRelations, compact = false) => {
      const performerName = getPerformerName(job)
      const { hex } = getCleanerColorInfo(performerName)
      const isCancelledCard = job.status === 'CANCELLED'
      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id)
      const isSelected = selectedJobIds.has(job.id)
      const timeRange = getJobTimeRange(job)
      const cleanerShort = getCleanerShort(performerName)
      const locationName = getCompactLocationName(job)
      const title = `${timeRange} ${job.location.client.name}${performerName ? ` · ${performerName}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`

      const isDenseCard = compact || weekDensity === 'Dense'
      return (
        <button
          key={job.id}
          type="button"
          title={title}
          onClick={(e) => {
            e.stopPropagation()
            if (isSelectionMode) toggleJobSelection(job.id)
            else handleJobClick(job)
          }}
          className={[
            "group block w-full cursor-pointer overflow-hidden rounded-md text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--cf-green)]",
            isSelected ? "ring-2 ring-[var(--cf-green)]" : "",
          ].join(" ")}
          style={{
            border: `1px solid ${isCancelledCard ? '#D1D5DB' : `${hex}33`}`,
            borderLeft: `4px solid ${isCancelledCard ? '#9CA3AF' : hex}`,
            backgroundColor: isCancelledCard ? '#F3F4F6' : `${hex}1A`,
            opacity: isDimmed ? 0.3 : isCancelledCard ? 0.65 : 1,
            padding: isDenseCard ? densityConfig.cardPadding : '7px 9px',
            minHeight: isDenseCard ? `${densityConfig.cardMinHeight}px` : '58px',
          }}
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-mono text-[10px] font-bold text-[var(--cf-ink-secondary)]">
              {timeRange}
            </span>
            <span className={`min-w-0 truncate text-[13px] font-extrabold leading-tight ${isCancelledCard ? 'text-[#7f8ea3] line-through' : 'text-[var(--cf-ink)]'}`}>
              {job.location.client.name}
            </span>
          </div>
          <div className={`${weekDensity === 'Dense' ? 'hidden' : 'mt-0.5'} truncate text-[11px] font-semibold leading-tight text-[var(--cf-ink-secondary)]`}>
            {cleanerShort}
          </div>
          {!isDenseCard && locationName && (
            <div className="mt-0.5 truncate text-[11px] leading-tight text-[var(--cf-ink-muted)]">
              {locationName}
            </div>
          )}
        </button>
      )
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--cf-canvas)]">
        <div className="flex shrink-0 border-b border-[var(--cf-rule)] bg-white">
          <div className="w-12 shrink-0 border-r border-[var(--cf-rule)]" />
          <div className="grid flex-1 grid-cols-7">
            {days.map(day => {
              const isTodayDate = isToday(day)
              // Per calendar_dev_notes.md: today is a teal circle on the date number only,
              // NOT a full-column dark background (which washed out the job block colors).
              return (
                <div key={day.toString()} className="border-r border-[var(--cf-rule)] py-2 text-center last:border-r-0">
                  <div className={`text-[10px] font-extrabold uppercase tracking-[0.06em] ${isTodayDate ? 'text-[var(--cf-green)]' : 'text-[var(--cf-ink-muted)]'}`}>
                    {format(day, 'EEE')}
                  </div>
                  {isTodayDate ? (
                    <span
                      className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-base font-bold"
                      style={{ backgroundColor: 'var(--cf-green)', color: '#FFFFFF' }}
                    >
                      {format(day, 'd')}
                    </span>
                  ) : (
                    <div className="mt-0.5 text-lg font-extrabold text-[var(--cf-ink)]">
                      {format(day, 'd')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {hasUnscheduledJobs && (
          <div className="flex shrink-0 border-b border-[var(--cf-rule)] bg-white">
            <div className="w-12 shrink-0 border-r border-[var(--cf-rule)] px-2 py-2 text-right text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--cf-ink-muted)]">
              TBD
            </div>
            <div className="grid flex-1 grid-cols-7">
              {days.map((day, dayIndex) => (
                <div key={day.toString()} className="min-h-[34px] border-r border-[var(--cf-grid-rule)] p-1.5 last:border-r-0">
                  <div className="flex flex-col gap-1">
                    {unscheduledJobsByDay[dayIndex].map(job => {
                      const { hex } = getCleanerColorInfo(getPerformerName(job))
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id)
                      const isSelected = selectedJobIds.has(job.id)
                      return (
                        <button
                          key={job.id}
                          type="button"
                          title={`TBD ${job.location.client.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isSelectionMode) toggleJobSelection(job.id)
                            else handleJobClick(job)
                          }}
                          className={`h-7 cursor-pointer truncate rounded-md bg-white px-2 py-1.5 text-left text-[11px] font-bold leading-none text-[var(--cf-ink)] shadow-sm ring-1 ring-[var(--cf-rule)] ${isSelected ? 'ring-2 ring-[var(--cf-green)]' : ''}`}
                          style={{ borderLeft: `3px solid ${hex}`, opacity: isDimmed ? 0.3 : 1 }}
                        >
                          TBD · {job.location.client.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-[var(--cf-canvas)]">
          <table className="w-full table-fixed border-collapse bg-white">
            <tbody>
              {visibleTimeSlots.map((hour, rowIndex) => {
                const nextHour = visibleTimeSlots[rowIndex + 1]
                const hasLargeGap = nextHour ? nextHour - hour >= 3 : false

                return (
                  <Fragment key={`slot-${hour}`}>
                    <tr className="align-top">
                      <td className="w-12 border-b border-[var(--cf-rule-soft)] pr-2 pt-3 text-right align-top">
                        <span className="font-mono text-[10px] font-bold text-[var(--cf-ink-muted)]">
                          {getHourLabel(hour)}
                        </span>
                      </td>
                      {days.map((day, dayIndex) => {
                        const jobsForHour = getJobsForHour(dayIndex, hour)
                        return (
                          <td
                            key={`${day.toISOString()}-${hour}`}
                            className="min-h-[62px] border-b border-l border-[var(--cf-rule-soft)] p-1.5 align-top last:border-r"
                            style={{ minHeight: densityConfig.cellMinHeight }}
                            onClick={() => handleTimeSlotClick(day, `${String(hour).padStart(2, '0')}:00`)}
                          >
                            <div className="flex flex-col" style={{ gap: densityConfig.cardGap }}>
                              {jobsForHour.map(job => renderCompactJobCard(job, jobsForHour.length > 2))}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                    {hasLargeGap && (
                      <tr>
                        <td colSpan={8} className="h-3 border-b border-[var(--cf-rule-soft)] bg-[var(--cf-canvas)]">
                          <div className="mx-auto h-px w-12 border-t border-dashed border-[#cfc7b6] opacity-70" />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderListView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))

    return (
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-x-auto bg-white" style={{ minWidth: 980 }}>
        {days.map(day => {
          const dayJobs = getJobsForDate(day).sort((a, b) => (a.startTime || a.startWindowBegin || '99:99').localeCompare(b.startTime || b.startWindowBegin || '99:99'))
          const today = isToday(day)
          return (
            <section key={day.toISOString()} className="flex min-w-0 flex-col border-r border-[#eef1f4] last:border-r-0" style={{ backgroundColor: today ? 'rgba(13,148,136,0.025)' : '#FFFFFF' }}>
              <button type="button" onClick={() => handleDateClick(day)} className="border-b border-[#eef1f4] px-2.5 py-3 text-center hover:bg-[#f8faf9]">
                <span className={`block text-[10px] font-extrabold uppercase tracking-[0.06em] ${today ? 'text-[var(--cf-green)]' : 'text-[#7f8ea3]'}`}>{format(day, 'EEE')}</span>
                <span className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-base font-extrabold ${today ? 'bg-[var(--cf-green)] text-white' : 'text-[#1e293b]'}`}>{format(day, 'd')}</span>
                <span className="mt-1 block text-[10px] font-semibold text-[#7f8ea3]">{dayJobs.length} clean{dayJobs.length === 1 ? '' : 's'}</span>
              </button>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                {dayJobs.map(job => {
                  const performerName = getPerformerName(job)
                  const { colorKey } = getCleanerColorInfo(performerName)
                  const spineColor = JOB_SPINE_COLORS[colorKey]
                  const status = getJobStatus(job)
                  const time = job.startTime || job.startWindowBegin
                  const unassigned = !performerName && status !== 'cancelled'
                  return (
                    <button
                      type="button"
                      key={job.id}
                      onClick={() => handleJobClick(job)}
                      className="relative rounded-md border p-2 text-left transition-transform hover:-translate-y-px hover:shadow-md"
                      style={{
                        background: status === 'cancelled' ? '#F3F4F6' : unassigned ? '#FFF6EA' : JOB_GRADIENTS[colorKey],
                        borderColor: status === 'cancelled' ? '#D1D5DB' : unassigned ? '#E3A44A' : 'rgba(255,255,255,0.88)',
                        borderStyle: unassigned ? 'dashed' : 'solid',
                        borderLeft: `5px solid ${status === 'cancelled' ? '#9CA3AF' : unassigned ? '#D97706' : spineColor}`,
                        boxShadow: '0 2px 0 rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.08)',
                        opacity: status === 'cancelled' ? 0.65 : 1,
                      }}
                    >
                      {isSpecialClean(job) && status !== 'cancelled' && <Star className="absolute right-1.5 top-1.5 h-2.5 w-2.5 fill-[#FCD34D] text-[#D97706]" />}
                      {status === 'cancelled' && <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.05em] text-[#b42318]">Cancelled</span>}
                      <span className={`block truncate pr-3 text-xs font-extrabold leading-tight ${status === 'cancelled' ? 'text-[#7f8ea3] line-through' : unassigned ? 'text-[#1e293b]' : 'text-white'}`}>{job.location.client.name}</span>
                      <span className={`mt-1 block text-[10px] font-bold ${status === 'cancelled' || unassigned ? 'text-[#526072]' : 'text-white/95'}`}>{time ? formatTime(time) : 'Time TBD'}</span>
                      <span className={`mt-0.5 block truncate text-[10px] ${status === 'cancelled' || unassigned ? 'text-[#7f8ea3]' : 'text-white/85'}`}>{performerName || 'Unassigned'}</span>
                    </button>
                  )
                })}
                {dayJobs.length === 0 && <div className="py-8 text-center text-xs text-[#c3cad2]">No jobs</div>}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  const renderSpecialCleansRail = () => {
    const rangeStart = viewMode === 'month'
      ? startOfMonth(currentDate)
      : startOfWeek(currentDate, { weekStartsOn: 1 })
    const rangeEnd = viewMode === 'month'
      ? endOfMonth(currentDate)
      : addDays(rangeStart, 6)
    const rangeStartTime = new Date(rangeStart).setHours(0, 0, 0, 0)
    const rangeEndTime = new Date(rangeEnd).setHours(23, 59, 59, 999)
    const specialJobs = filteredJobs
      .filter(isSpecialClean)
      .filter(job => {
        const jobTime = new Date(job.date).getTime()
        return jobTime >= rangeStartTime && jobTime <= rangeEndTime
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || timeToMinutes(a.startTime || a.startWindowBegin) - timeToMinutes(b.startTime || b.startWindowBegin))

    const groups = Array.from(new Set(specialJobs.map(job => format(new Date(job.date), 'yyyy-MM-dd'))))
      .map(dateKey => ({
        dateKey,
        jobs: specialJobs.filter(job => format(new Date(job.date), 'yyyy-MM-dd') === dateKey),
      }))

    return (
      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-l border-[#e6eaee] bg-[#fbfdfc]">
        <div className="border-b border-[#e6eaee] px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[13px] font-extrabold text-[#0f172a]">Special cleans</h2>
              <span className="text-[11px] font-bold text-[#7f8ea3]">{specialJobs.length}</span>
            </div>
            <button type="button" onClick={() => setSpecialRailOpen(false)} aria-label="Close special cleans" title="Close special cleans" className="flex h-7 w-7 items-center justify-center rounded-md text-[#aab2bd] hover:bg-[#eef2f4] hover:text-[#64748b]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-[#7f8ea3]">First cleans, trials and one-offs flagged ahead.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          {groups.map(group => (
            <section key={group.dateKey} className="mb-3">
              <h3 className="mb-1 px-0.5 text-[9.5px] font-bold uppercase tracking-[0.05em] text-[#a6afba]">{format(new Date(`${group.dateKey}T12:00:00`), 'EEEE · MMM d')}</h3>
              <div className="space-y-1.5">
                {group.jobs.map(job => {
                  const performerName = getPerformerName(job)
                  const { colorKey, hex } = getCleanerColorInfo(performerName)
                  const spineColor = JOB_SPINE_COLORS[colorKey]
                  const time = job.startTime || job.startWindowBegin
                  const minutes = timeToMinutes(time)
                  const outsideHours = Boolean(time && (minutes < 9 * 60 || minutes >= 17 * 60))
                  return (
                    <button
                      type="button"
                      key={job.id}
                      onClick={() => handleJobClick(job)}
                      className="w-full rounded-md border border-[#e7ebef] bg-white px-2 py-1.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.07)] transition-shadow hover:shadow-md"
                      style={{ borderLeft: `3px solid ${spineColor}` }}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-[#0f172a]">{time ? formatTime(time) : 'TBD'}</span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-[#1e293b]">{job.location.client.name}</span>
                        {outsideHours && <span className="shrink-0 rounded bg-[#fef3c7] px-1 text-[8px] font-extrabold uppercase text-[#9a5a08]">{minutes < 9 * 60 ? 'Early' : 'Late'}</span>}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.03em]" style={{ backgroundColor: `${hex}20`, color: spineColor }}>{getSpecialCleanLabel(job)}</span>
                        <span className="min-w-0 truncate text-[10px] text-[#7f8ea3]">{performerName || 'Unassigned'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          {specialJobs.length === 0 && <div className="px-3 py-10 text-center text-[11px] text-[#b1b9c3]">No special cleans in this range</div>}
        </div>
      </aside>
    )
  }

  const renderDayCrewView = () => {
    const startHour = 5
    const endHour = 23
    const hoursCount = endHour - startHour
    const hourHeight = weekDensity === 'Comfortable' ? 72 : weekDensity === 'Compact' ? 56 : 44
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const showCurrentTimeLine = isToday(currentDate) && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60
    const currentTimeTop = ((nowMinutes / 60) - startHour) * hourHeight
    const dayJobs = getJobsForDate(currentDate)
    const crewColumns = [
      ...(showUnassigned ? [{ key: '__unassigned__', name: 'Unassigned', vendor: false, hex: '#94A3B8' }] : []),
      ...subcontractors
        .filter(person => selectedCleanerIds.has(person.id))
        .map(person => ({ key: person.id, name: person.name, vendor: false, hex: getCleanerColorInfo(person.name).hex })),
      ...vendorOptions
        .filter(vendor => selectedVendorIds.has(vendor.id))
        .map(vendor => ({ key: `vendor:${vendor.id}`, name: vendor.name, vendor: true, hex: getCleanerColorInfo(vendor.name).hex })),
    ]

    const jobsForCrew = (crewKey: string) => dayJobs.filter(job => {
      if (crewKey === '__unassigned__') return !job.subcontractor && !(job as JobWithFullRelations & { vendor?: { id: string } | null }).vendor
      if (crewKey.startsWith('vendor:')) return (job as JobWithFullRelations & { vendor?: { id: string } | null }).vendor?.id === crewKey.slice(7)
      return job.subcontractor?.id === crewKey
    })

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[1080px]">
            <div className="sticky top-0 z-30 flex border-b border-[#EEF1F4] bg-white">
              <div className="w-14 shrink-0 border-r border-[#EEF1F4]" />
              <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${Math.max(crewColumns.length, 1)}, minmax(112px, 1fr))` }}>
                {crewColumns.map(crew => {
                  const crewJobs = jobsForCrew(crew.key).filter(job => job.status !== 'CANCELLED')
                  const totalHours = crewJobs.reduce((sum, job) => {
                    const start = timeToMinutes(job.startTime || job.startWindowBegin)
                    const end = job.startWindowBegin && job.startWindowEnd ? timeToMinutes(job.startWindowEnd) : start + 60
                    return sum + Math.max(0, end - start) / 60
                  }, 0)
                  const initials = crew.key === '__unassigned__' ? '?' : crew.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
                  return (
                    <div key={crew.key} className={`flex min-w-0 items-center gap-2 border-r border-[#EEF1F4] px-2 py-2 last:border-r-0 ${crewJobs.length === 0 ? 'opacity-50' : ''}`}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ backgroundColor: crew.hex }}>{initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="block truncate text-[11px] font-bold text-[#1E293B]">{crew.name}</span>
                          {crew.vendor && <span className="rounded bg-[#F0EEFF] px-1 py-0.5 text-[7px] font-extrabold uppercase tracking-[0.04em] text-[#7C6FC7]">Vendor</span>}
                        </span>
                        <span className="block truncate text-[9px] font-semibold text-[#7F8EA3]">{crewJobs.length} job{crewJobs.length === 1 ? '' : 's'} | {Math.round(totalHours * 10) / 10}h</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex" style={{ height: hoursCount * hourHeight }}>
              <div className="relative z-10 w-14 shrink-0 border-r border-[#EEF1F4] bg-white">
                {Array.from({ length: hoursCount + 1 }, (_, index) => {
                  const hour = startHour + index
                  return <div key={hour} className="absolute w-full pr-2 text-right text-[10px] font-semibold text-[#64748B]" style={{ top: index * hourHeight - (index === 0 ? -2 : 6) }}>{minutesToShortTime(hour * 60)}</div>
                })}
              </div>
              <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${Math.max(crewColumns.length, 1)}, minmax(112px, 1fr))` }}>
                <div className="pointer-events-none absolute inset-0">
                  {Array.from({ length: hoursCount + 1 }, (_, index) => <div key={index} className="absolute w-full border-t border-[#EEF1F4]" style={{ top: index * hourHeight }} />)}
                </div>
                {showCurrentTimeLine && (
                  <div className="pointer-events-none absolute inset-x-0 z-[95] h-0.5 bg-[#0D9488]/60" style={{ top: currentTimeTop }}>
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#0D9488]" />
                  </div>
                )}
                {crewColumns.map(crew => {
                  const layout = buildTimelineLayout(jobsForCrew(crew.key))
                  const activeOverlapJobId = hoveredOverlapJobId || expandedOverlapJobId
                  const activeOverlapPosition = layout.positions.find(position => position.job.id === activeOverlapJobId)
                  return (
                    <div
                      key={crew.key}
                      className="relative border-r border-[#EEF1F4] last:border-r-0"
                      style={{ backgroundColor: crew.vendor ? 'rgba(124,111,199,0.035)' : '#FFFFFF' }}
                      onClick={(event) => {
                        if (event.target !== event.currentTarget) return
                        const rect = event.currentTarget.getBoundingClientRect()
                        const rawMinutes = startHour * 60 + ((event.clientY - rect.top) / hourHeight) * 60
                        const rounded = Math.max(startHour * 60, Math.min(endHour * 60 - 30, Math.round(rawMinutes / 30) * 30))
                        handleTimeSlotClick(currentDate, `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`)
                      }}
                    >
                      {layout.positions.map(positioned => {
                        const { job, start, end, column, columnCount } = positioned
                        const visibleStart = Math.max(start, startHour * 60)
                        const visibleEnd = Math.min(end, endHour * 60)
                        if (visibleEnd <= visibleStart) return null
                        const top = ((visibleStart / 60) - startHour) * hourHeight
                        const height = Math.max(22, ((visibleEnd - visibleStart) / 60) * hourHeight - 3)
                        const widthPct = 100 / columnCount
                        const leftPct = column * widthPct
                        const overlaps = columnCount > 1
                        const expanded = overlaps && activeOverlapJobId === job.id
                        const expandedWidthPct = Math.min(100 - leftPct, widthPct * (columnCount >= 3 ? 1.65 : 1.5))
                        const staysAboveExpanded = Boolean(
                          activeOverlapPosition &&
                          activeOverlapPosition.groupId === positioned.groupId &&
                          column > activeOverlapPosition.column &&
                          start > activeOverlapPosition.start
                        )
                        const performerName = getPerformerName(job)
                        const { colorKey } = getCleanerColorInfo(performerName)
                        const spineColor = JOB_SPINE_COLORS[colorKey]
                        const status = getJobStatus(job)
                        const unassigned = !performerName && status !== 'cancelled'
                        return (
                          <DraggableTimelineJob
                            key={job.id}
                            job={job}
                            disabled={hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || Boolean((job as JobWithFullRelations & { vendorPaid?: boolean }).vendorPaid) || job.status === 'CANCELLED'}
                            title={`${formatTimelineRange(start, end)} ${job.location.client.name}`}
                            onMouseEnter={() => overlaps && setHoveredOverlapJobId(job.id)}
                            onMouseLeave={() => setHoveredOverlapJobId(current => current === job.id ? null : current)}
                            onClick={(event) => {
                              event.stopPropagation()
                              if (overlaps && expandedOverlapJobId !== job.id) {
                                setExpandedOverlapJobId(job.id)
                                return
                              }
                              handleJobClick(job)
                            }}
                            className={`absolute cursor-pointer overflow-hidden rounded-md border transition-[width,box-shadow] duration-150 ${expanded ? 'shadow-[0_10px_26px_rgba(16,24,40,0.28)]' : 'shadow-[0_1px_2px_rgba(16,24,40,0.1)] hover:shadow-lg'}`}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${leftPct}% + 2px)`,
                              width: expanded ? `calc(${expandedWidthPct}% - 4px)` : `calc(${widthPct}% - 4px)`,
                              maxWidth: expanded ? '240px' : undefined,
                              background: status === 'cancelled' ? '#F3F4F6' : unassigned ? '#FFF6EA' : JOB_GRADIENTS[colorKey],
                              borderColor: status === 'cancelled' ? '#C7CCD4' : unassigned ? '#E3A44A' : 'rgba(255,255,255,0.88)',
                              borderStyle: status === 'cancelled' || unassigned ? 'dashed' : 'solid',
                              borderLeft: `5px solid ${status === 'cancelled' ? '#9CA3AF' : unassigned ? '#D97706' : spineColor}`,
                              boxShadow: expanded
                                ? '0 10px 26px rgba(16,24,40,0.28)'
                                : '0 2px 0 rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.10)',
                              zIndex: expanded ? 80 : staysAboveExpanded ? 90 : 10 + column,
                              opacity: status === 'cancelled' ? 0.65 : 1,
                            }}
                          >
                            <div className="absolute inset-0 overflow-hidden px-2 py-1.5">
                              <div className={`truncate pr-3 text-[11px] font-extrabold ${status === 'cancelled' ? 'text-[#7f8ea3] line-through' : unassigned ? 'text-[#1E293B]' : 'text-white'}`}>{job.location.client.name}</div>
                              {height >= 32 && <div className={`mt-0.5 truncate text-[9.5px] font-bold ${status === 'cancelled' || unassigned ? 'text-[#526072]' : 'text-white/95'}`}>{formatTimelineRange(start, end)}</div>}
                              {job.addOnServices?.[0] && height >= 54 && <span className="mt-1 inline-block max-w-full truncate rounded bg-[#FFF3B0] px-1.5 py-0.5 text-[8px] font-extrabold text-[#92400E]">+ {job.addOnServices[0].description}</span>}
                              {isSpecialClean(job) && status !== 'cancelled' && <Star className="absolute right-1.5 top-1.5 h-2.5 w-2.5 fill-[#FCD34D] text-[#D97706]" />}
                            </div>
                          </DraggableTimelineJob>
                        )
                      })}
                      {layout.overflow.map(chip => {
                        const top = ((Math.max(chip.start, startHour * 60) / 60) - startHour) * hourHeight
                        const height = Math.max(34, ((Math.min(chip.end, endHour * 60) - Math.max(chip.start, startHour * 60)) / 60) * hourHeight - 3)
                        const widthPct = 100 / chip.columnCount
                        return (
                          <button
                            type="button"
                            key={`day-overflow-${crew.key}-${chip.groupId}`}
                            onClick={(event) => { event.stopPropagation(); setDayPopoverDate(currentDate); setDayPopoverJobs(chip.jobs) }}
                            className="absolute z-20 flex flex-col items-center justify-center rounded-md border border-dashed border-[#C8CFD8] bg-[#EEF1F5] text-[#475569] hover:bg-[#E3E8EF]"
                            style={{ top, height, left: `calc(${chip.column * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
                          >
                            <span className="text-xs font-extrabold">+{chip.jobs.length}</span>
                            {height >= 44 && <span className="text-[8px] font-extrabold uppercase tracking-[0.05em] text-[#7F8EA3]">More</span>}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderWeekView = () => {
    if (viewMode === 'day') return renderDayCrewView()
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

    const startHour = 5
    const endHour = 23
    const hoursCount = endHour - startHour
    const hourHeight = weekDensity === 'Comfortable' ? 72 : weekDensity === 'Compact' ? 56 : 44

    const unscheduledJobsByDay = days.map(day =>
      getJobsForDate(day).filter(job => !(job.startTime || job.startWindowBegin))
    );
    const hasUnscheduledJobs = unscheduledJobsByDay.some(dayJobs => dayJobs.length > 0);

    return (
      <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
        {/* Header Row */}
        <div className="flex border-b border-gray-200 shrink-0">
          <div className="w-14 shrink-0 border-r border-gray-200" />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map(day => {
              const isTodayDate = isToday(day);
              return (
                <div key={day.toString()} className="text-center py-2 border-r border-gray-200 last:border-r-0">
                  <div className={`text-[11px] font-semibold uppercase ${isTodayDate ? 'text-teal-700' : 'text-gray-500'}`}>
                    {format(day, 'EEE')}
                  </div>
                  <div className={`text-lg mt-0.5 font-medium ${isTodayDate ? 'text-white bg-teal-600 w-8 h-8 rounded-full flex items-center justify-center mx-auto' : 'text-gray-900'}`}>
                    {format(day, 'd')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {hasUnscheduledJobs && (
          <div className="flex shrink-0 border-b border-gray-200 bg-gray-50/95">
            <div className="w-14 shrink-0 border-r border-gray-200 px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-gray-500">
              TBD
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((day, di) => (
                <div key={day.toString()} className="min-h-[34px] border-r border-gray-100 last:border-r-0 p-1">
                  <div className="flex flex-col gap-1">
                    {unscheduledJobsByDay[di].map(job => {
                      const performerName = getPerformerName(job);
                      const { hex } = getCleanerColorInfo(performerName);
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id);
                      const isSelected = selectedJobIds.has(job.id);
                      const tooltipText = `TBD ${job.location.client.name}${performerName ? ` · ${performerName}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`;

                      return (
                        <div
                          key={job.id}
                          title={tooltipText}
                          onClick={(e) => { e.stopPropagation(); if (isSelectionMode) toggleJobSelection(job.id); else handleJobClick(job); }}
                          className={`h-6 cursor-pointer truncate rounded-md bg-white px-2 py-1 text-[11px] font-semibold leading-none text-gray-900 shadow-sm ring-1 ring-gray-200 ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
                          style={{
                            borderLeft: `3px solid ${hex}`,
                            opacity: isDimmed ? 0.3 : 1,
                          }}
                        >
                          TBD · {job.location.client.name}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Scrollable Time Grid */}
        <div className="flex-1 overflow-y-auto relative">
          <div className="flex" style={{ height: hoursCount * hourHeight }}>
            {/* Time Gutter */}
            <div className="w-14 shrink-0 border-r border-gray-200 relative bg-white z-10">
              {Array.from({ length: hoursCount + 1 }).map((_, i) => {
                const h = startHour + i;
                return (
                  <div key={i} className="absolute w-full text-right pr-2 text-[10px] font-medium text-gray-500" style={{ top: i * hourHeight - 6 }}>
                    {minutesToShortTime(h * 60)}
                  </div>
                );
              })}
            </div>

            {/* Grid */}
            <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {/* Hour lines */}
              <div className="absolute inset-0 pointer-events-none">
                {Array.from({ length: hoursCount + 1 }).map((_, i) => (
                  <div key={i} className="absolute w-full border-t border-gray-100" style={{ top: i * hourHeight }} />
                ))}
              </div>

              {/* Day Columns */}
              {days.map((day, di) => {
                const dayJobs = getJobsForDate(day);
                const scheduledJobs = dayJobs.filter(job => job.startTime || job.startWindowBegin);
                const timelineLayout = buildTimelineLayout(scheduledJobs)
                const activeOverlapJobId = hoveredOverlapJobId || expandedOverlapJobId
                const activeOverlapPosition = timelineLayout.positions.find(position => position.job.id === activeOverlapJobId)
                const positionedJobs: any[] = []

                return (
                  <TimelineDayColumn
                    key={di}
                    date={day}
                    onCreate={(event) => {
                      if (event.target !== event.currentTarget) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      const rawMinutes = startHour * 60 + ((event.clientY - rect.top) / hourHeight) * 60
                      const roundedMinutes = Math.max(startHour * 60, Math.min(endHour * 60 - 15, Math.round(rawMinutes / 15) * 15))
                      const hour = Math.floor(roundedMinutes / 60)
                      const minute = roundedMinutes % 60
                      handleTimeSlotClick(day, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
                    }}
                  >
                    {/* Scheduled Jobs */}
                    {timelineLayout.positions.map(positioned => {
                      const { job, start, end, column, columnCount } = positioned
                      const visibleStart = Math.max(start, startHour * 60)
                      const visibleEnd = Math.min(end, endHour * 60)
                      if (visibleEnd <= visibleStart) return null

                      const top = ((visibleStart / 60) - startHour) * hourHeight
                      const height = Math.max(22, ((visibleEnd - visibleStart) / 60) * hourHeight - 3)
                      const widthPct = 100 / columnCount
                      const leftPct = column * widthPct
                      const overlaps = columnCount > 1
                      const expanded = overlaps && activeOverlapJobId === job.id
                      const expandedWidthPct = Math.min(100 - leftPct, widthPct * (columnCount >= 3 ? 1.65 : 1.5))
                      const staysAboveExpanded = Boolean(
                        activeOverlapPosition &&
                        activeOverlapPosition.groupId === positioned.groupId &&
                        column > activeOverlapPosition.column &&
                        start > activeOverlapPosition.start
                      )
                      const performerName = getPerformerName(job)
                      const { colorKey } = getCleanerColorInfo(performerName)
                      const spineColor = JOB_SPINE_COLORS[colorKey]
                      const status = getJobStatus(job)
                      const unassigned = !performerName && status !== 'cancelled'
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id)
                      const isSelected = selectedJobIds.has(job.id)
                      const addOn = job.addOnServices?.[0]

                      return (
                        <DraggableTimelineJob
                          key={job.id}
                          job={job}
                          disabled={hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || Boolean((job as JobWithFullRelations & { vendorPaid?: boolean }).vendorPaid) || job.status === 'CANCELLED'}
                          title={`${formatTimelineRange(start, end)} ${job.location.client.name}${performerName ? ` - ${performerName}` : ''}`}
                          onMouseEnter={() => overlaps && setHoveredOverlapJobId(job.id)}
                          onMouseLeave={() => setHoveredOverlapJobId(current => current === job.id ? null : current)}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (isSelectionMode) {
                              toggleJobSelection(job.id)
                              return
                            }
                            if (overlaps && expandedOverlapJobId !== job.id) {
                              setExpandedOverlapJobId(job.id)
                              return
                            }
                            handleJobClick(job)
                          }}
                          className={`absolute cursor-pointer overflow-hidden rounded-[5px] border text-left transition-[width,box-shadow,transform] duration-150 focus:outline-none ${expanded ? 'shadow-[0_10px_26px_rgba(16,24,40,0.28)]' : 'shadow-[0_1px_2px_rgba(16,24,40,0.1)] hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(16,24,40,0.18)]'} ${isSelected ? 'ring-2 ring-[var(--cf-green)]' : ''}`}
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: `calc(${leftPct}% + 2px)`,
                            width: expanded ? `calc(${expandedWidthPct}% - 4px)` : `calc(${widthPct}% - 4px)`,
                            maxWidth: expanded ? '240px' : undefined,
                            background: status === 'cancelled' ? '#F3F4F6' : unassigned ? '#FFF6EA' : JOB_GRADIENTS[colorKey],
                            borderColor: status === 'cancelled' ? '#C7CCD4' : unassigned ? '#E3A44A' : 'rgba(255,255,255,0.88)',
                            borderStyle: status === 'cancelled' || unassigned ? 'dashed' : 'solid',
                            borderLeft: `5px solid ${status === 'cancelled' ? '#9CA3AF' : unassigned ? '#D97706' : spineColor}`,
                            boxShadow: expanded
                              ? '0 10px 26px rgba(16,24,40,0.28)'
                              : '0 2px 0 rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.10)',
                            opacity: isDimmed ? 0.22 : status === 'cancelled' ? 0.65 : 1,
                            zIndex: expanded ? 80 : staysAboveExpanded ? 90 : 10 + column,
                          }}
                        >
                          <div className="absolute inset-0 overflow-hidden px-2 py-1.5">
                            <div className={`truncate pr-3 text-[11px] font-extrabold leading-tight ${status === 'cancelled' ? 'text-[#7f8ea3] line-through' : unassigned ? 'text-[#1e293b]' : 'text-white'}`}>
                              {job.location.client.name}
                            </div>
                            {height >= 32 && (
                              <div className={`mt-0.5 truncate text-[9.5px] font-bold leading-tight ${status === 'cancelled' || unassigned ? 'text-[#526072]' : 'text-white/95'}`}>
                                {formatTimelineRange(start, end)}
                              </div>
                            )}
                            {addOn && height >= 54 && (
                              <span className="mt-1 inline-block max-w-full truncate rounded bg-[#FFF3B0] px-1.5 py-0.5 text-[8px] font-extrabold text-[#92400E]">
                                + {addOn.description}
                              </span>
                            )}
                            {isSpecialClean(job) && status !== 'cancelled' && <Star className="absolute right-1.5 top-1.5 h-2.5 w-2.5 fill-[#FCD34D] text-[#D97706]" />}
                          </div>
                        </DraggableTimelineJob>
                      )
                    })}

                    {timelineLayout.overflow.map(chip => {
                      const visibleStart = Math.max(chip.start, startHour * 60)
                      const visibleEnd = Math.min(chip.end, endHour * 60)
                      if (visibleEnd <= visibleStart) return null
                      const widthPct = 100 / chip.columnCount
                      const top = ((visibleStart / 60) - startHour) * hourHeight
                      const height = Math.max(34, ((visibleEnd - visibleStart) / 60) * hourHeight - 3)
                      return (
                        <button
                          type="button"
                          key={`overflow-${chip.groupId}`}
                          title={`Open ${format(day, 'EEEE')} to see all ${chip.jobs.length} additional jobs`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setCurrentDate(day)
                            setExpandedOverlapJobId(null)
                            setHoveredOverlapJobId(null)
                            setViewMode('day')
                          }}
                          className="absolute z-20 flex flex-col items-center justify-center overflow-hidden rounded-[5px] border border-dashed border-[#C8CFD8] bg-[#EEF1F5] text-[#475569] transition-colors hover:bg-[#E3E8EF]"
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: `calc(${chip.column * widthPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                        >
                          <span className="text-xs font-extrabold leading-none">+{chip.jobs.length}</span>
                          {height >= 44 && <span className="mt-1 text-[8px] font-extrabold uppercase tracking-[0.06em] text-[#7F8EA3]">More</span>}
                        </button>
                      )
                    })}

                    {positionedJobs.map((positioned: any) => {
                      const {
                        job,
                        start,
                        end,
                        column,
                        columnCount,
                        columnSpan = 1,
                        layoutMode,
                        stackIndex = 0,
                        overlayLeft = 4,
                        overlayWidth = 0,
                        hiddenInStack = false,
                        stackOverflowCount = 0,
                        stackOverflowJobs = [],
                      } = positioned;
                      if (hiddenInStack) return null;

                      const tStr = job.startTime || job.startWindowBegin!;
                      const naturalTop = ((start / 60) - startHour) * hourHeight;
                      const naturalHeight = ((end - start) / 60) * hourHeight;
                      const useOverlay = layoutMode === 'stack';
                      const top = naturalTop;
                      const height = naturalHeight;
                      const columnWidthPct = 100 / columnCount;
                      const widthPct = columnWidthPct * columnSpan;
                      const leftPct = column * columnWidthPct;
                      const estimatedWidth = useOverlay
                        ? (overlayWidth || Math.max(120, weekColumnWidth * 0.78))
                        : weekColumnWidth > 0
                          ? (weekColumnWidth * widthPct) / 100 - 8
                          : 160;

                      const performerName = getPerformerName(job);
                      const { hex } = getCleanerColorInfo(performerName);
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id);
                      const isSelected = selectedJobIds.has(job.id);

                      return (
                        <DraggableTimelineJob
                          key={job.id}
                          job={job}
                          disabled={hasFinalInvoice(job.invoiceLineItems) || job.subcontractorPaid || Boolean((job as JobWithFullRelations & { vendorPaid?: boolean }).vendorPaid) || job.status === 'CANCELLED'}
                          title={`${getCompactTime(tStr)} ${job.location.client.name}${performerName ? ` · ${performerName}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`}
                          onClick={(e) => { e.stopPropagation(); if (isSelectionMode) toggleJobSelection(job.id); else handleJobClick(job); }}
                          className={`absolute cursor-pointer overflow-hidden rounded-[5px] border text-left shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-[box-shadow,transform] hover:z-[90] hover:-translate-y-px hover:shadow-md focus:z-[90] focus:outline-none ${isSelected ? 'ring-2 ring-[var(--cf-green)]' : ''}`}
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: useOverlay ? `${overlayLeft}px` : `calc(${leftPct}% + 4px)`,
                            right: 'auto',
                            width: useOverlay
                              ? (overlayWidth > 0 ? `${overlayWidth}px` : '82%')
                              : `calc(${widthPct}% - 8px)`,
                            background: job.status === 'CANCELLED' ? '#F3F4F6' : `${hex}20`,
                            borderColor: job.status === 'CANCELLED' ? '#D1D5DB' : `${hex}55`,
                            borderLeft: `4px solid ${job.status === 'CANCELLED' ? '#9CA3AF' : hex}`,
                            opacity: isDimmed ? 0.3 : 1,
                            zIndex: useOverlay ? 20 + stackIndex : 10 + column,
                          }}
                        >
                          {stackOverflowCount > 0 && (
                            <button
                              type="button"
                              title={`${stackOverflowCount} more overlapping job${stackOverflowCount === 1 ? '' : 's'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDayPopoverDate(day);
                                setDayPopoverJobs([job, ...stackOverflowJobs]);
                              }}
                              className="absolute bottom-1 right-1 z-10 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-bold leading-none text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-white"
                            >
                              +{stackOverflowCount} more
                            </button>
                          )}
                          {(() => {
                            const compactTime = getCompactTime(tStr)
                            const clientName = job.location.client.name
                            const cleanerName = performerName || ''
                            const cleanerParts = cleanerName.split(' ').filter(Boolean)
                            const cleanerShort = cleanerParts.length
                              ? `${cleanerParts[0]}${cleanerParts[1] ? ` ${cleanerParts[1][0]}.` : ''}`
                              : ''
                            const rawLocationName = job.location.name || ''
                            const locationName = rawLocationName && rawLocationName !== clientName && !rawLocationName.includes(clientName)
                              ? rawLocationName
                              : ''
                            const showOneLine = height < 34 || estimatedWidth < 140
                            const showTwoLines = !showOneLine && (height < 66 || estimatedWidth < 190)
                            const trialBadge = (job as any).isTrial && (
                              <span style={{ fontSize: '7px', fontWeight: 800, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: '2px', padding: '0 2px', marginRight: '3px', verticalAlign: 'middle', letterSpacing: '0.04em' }}>TRIAL</span>
                            )

                            if (showOneLine) {
                              return (
                                <div className="absolute inset-0 overflow-hidden px-1.5 py-1">
                                  <div className="truncate text-[10px] font-bold leading-tight text-[#1e293b]">
                                    {trialBadge}{compactTime} {clientName}
                                  </div>
                                </div>
                              )
                            }

                            if (showTwoLines) {
                              return (
                                <div className="absolute inset-0 overflow-hidden px-1.5 py-1">
                                  <div className="truncate text-[10px] font-bold leading-tight text-[#1e293b]">
                                    {trialBadge}{compactTime} {clientName}
                                  </div>
                                  {cleanerShort && (
                                    <div className="truncate text-[9px] font-semibold leading-tight text-[#526072]">
                                      {cleanerShort}
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            return (
                              <div className="absolute inset-0 overflow-hidden px-1.5 py-1">
                                <div className="truncate text-[10px] font-bold leading-tight text-[#1e293b]">
                                  {trialBadge}{compactTime} {clientName}
                                </div>
                                {cleanerShort && (
                                  <div className="truncate text-[9px] font-semibold leading-tight text-[#526072]">
                                    {cleanerShort}
                                  </div>
                                )}
                                {locationName && (
                                  <div className="truncate text-[9px] leading-tight text-[#7f8ea3]">
                                    {locationName}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </DraggableTimelineJob>
                      )
                    })}
                  </TimelineDayColumn>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!mounted) return null

  return (
    <div ref={calendarWrapperRef} className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--cf-canvas)] lg:h-[calc(100vh-56px)]" style={{ height: '100%' }}>
      {renderMobileHeader()}
      {renderHeader()}
      
      {/* Filter drawer overlay */}
      <CalendarFilterDrawer
        isOpen={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        subcontractors={subcontractors}
        clients={clients}
        selectedCleanerIds={selectedCleanerIds}
        setSelectedCleanerIds={setSelectedCleanerIds}
        filterBarClientIds={filterBarClientIds}
        setFilterBarClientIds={setFilterBarClientIds}
        showUnassigned={showUnassigned}
        setShowUnassigned={setShowUnassigned}
      />
      
      {/* Mobile Calendar Content */}
      {renderMobileContent()}
      
      {/* Desktop Views - Fills remaining space after header/filters */}
      <div id="desktop-views-wrapper" className="hidden lg:flex lg:flex-col" style={{ flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
      >
        {/* Selection mode instructional banner */}
        {isSelectionMode && (
          <div
            className="flex items-center gap-3 px-4 py-2.5"
            style={{
              backgroundColor: 'rgba(15,118,110,0.06)',
              borderBottom: '1px solid rgba(15,118,110,0.12)',
            }}
          >
            <div
              style={{
                width: '6px', height: '6px', borderRadius: '50%',
                backgroundColor: '#0F766E', animation: 'pulse 2s infinite',
              }}
            />
            <p style={{ fontSize: '13px', color: '#0F766E', fontWeight: 500 }}>
              Tap jobs to select them for bulk actions. Use the bar at the bottom to mark complete, reassign, or cancel.
            </p>
            <button
              onClick={() => { setIsSelectionMode(false); clearSelection() }}
              style={{ fontSize: '12px', fontWeight: 600, color: '#0F766E', marginLeft: 'auto', whiteSpace: 'nowrap' }}
            >
              Done
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
          {(viewMode === 'week' || viewMode === 'day') && (
            <div
              key={viewMode}
              className="animate-in fade-in slide-in-from-bottom-1 duration-150"
              style={{ flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}
            >
              {renderWeekView()}
            </div>
          )}

          {viewMode === 'month' && (
            <div
              key="month-view"
              className="animate-in fade-in slide-in-from-bottom-1 duration-150"
              style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto' }}
            >
              {(() => {
                const monthStart = startOfMonth(currentDate)
                const monthEnd = endOfMonth(currentDate)
                const calStart = startOfWeek(monthStart)
                const calEnd = endOfWeek(monthEnd)
                const weeks: Date[][] = []
                let day = calStart
                while (day <= calEnd) {
                  const week: Date[] = []
                  for (let i = 0; i < 7; i++) {
                    week.push(day)
                    day = addDays(day, 1)
                  }
                  weeks.push(week)
                }
                return (
                  <div style={{ minWidth: 920, overflow: 'hidden', backgroundColor: 'white' }}>
                    {/* Day headers */}
                    <div className="grid grid-cols-7" style={{ borderBottom: '1px solid #E6E0D4', backgroundColor: '#FFFDF8' }}>
                      {WEEKDAYS.map((_, i) => (
                        <div key={i} style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: 800, color: '#8A857A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}
                        </div>
                      ))}
                    </div>
                    {/* Week rows */}
                    {weeks.map((week, wi) => (
                      <div key={wi} className="grid min-h-[124px] grid-cols-7" style={{ borderBottom: wi < weeks.length - 1 ? '1px solid #eef1f4' : 'none' }}>
                        {week.map((d, di) => {
                          const dayJobs = getJobsForDate(d)
                          const inMonth = isSameMonth(d, currentDate)
                          const today = isToday(d)
                          return (
                            <div
                              key={di}
                              onClick={() => handleDateClick(d)}
                              style={{
                                minHeight: '124px',
                                padding: '5px',
                                borderRight: di < 6 ? '1px solid #F1EADF' : 'none',
                                backgroundColor: today ? 'rgba(11,122,78,0.05)' : inMonth ? 'white' : '#FAF8F3',
                                cursor: 'pointer',
                                transition: 'background-color 80ms',
                              }}
                              onMouseEnter={e => { if (!today) e.currentTarget.style.backgroundColor = '#FBF8F1' }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = today ? 'rgba(11,122,78,0.05)' : inMonth ? 'white' : '#FAF8F3' }}
                            >
                              <div style={{
                                fontSize: '12px',
                                fontWeight: today ? 700 : 500,
                                color: today ? '#0B7A4E' : inMonth ? '#1A1A1A' : '#B0AAA0',
                                padding: '2px 4px',
                                marginBottom: '2px',
                                ...(today ? { backgroundColor: '#0B7A4E', color: 'white', borderRadius: '6px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
                              }}>
                                {format(d, 'd')}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                {dayJobs.slice(0, 5).map(j => {
                                  const status = getJobStatus(j)
                                  const performerName = getPerformerName(j)
                                  const { colorKey, hex } = getCleanerColorInfo(performerName)
                                  const spineColor = JOB_SPINE_COLORS[colorKey]
                                  const timeDisplay = getCompactTime(j.startTime || j.startWindowBegin || null);
                                  const cleanerInit = performerName ? performerName.charAt(0) : '';

                                  return (
                                    <div
                                      key={j.id}
                                      onClick={(e) => { e.stopPropagation(); if (isSelectionMode) toggleJobSelection(j.id); else handleJobClick(j); }}
                                      className={`relative h-5 cursor-pointer truncate rounded-[5px] border border-white/80 border-l-[3px] px-1.5 pr-4 text-[10px] font-bold leading-5 shadow-[0_1px_2px_rgba(15,23,42,0.10)] hover:brightness-[0.98] ${status === 'cancelled' ? 'text-[#7f8ea3] line-through' : 'text-[#1e293b]'}`}
                                      style={{
                                        background: status === 'cancelled' ? '#F3F4F6' : `${hex}20`,
                                        borderLeftColor: status === 'cancelled' ? '#9CA3AF' : spineColor,
                                        opacity: (dimmedClientIds && !dimmedClientIds.has(j.location.client.id)) ? 0.15 : (status === 'cancelled' ? 0.5 : 1),
                                        transition: 'opacity 0.2s ease',
                                      }}
                                    >
                                      {timeDisplay && `${timeDisplay} `}{j.location.client.name}{cleanerInit ? ` · ${cleanerInit}` : ''}
                                      {isSpecialClean(j) && status !== 'cancelled' && <Star className="absolute right-1 top-1 h-2.5 w-2.5 fill-[#FCD34D] text-[#D97706]" />}
                                    </div>
                                  )
                                })}
                                {dayJobs.length > 5 && (
                                  <div
                                    onClick={(e) => { e.stopPropagation(); setDayPopoverDate(d); setDayPopoverJobs(dayJobs) }}
                                    style={{ fontSize: '10px', color: '#0B7A4E', fontWeight: 700, paddingLeft: '4px', cursor: 'pointer', marginTop: '2px' }}
                                    className="hover:underline"
                                  >
                                    +{dayJobs.length - 5} more
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {viewMode === 'list' && (
            <div
              key="list-view"
              className="flex min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-1 overflow-x-auto duration-150"
            >
              {renderListView()}
            </div>
          )}

          </div>
          {specialRailOpen && renderSpecialCleansRail()}
        </div>

        {/* Day popover for "+N more" in month view */}
        {dayPopoverDate && (
          <div
            className="fixed inset-0 z-50"
            style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
            onClick={() => { setDayPopoverDate(null); setDayPopoverJobs([]) }}
          >
            <div
              ref={dayPopoverRef}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-md"
              style={{ border: '1px solid #E7E7DF', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                    {format(dayPopoverDate, 'EEEE, MMMM d')}
                  </p>
                  <p style={{ fontSize: '13px', color: '#6B7280' }}>
                    {dayPopoverJobs.length} job{dayPopoverJobs.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => { setDayPopoverDate(null); setDayPopoverJobs([]) }}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                >
                  <X style={{ width: '16px', height: '16px', color: '#6B7280' }} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 py-2">
                {dayPopoverJobs
                  .sort((a, b) => {
                    const timeA = a.startTime || a.startWindowBegin || '00:00'
                    const timeB = b.startTime || b.startWindowBegin || '00:00'
                    return timeA.localeCompare(timeB)
                  })
                  .map(job => {
                    const performerName = getPerformerName(job)
                    const { hex } = getCleanerColorInfo(performerName)
                    const status = getJobStatus(job)
                    const timeDisplay = job.startTime
                      ? formatTime(job.startTime)
                      : job.startWindowBegin
                        ? formatTime(job.startWindowBegin)
                        : null
                    return (
                      <button
                        key={job.id}
                        onClick={() => { setDayPopoverDate(null); setDayPopoverJobs([]); handleJobClick(job) }}
                        className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                      >
                        <div
                          className="flex-shrink-0 rounded-full"
                          style={{ width: '8px', height: '8px', backgroundColor: performerName ? hex : '#D1D5DB' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p style={{ fontSize: '14px', fontWeight: 600, color: job.status === 'CANCELLED' ? '#7f8ea3' : '#111827' }} className={`truncate ${job.status === 'CANCELLED' ? 'line-through' : ''}`}>
                            {job.location.client.name}
                          </p>
                          <p style={{ fontSize: '12px', color: '#6B7280' }} className="truncate">
                            {job.location.name}
                            {timeDisplay ? ` · ${timeDisplay}` : ''}
                            {performerName ? ` · ${performerName}` : ' · Unassigned'}
                          </p>
                        </div>
                        <span
                          className="flex-shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: status === 'completed' ? 'rgba(16,185,129,0.1)' : status === 'cancelled' ? 'rgba(156,163,175,0.1)' : 'rgba(59,130,246,0.1)',
                            color: status === 'completed' ? '#059669' : status === 'cancelled' ? '#6B7280' : '#3B82F6',
                          }}
                        >
                          {status}
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {draggedJob && (() => {
            const { colorKey } = getCleanerColorInfo(getPerformerName(draggedJob))
            const gradient = JOB_GRADIENTS[colorKey] || JOB_GRADIENTS.default
            const durationHours = 2
            let timeRangeText: string | null = null
            if (dragTarget.time) {
              const [h, m] = dragTarget.time.split(':').map(Number)
              const startMins = h * 60 + m
              const endMins = startMins + durationHours * 60
              const fmtTime = (mins: number) => {
                const hr = Math.floor(mins / 60) % 24
                const mn = mins % 60
                const period = hr >= 12 ? 'PM' : 'AM'
                const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
                return mn === 0 ? `${hr12} ${period}` : `${hr12}:${mn.toString().padStart(2, '0')} ${period}`
              }
              timeRangeText = `${fmtTime(startMins)} – ${fmtTime(endMins)}`
            } else {
              const orig = draggedJob.startTime || draggedJob.startWindowBegin
              if (orig) timeRangeText = formatTime(orig)
            }
            return (
              <div
                className="rounded-lg border border-white/20 text-white pointer-events-none"
                style={{
                  background: gradient,
                  width: '140px',
                  padding: '6px 8px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                }}
              >
                <div className="text-[10px] font-bold truncate leading-tight">
                  {draggedJob.location.client.name}
                </div>
                {timeRangeText && (
                  <div className="text-[8px] opacity-90 mt-0.5 leading-tight truncate">
                    {timeRangeText}
                  </div>
                )}
                <div className="text-[8px] opacity-80 truncate leading-tight mt-0.5">
                  {draggedJob.location.name}
                </div>
              </div>
            )
          })()}
        </DragOverlay>
      </DndContext>
      </div>{/* End Desktop Views */}

      {/* Mobile FAB - Google Calendar style */}
      <button
        onClick={() => handleDateClick(currentDate)}
        className="lg:hidden fixed z-50 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        style={{
          width: '52px',
          height: '52px',
          bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
          right: '16px',
          backgroundColor: '#00A896',
          boxShadow: '0 2px 8px rgba(0,168,150,0.4)',
        }}
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* Desktop "+" button moved to header toolbar */}

      {/* Job Detail Dialog */}
      <JobDetailDialog
        job={selectedJob}
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        subcontractors={subcontractors}
      />

      {/* Create Job Dialog */}
      <CompactCreateJobDialog
        open={createJobDialogOpen}
        onOpenChange={(open) => {
          setCreateJobDialogOpen(open)
          if (!open) {
            setSelectedTimeForNewJob(undefined)
          }
        }}
        selectedDate={selectedDateForNewJob}
        selectedTime={selectedTimeForNewJob}
        clients={clients as unknown as React.ComponentProps<typeof CompactCreateJobDialog>['clients']}
        subcontractors={subcontractors}
      />

      {/* Quick Assign Modal */}
      <QuickAssignModal
        isOpen={quickAssignOpen}
        onClose={() => setQuickAssignOpen(false)}
        unassignedJobs={stats.unassignedJobs as unknown as React.ComponentProps<typeof QuickAssignModal>['unassignedJobs']}
        subcontractors={subcontractors}
      />

      {/* Bulk Actions */}
      {selectedJobIds.size > 0 && (
        <BulkJobActions
          selectedJobIds={selectedJobIds}
          onClearSelection={clearSelection}
          onJobsUpdated={handleJobsUpdated}
          subcontractors={subcontractors.filter(s => (s as any).isActive !== false).map(s => ({ id: s.id, name: s.name }))}
        />
      )}

    </div>
  )
}
