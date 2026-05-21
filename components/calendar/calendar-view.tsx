"use client"

import { Fragment, useState, useMemo, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { 
  ChevronLeft, ChevronRight,
  AlertCircle, Plus, ChevronDown, X, Loader2,
  Search, MoreHorizontal, SlidersHorizontal
} from "lucide-react"
import { 
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, 
  subMonths, format, isSameMonth, isSameDay, addWeeks, subWeeks,
  isToday, isBefore, startOfToday
} from "date-fns"
import { formatTime } from "@/lib/utils"
import { JobDetailDialog } from "./job-detail-dialog"
import { CreateJobDialog } from "./create-job-dialog"
import { QuickAssignModal } from "./quick-assign-modal"
import { BulkJobActions } from "./bulk-job-actions"


import { JobWithFullRelations, ClientWithLocations, Subcontractor } from "@/types"
import { refreshCalendarData } from "./calendar-client"
import { DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from '@dnd-kit/core'
import { getCleanerColorInfo, JOB_GRADIENTS, CLEANER_HEX_COLORS } from '@/lib/calendar-design-tokens'
import { useCalendarFilters } from '@/lib/calendar-filter-context'
import { CalendarFilterDrawer } from './calendar-filter-drawer'
import { hasFinalInvoice } from '@/lib/invoice-status'

interface CalendarViewProps {
  jobs: JobWithFullRelations[]
  clients: ClientWithLocations[]
  subcontractors: Subcontractor[]
}

type ViewMode = 'week' | 'month'
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

export function CalendarView({ jobs: initialJobs, clients, subcontractors }: CalendarViewProps) {
  const searchParams = useSearchParams()
  const [currentDate, setCurrentDate] = useState(new Date())
  const calendarWrapperRef = useRef<HTMLDivElement>(null)
  const [weekColumnWidth, setWeekColumnWidth] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [mobileView, setMobileView] = useState<MobileViewMode>('3day')
  const [weekDensity, setWeekDensity] = useState<WeekDensity>('Compact')
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
  const [loadedRanges, setLoadedRanges] = useState<Set<string>>(() => {
    const ranges = new Set<string>()
    const now = new Date()
    ranges.add(`${now.getFullYear()}-${now.getMonth()}`)
    return ranges
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  
  // Use allJobs instead of initialJobs throughout the component
  const jobs = allJobs
  
  const calFilters = useCalendarFilters()
  const noop = useMemo(() => (() => {}) as (...args: unknown[]) => void, [])
  const defaultCleanerIds = useMemo(() => new Set(subcontractors.map(s => s.id)), [subcontractors])
  const selectedCleanerIds = calFilters?.selectedCleanerIds ?? defaultCleanerIds
  const setSelectedCleanerIds = calFilters?.setSelectedCleanerIds ?? noop
  const filterBarClientIds = calFilters?.filterBarClientIds ?? new Set<string>()
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

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (selectedClientId && job.location.client.id !== selectedClientId) return false
      if (selectedSubcontractorId && job.subcontractor?.id !== selectedSubcontractorId) return false
      
      if (job.subcontractor) {
        if (!selectedCleanerIds.has(job.subcontractor.id)) return false
      } else {
        if (!showUnassigned) return false
      }
      
      if (filterBarClientIds.size > 0 && !filterBarClientIds.has(job.location.client.id)) return false
      
      return true
    })
  }, [jobs, selectedClientId, selectedSubcontractorId, selectedCleanerIds, filterBarClientIds, showUnassigned])

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
    const unassigned = filteredJobs.filter(j => !j.subcontractor && getDateString(j.date) >= todayStr)
    
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
    const start = startOfWeek(currentDate)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }

  // Mobile Header - Google Calendar style (light, clean)
  const renderMobileHeader = () => {
    const isAllActive = selectedCleanerIds.size === subcontractors.length && showUnassigned

    return (
    <div className="lg:hidden relative" style={{ background: 'linear-gradient(180deg, #F6F6F1 0%, #FFFFFF 78%)' }}>
      <div className="px-3 pt-3 pb-2">
        <div
          className="rounded-[18px] px-3 py-3"
          style={{
            border: '1px solid #E7E7DF',
            backgroundColor: 'rgba(255,255,255,0.92)',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7C7C72', marginBottom: '6px' }}>
                Schedule
              </p>
              <button
                onClick={() => {
                  setMonthPickerYear(currentDate.getFullYear())
                  setShowMonthPicker(!showMonthPicker)
                }}
                className="flex items-center gap-1"
              >
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>
                  {monthLabel}
                </span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${showMonthPicker ? 'rotate-180' : ''}`}
                  style={{ color: '#5F6368' }}
                />
              </button>
              <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '6px' }}>
                {calendarSummaryLabel}
                {activeFilterCount > 0 ? ` | ${activeFilterCount} filters on` : ' | All filters open'}
              </p>
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

          <div className="grid grid-cols-2 gap-2 mt-3">
            {(['3day', 'week'] as MobileViewMode[]).map((view) => (
              <button
                key={view}
                onClick={() => changeMobileView(view)}
                style={{
                  minHeight: '40px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                  backgroundColor: mobileView === view ? '#0F766E' : '#F8FAF9',
                  color: mobileView === view ? 'white' : '#4B5563',
                  border: mobileView === view ? '1px solid #0F766E' : '1px solid #E5E7EB',
                }}
              >
                {view === '3day' ? '3 Day View' : 'Week View'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div
          className="overflow-x-auto rounded-[16px]"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            border: '1px solid #ECEDE7',
            backgroundColor: 'rgba(255,255,255,0.94)',
            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.04)',
          }}
        >
        <div
          className="flex items-center"
          style={{ paddingLeft: '12px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px', gap: '8px', width: 'max-content' }}
        >
          {/* All pill */}
          <button
            onClick={() => {
              setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
              setShowUnassigned(true)
            }}
            style={{
              height: '30px',
              padding: '0 12px',
              borderRadius: '15px',
              fontSize: '13px',
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
                  height: '30px',
                  padding: '0 12px',
                  borderRadius: '15px',
                  fontSize: '13px',
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
              height: '30px',
              padding: '0 12px',
              borderRadius: '15px',
              fontSize: '13px',
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
                className="flex-1 py-2 flex flex-col items-center"
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: isTodayDate ? '#00A896' : '#5F6368',
                    marginBottom: '4px',
                  }}
                >
                  {WEEKDAYS[idx]}
                </span>
                {/* 32px diameter circle */}
                <span
                  className={`rounded-full flex items-center justify-center transition-all font-bold ${
                    isSelected && isTodayDate ? 'bg-teal-600 text-white' :
                    isSelected ? 'bg-gray-900 text-white' :
                    isTodayDate ? 'bg-teal-600 text-white' :
                    'text-gray-900'
                  }`}
                  style={{ width: '32px', height: '32px', fontSize: '15px', fontWeight: 700 }}
                >
                  {format(day, 'd')}
                </span>
                {/* Job dots: max 3 + "+N" overflow, reflect filter state */}
                {dayJobs.length > 0 && !isSelected && (
                  <div className="flex items-center mt-1" style={{ gap: '2px' }}>
                    {dayJobs.slice(0, 3).map((job, i) => {
                      const { hex } = getCleanerColorInfo(job.subcontractor?.name || null)
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
                        const { hex } = getCleanerColorInfo(job.subcontractor?.name || null)
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

    return (
      <div
        className="lg:hidden flex flex-col flex-1 min-h-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {renderWeekView()}
      </div>
    )
  }

  const isAllCleanersSelected = selectedCleanerIds.size === subcontractors.length && showUnassigned
  const visibleClientCount = useMemo(() => new Set(filteredJobs.map(job => job.location.client.id)).size, [filteredJobs])
  const activeFilterCount =
    (isAllCleanersSelected ? 0 : 1) +
    (filterBarClientIds.size > 0 ? 1 : 0) +
    (clientSearchQuery.trim() ? 1 : 0)
  const monthLabel = format(currentDate, 'MMMM yyyy')
  const calendarSummaryLabel = `${filteredJobs.length} jobs | ${visibleClientCount} clients`

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
    const filterCount = (isAllCleanersSelected ? 0 : 1) + (isAllClientsSelected ? 0 : 1)
    
    // Build active filter summary text
    let activeSummaryParts: string[] = []
    if (!isAllCleanersSelected) {
      const names = Array.from(selectedCleanerIds).map(id => subcontractors.find(s => s.id === id)?.name.split(' ')[0]).filter(Boolean)
      if (showUnassigned) names.push("Unassigned")
      if (names.length > 0) activeSummaryParts.push(names.join(", "))
    }
    if (!isAllClientsSelected) {
      const names = Array.from(filterBarClientIds).map(id => clients.find(c => c.id === id)?.name).filter(Boolean)
      if (names.length > 0) activeSummaryParts.push(names.join(", "))
    }
    const activeSummaryText = activeSummaryParts.join(" · ")

    return (
      <div className="hidden lg:flex flex-col shrink-0 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold leading-none mb-1">Operations Calendar</p>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 leading-none">{monthLabel}</h1>
                <span className="text-[11px] font-medium text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full">
                  {calendarSummaryLabel}
                </span>
              </div>
            </div>
            
            <div className="h-6 w-px bg-gray-200 mx-1" />
            
            <div className="flex items-center gap-1">
              <button
                onClick={goToToday}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Today
              </button>
              <button onClick={() => navigate('prev')} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={() => navigate('next')} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin text-teal-600" />}
          </div>

          <div className="flex items-center gap-3">
            {/* Week/Month toggle */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200">
              {(['week', 'month'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    viewMode === mode 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                  }`}
                >
                  {mode === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
            
            <button
              onClick={() => handleDateClick(currentDate)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors shadow-sm text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Job
            </button>

            <button
              onClick={() => setFilterDrawerOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                filterCount > 0 
                  ? 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100' 
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {filterCount > 0 && (
                <span className="flex items-center justify-center min-w-[20px] h-5 px-1 ml-0.5 bg-teal-600 text-white text-[10px] rounded-full">
                  {filterCount}
                </span>
              )}
            </button>
            
            {/* Overflow */}
            <div className="relative" ref={overflowMenuRef}>
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              >
                <MoreHorizontal className="w-5 h-5" />
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
            </div>
          </div>
        </div>

        {/* Active Filter Summary Row */}
        {filterCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs">
            <div className="flex items-center gap-2 overflow-hidden text-gray-600">
              <span className="font-semibold text-gray-700 shrink-0">Filters:</span>
              <span className="truncate">{activeSummaryText}</span>
            </div>
            <button
              onClick={() => {
                setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
                setShowUnassigned(true)
                setFilterBarClientIds(new Set())
              }}
              className="text-teal-600 hover:text-teal-700 font-medium shrink-0 ml-4"
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
      const { hex } = getCleanerColorInfo(job.subcontractor?.name || null)
      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id)
      const isSelected = selectedJobIds.has(job.id)
      const timeRange = getJobTimeRange(job)
      const cleanerShort = getCleanerShort(job.subcontractor?.name)
      const locationName = getCompactLocationName(job)
      const title = `${timeRange} ${job.location.client.name}${job.subcontractor?.name ? ` · ${job.subcontractor.name}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`

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
            "group block w-full cursor-pointer overflow-hidden rounded-[5px] text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-teal-500",
            isSelected ? "ring-2 ring-teal-500" : "",
          ].join(" ")}
          style={{
            border: `1px solid ${hex}33`,
            borderLeft: `4px solid ${hex}`,
            backgroundColor: `${hex}1A`,
            opacity: isDimmed ? 0.3 : 1,
            padding: isDenseCard ? densityConfig.cardPadding : '7px 9px',
            minHeight: isDenseCard ? `${densityConfig.cardMinHeight}px` : '58px',
          }}
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-mono text-[10px] font-semibold text-gray-500">
              {timeRange}
            </span>
            <span className="min-w-0 truncate text-[13px] font-bold leading-tight text-gray-950">
              {job.location.client.name}
            </span>
          </div>
          <div className={`${weekDensity === 'Dense' ? 'hidden' : 'mt-0.5'} truncate text-[11px] font-medium leading-tight text-gray-600`}>
            {cleanerShort}
          </div>
          {!isDenseCard && locationName && (
            <div className="mt-0.5 truncate text-[11px] leading-tight text-gray-500">
              {locationName}
            </div>
          )}
        </button>
      )
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#F8F7F4]">
        <div className="flex shrink-0 border-b-2 border-gray-900 bg-white">
          <div className="w-12 shrink-0 border-r border-gray-200" />
          <div className="grid flex-1 grid-cols-7">
            {days.map(day => {
              const isTodayDate = isToday(day)
              return (
                <div key={day.toString()} className={`border-r border-gray-200 py-2 text-center last:border-r-0 ${isTodayDate ? 'bg-gray-950' : ''}`}>
                  <div className={`text-[10px] font-bold uppercase tracking-[0.08em] ${isTodayDate ? 'text-white/55' : 'text-gray-400'}`}>
                    {format(day, 'EEE')}
                  </div>
                  <div className={`mt-0.5 text-lg font-bold ${isTodayDate ? 'text-white' : 'text-gray-950'}`}>
                    {format(day, 'd')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {hasUnscheduledJobs && (
          <div className="flex shrink-0 border-b border-gray-200 bg-white">
            <div className="w-12 shrink-0 border-r border-gray-200 px-2 py-2 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">
              TBD
            </div>
            <div className="grid flex-1 grid-cols-7">
              {days.map((day, dayIndex) => (
                <div key={day.toString()} className="min-h-[34px] border-r border-gray-100 p-1.5 last:border-r-0">
                  <div className="flex flex-col gap-1">
                    {unscheduledJobsByDay[dayIndex].map(job => {
                      const { hex } = getCleanerColorInfo(job.subcontractor?.name || null)
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
                          className={`h-7 cursor-pointer truncate rounded-md bg-white px-2 py-1.5 text-left text-[11px] font-bold leading-none text-gray-900 shadow-sm ring-1 ring-gray-200 ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
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

        <div className="flex-1 overflow-auto bg-[#F8F7F4]">
          <table className="w-full table-fixed border-collapse bg-white">
            <tbody>
              {visibleTimeSlots.map((hour, rowIndex) => {
                const nextHour = visibleTimeSlots[rowIndex + 1]
                const hasLargeGap = nextHour ? nextHour - hour >= 3 : false

                return (
                  <Fragment key={`slot-${hour}`}>
                    <tr className="align-top">
                      <td className="w-12 border-b border-gray-200 pr-2 pt-3 text-right align-top">
                        <span className="font-mono text-[10px] font-bold text-gray-400">
                          {getHourLabel(hour)}
                        </span>
                      </td>
                      {days.map((day, dayIndex) => {
                        const jobsForHour = getJobsForHour(dayIndex, hour)
                        return (
                          <td
                            key={`${day.toISOString()}-${hour}`}
                            className="min-h-[62px] border-b border-l border-gray-200 p-1.5 align-top last:border-r"
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
                        <td colSpan={8} className="h-3 border-b border-gray-100 bg-[#F8F7F4]">
                          <div className="mx-auto h-px w-12 border-t border-dashed border-gray-300 opacity-60" />
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

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate)
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    return renderCompactWeekTable(days)
    
    let minHour = 5;
    let maxHour = 23; // 11 PM

    days.forEach(day => {
      getJobsForDate(day).forEach(job => {
        const t = job.startTime || job.startWindowBegin;
        if (t) {
          const [h] = t.split(':').map(Number);
          if (!isNaN(h) && h < minHour) minHour = h;
          
          const e = job.startWindowBegin ? job.startWindowEnd : null;
          if (e) {
            const [eh] = e.split(':').map(Number);
            if (!isNaN(eh) && eh + 1 > maxHour) maxHour = Math.min(24, eh + 1);
          } else {
            if (!isNaN(h) && h + 2 > maxHour) maxHour = Math.min(24, h + 2);
          }
        }
      });
    });

    const startHour = minHour;
    const endHour = maxHour;
    const hoursCount = endHour - startHour; // 18
    const hourHeight = weekDensity === 'Comfortable' ? 72 : weekDensity === 'Compact' ? 56 : 44; // px
    
    const getTopOffset = (timeStr: string | null) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return 0;
      return (h - startHour) * hourHeight + (m / 60) * hourHeight;
    };

    const getMinutes = (timeStr: string | null | undefined) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return 0;
      return h * 60 + m;
    };

    const getJobInterval = (job: any) => {
      const startRaw = job.startTime || job.startWindowBegin;
      if (!startRaw) return null;

      const start = getMinutes(startRaw);
      const explicitWindowEnd = job.startWindowBegin ? job.startWindowEnd : null;
      let end = explicitWindowEnd ? getMinutes(explicitWindowEnd) : start + 60;

      if (end <= start) end = start + 60;
      return { job, start, end: Math.max(end, start + 15) };
    };

    const eventsOverlap = (
      a: { start: number; end: number },
      b: { start: number; end: number }
    ) => a.start < b.end && b.start < a.end;

    const getPositionedJobs = (jobs: any[]) => {
      const minReadableWidth = 120;
      const stackWidthRatio = 0.84;
      const stackOffset = 14;
      const maxVisibleStackCards = 8;
      const timedJobs = jobs
        .map(getJobInterval)
        .filter((item): item is NonNullable<ReturnType<typeof getJobInterval>> => item !== null)
        .sort((a, b) => a.start - b.start || a.end - b.end);

      const clusters: typeof timedJobs[] = [];
      let activeCluster: typeof timedJobs | null = null;
      let activeClusterEnd = -1;

      timedJobs.forEach(item => {
        if (!activeCluster || item.start >= activeClusterEnd) {
          activeCluster = [item];
          clusters.push(activeCluster);
          activeClusterEnd = item.end;
          return;
        }

        activeCluster.push(item);
        activeClusterEnd = Math.max(activeClusterEnd, item.end);
      });

      return clusters.flatMap((cluster, clusterIndex) => {
        const laneEnds: number[] = [];
        const assigned = cluster.map(item => {
          let lane = laneEnds.findIndex(end => end <= item.start);
          if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(item.end);
          } else {
            laneEnds[lane] = item.end;
          }

          return { ...item, column: lane };
        });

        const laneCount = Math.max(laneEnds.length, 1);
        const splitWidth = weekColumnWidth > 0 ? weekColumnWidth / laneCount : Number.POSITIVE_INFINITY;
        const useStack = cluster.length >= 3 || splitWidth < minReadableWidth;
        const byColumn = Array.from({ length: laneCount }, (_, column) =>
          assigned.filter(item => item.column === column)
        );

        return assigned.map((item, groupIndex) => {
          let span = 1;
          for (let nextColumn = item.column + 1; !useStack && nextColumn < laneCount; nextColumn++) {
            const blocked = byColumn[nextColumn].some(other => eventsOverlap(item, other));
            if (blocked) break;
            span++;
          }

          const stackIndex = useStack ? groupIndex : 0;
          const overlayDepth = Math.min(stackIndex, maxVisibleStackCards - 1);
          const overlayLeft = 4 + overlayDepth * stackOffset;
          const targetOverlayWidth = Math.min(Math.max(minReadableWidth, weekColumnWidth * stackWidthRatio), Math.max(minReadableWidth, weekColumnWidth - 12));
          const overlayWidth = weekColumnWidth > 0
            ? targetOverlayWidth
            : 0;

          return {
            ...item,
            groupIndex,
            groupSize: cluster.length,
            hiddenInStack: useStack && groupIndex >= maxVisibleStackCards,
            stackOverflowCount: useStack && groupIndex === maxVisibleStackCards - 1
              ? Math.max(0, cluster.length - maxVisibleStackCards)
              : 0,
            stackOverflowJobs: useStack && groupIndex === maxVisibleStackCards - 1
              ? cluster.slice(maxVisibleStackCards).map(({ job }) => job)
              : [],
            columnCount: laneCount,
            columnSpan: useStack ? 1 : span,
            clusterIndex,
            layoutMode: useStack ? 'stack' : 'lanes',
            stackIndex,
            overlayLeft,
            overlayWidth,
          };
        });
      });
    };

    const unscheduledJobsByDay = days.map(day =>
      getJobsForDate(day).filter(job => !(job.startTime || job.startWindowBegin))
    );
    const hasUnscheduledJobs = unscheduledJobsByDay.some(dayJobs => dayJobs.length > 0);

    return (
      <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
        {/* Header Row */}
        <div className="flex border-b border-gray-200 shrink-0">
          <div className="w-14 shrink-0 border-r border-gray-200" />
          <div className="flex-1 grid grid-cols-7">
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
            <div className="flex-1 grid grid-cols-7">
              {days.map((day, di) => (
                <div key={day.toString()} className="min-h-[34px] border-r border-gray-100 last:border-r-0 p-1">
                  <div className="flex flex-col gap-1">
                    {unscheduledJobsByDay[di].map(job => {
                      const { hex } = getCleanerColorInfo(job.subcontractor?.name || null);
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id);
                      const isSelected = selectedJobIds.has(job.id);
                      const cleanerName = job.subcontractor?.name || '';
                      const tooltipText = `TBD ${job.location.client.name}${cleanerName ? ` · ${cleanerName}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`;

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
              {Array.from({ length: hoursCount }).map((_, i) => {
                const h = startHour + i;
                const isPM = h >= 12;
                const displayH = h % 12 || 12;
                return (
                  <div key={i} className="absolute w-full text-right pr-2 text-[10px] font-medium text-gray-500" style={{ top: i * hourHeight - 6 }}>
                    {displayH} {isPM ? 'PM' : 'AM'}
                  </div>
                );
              })}
            </div>

            {/* Grid */}
            <div className="flex-1 grid grid-cols-7 relative">
              {/* Hour lines */}
              <div className="absolute inset-0 pointer-events-none">
                {Array.from({ length: hoursCount }).map((_, i) => (
                  <div key={i} className="absolute w-full border-t border-gray-100" style={{ top: i * hourHeight }} />
                ))}
              </div>

              {/* Day Columns */}
              {days.map((day, di) => {
                const dayJobs = getJobsForDate(day);
                const scheduledJobs = dayJobs.filter(job => job.startTime || job.startWindowBegin);
                const positionedJobs = getPositionedJobs(scheduledJobs);

                return (
                  <div key={di} className="relative overflow-visible border-r border-gray-100 last:border-r-0">
                    {/* Scheduled Jobs */}
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

                      const { colorKey } = getCleanerColorInfo(job.subcontractor?.name || null);
                      const gradient = JOB_GRADIENTS[colorKey] || JOB_GRADIENTS.default;
                      const isDimmed = dimmedClientIds && !dimmedClientIds.has(job.location.client.id);
                      const isSelected = selectedJobIds.has(job.id);

                      return (
                        <div
                          key={job.id}
                          title={`${getCompactTime(tStr)} ${job.location.client.name}${job.subcontractor?.name ? ` · ${job.subcontractor.name}` : ''}${job.location.name ? ` · ${job.location.name}` : ''}`}
                          onClick={(e) => { e.stopPropagation(); if (isSelectionMode) toggleJobSelection(job.id); else handleJobClick(job); }}
                          className={`absolute rounded-md overflow-hidden cursor-pointer shadow-sm border border-white/60 hover:shadow-md focus:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
                          tabIndex={0}
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: useOverlay ? `${overlayLeft}px` : `calc(${leftPct}% + 4px)`,
                            right: 'auto',
                            width: useOverlay
                              ? (overlayWidth > 0 ? `${overlayWidth}px` : '82%')
                              : `calc(${widthPct}% - 8px)`,
                            background: gradient,
                            opacity: isDimmed ? 0.3 : 1,
                            zIndex: useOverlay ? 20 + stackIndex : 10 + column,
                          }}
                          onMouseEnter={(e) => {
                            if (useOverlay) e.currentTarget.style.zIndex = '80';
                          }}
                          onMouseLeave={(e) => {
                            if (useOverlay) e.currentTarget.style.zIndex = String(20 + stackIndex);
                          }}
                          onFocus={(e) => {
                            if (useOverlay) e.currentTarget.style.zIndex = '80';
                          }}
                          onBlur={(e) => {
                            if (useOverlay) e.currentTarget.style.zIndex = String(20 + stackIndex);
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
                            const cleanerName = job.subcontractor?.name || ''
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
                                  <div className="truncate text-[11px] font-semibold leading-tight text-white">
                                    {trialBadge}{compactTime} {clientName}
                                  </div>
                                </div>
                              )
                            }

                            if (showTwoLines) {
                              return (
                                <div className="absolute inset-0 overflow-hidden px-1.5 py-1">
                                  <div className="truncate text-[11px] font-semibold leading-tight text-white">
                                    {trialBadge}{compactTime} {clientName}
                                  </div>
                                  {cleanerShort && (
                                    <div className="truncate text-[10px] leading-tight text-white/85">
                                      {cleanerShort}
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            return (
                              <div className="absolute inset-0 overflow-hidden px-1.5 py-1">
                                <div className="truncate text-[11px] font-semibold leading-tight text-white">
                                  {trialBadge}{compactTime} {clientName}
                                </div>
                                {cleanerShort && (
                                  <div className="truncate text-[10px] leading-tight text-white/85">
                                    {cleanerShort}
                                  </div>
                                )}
                                {locationName && (
                                  <div className="truncate text-[10px] leading-tight text-white/75">
                                    {locationName}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
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
    <div ref={calendarWrapperRef} className="flex flex-col relative h-full min-h-0 overflow-hidden lg:h-[calc(100vh-56px)]" style={{ height: '100%' }}>
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
        <div>
          {viewMode === 'week' && (
            <div
              className="animate-in"
              style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}
            >
              {renderWeekView()}
            </div>
          )}

          {viewMode === 'month' && (
            <div
              className="animate-in"
              style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto', padding: '0 12px 12px' }}
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
                  <div style={{ border: '1px solid #E7E7DF', borderRadius: '14px', overflow: 'hidden', backgroundColor: 'white' }}>
                    {/* Day headers */}
                    <div className="grid grid-cols-7" style={{ borderBottom: '1px solid #E7E7DF' }}>
                      {WEEKDAYS.map((wd, i) => (
                        <div key={i} style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: '#7C7C72', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}
                        </div>
                      ))}
                    </div>
                    {/* Week rows */}
                    {weeks.map((week, wi) => (
                      <div key={wi} className="grid grid-cols-7" style={{ borderBottom: wi < weeks.length - 1 ? '1px solid #F0F0EC' : 'none' }}>
                        {week.map((d, di) => {
                          const dayJobs = getJobsForDate(d)
                          const inMonth = isSameMonth(d, currentDate)
                          const today = isToday(d)
                          return (
                            <div
                              key={di}
                              onClick={() => handleDateClick(d)}
                              style={{
                                minHeight: '88px',
                                padding: '4px',
                                borderRight: di < 6 ? '1px solid #F0F0EC' : 'none',
                                backgroundColor: today ? 'rgba(15,118,110,0.03)' : inMonth ? 'white' : '#FAFAF8',
                                cursor: 'pointer',
                                transition: 'background-color 80ms',
                              }}
                              onMouseEnter={e => { if (!today) e.currentTarget.style.backgroundColor = '#F5F5F3' }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = today ? 'rgba(15,118,110,0.03)' : inMonth ? 'white' : '#FAFAF8' }}
                            >
                              <div style={{
                                fontSize: '12px',
                                fontWeight: today ? 700 : 500,
                                color: today ? '#0F766E' : inMonth ? '#111827' : '#B0B0A8',
                                padding: '2px 4px',
                                marginBottom: '2px',
                                ...(today ? { backgroundColor: '#0F766E', color: 'white', borderRadius: '6px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
                              }}>
                                {format(d, 'd')}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                {dayJobs.slice(0, 5).map(j => {
                                  const status = getJobStatus(j)
                                  const { colorKey } = getCleanerColorInfo(j.subcontractor?.name || null)
                                  const gradient = JOB_GRADIENTS[colorKey] || JOB_GRADIENTS.default
                                  const timeDisplay = getCompactTime(j.startTime || j.startWindowBegin || null);
                                  const cleanerInit = j.subcontractor ? j.subcontractor.name.charAt(0) : '';

                                  return (
                                    <div
                                      key={j.id}
                                      onClick={(e) => { e.stopPropagation(); if (isSelectionMode) toggleJobSelection(j.id); else handleJobClick(j); }}
                                      className="px-1.5 h-5 rounded-sm text-[11px] font-semibold leading-5 text-white truncate cursor-pointer hover:opacity-90"
                                      style={{
                                        background: status === 'cancelled' ? '#9CA3AF' : gradient,
                                        opacity: (dimmedClientIds && !dimmedClientIds.has(j.location.client.id)) ? 0.15 : (status === 'cancelled' ? 0.5 : 1),
                                        transition: 'opacity 0.2s ease',
                                      }}
                                    >
                                      {(j as any).isTrial && <span style={{ fontSize: '8px', fontWeight: 800, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: '2px', padding: '0 3px', marginRight: '3px', verticalAlign: 'middle', letterSpacing: '0.04em' }}>TRIAL</span>}{timeDisplay && `${timeDisplay} `}{j.location.client.name}{cleanerInit ? ` · ${cleanerInit}` : ''}
                                    </div>
                                  )
                                })}
                                {dayJobs.length > 5 && (
                                  <div
                                    onClick={(e) => { e.stopPropagation(); setDayPopoverDate(d); setDayPopoverJobs(dayJobs) }}
                                    style={{ fontSize: '10px', color: '#0F766E', fontWeight: 600, paddingLeft: '4px', cursor: 'pointer', marginTop: '2px' }}
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
                    const { hex } = getCleanerColorInfo(job.subcontractor?.name || null)
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
                          style={{ width: '8px', height: '8px', backgroundColor: job.subcontractor ? hex : '#D1D5DB' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }} className="truncate">
                            {job.location.client.name}
                          </p>
                          <p style={{ fontSize: '12px', color: '#6B7280' }} className="truncate">
                            {job.location.name}
                            {timeDisplay ? ` · ${timeDisplay}` : ''}
                            {job.subcontractor ? ` · ${job.subcontractor.name}` : ' · Unassigned'}
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
            const { colorKey } = getCleanerColorInfo(draggedJob.subcontractor?.name || null)
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
      <CreateJobDialog
        open={createJobDialogOpen}
        onOpenChange={(open) => {
          setCreateJobDialogOpen(open)
          if (!open) {
            setSelectedTimeForNewJob(undefined)
          }
        }}
        selectedDate={selectedDateForNewJob}
        selectedTime={selectedTimeForNewJob}
        clients={clients as unknown as React.ComponentProps<typeof CreateJobDialog>['clients']}
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
