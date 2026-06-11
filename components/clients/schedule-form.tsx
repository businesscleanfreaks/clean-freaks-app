"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TimePicker } from "@/components/ui/time-picker"
import { SimpleTooltip } from "@/components/ui/simple-tooltip"
import { InlineHelp } from "@/components/ui/inline-help"
import { logger } from "@/lib/logger"
import { showError, showSuccess, showApiError } from "@/lib/toast"
import { createScheduleSchema, updateScheduleSchema } from "@/lib/validations"
import { dateInputValue as formatDateForInput } from "@/lib/date-only"
import { ScheduleDiffPreview, type ScheduleDiff } from "./cockpit/schedule-diff-preview"

// Plain-language date for the "when does this change start" messaging.
function formatReadableDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso + "T12:00:00")
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

export interface ScheduleRecord {
  id: string
  frequency: string
  daysOfWeek?: string | null
  preferredTime?: string | null
  monthlyPattern?: string | null
  startDate?: string | Date | null
  endDate?: string | Date | null
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
  timeType?: string | null
  defaultClientRate?: number | null
  defaultSubcontractorRate?: number | null
  clientPayType?: string | null
  subcontractorPayType?: string | null
  subcontractorId?: string | null
  isActive?: boolean
  rate?: number | null
  cleanerRate?: number | null
  addOnServices?: Array<{ id: string; name: string; price: number; cleanerPayout?: number | null }>
  recurringAddOnServices?: Array<{
    id: string
    description: string
    clientRate: number
    subcontractorRate: number
    frequency?: string | null
  }>
}

type ScheduleFormMode = 'create' | 'edit' | 'future'

interface ScheduleFormProps {
  locationId: string
  clientBillingType: 'FLAT_RATE' | 'PER_CLEAN'
  clientCleanerPayType?: 'FLAT_RATE' | 'PER_CLEAN' // How subcontractor is paid at client level
  schedule?: ScheduleRecord
  mode?: ScheduleFormMode
  futureStartDate?: string | Date
  embedded?: boolean
  onSuccess: () => void
  onCancel: () => void
}

// Parse monthly pattern from schedule
function parseMonthlyPattern(schedule: ScheduleRecord | undefined) {
  if (!schedule?.monthlyPattern) {
    return { type: 'FIXED_DATES' as const, dates: [1, 15], weekday: 6, weeks: [2, 4] }
  }
  try {
    const pattern = JSON.parse(schedule.monthlyPattern)
    return {
      type: pattern.type || 'FIXED_DATES',
      dates: pattern.dates || [1, 15],
      weekday: pattern.weekday ?? 6,
      weeks: pattern.weeks || [2, 4],
    }
  } catch {
    return { type: 'FIXED_DATES' as const, dates: [1, 15], weekday: 6, weeks: [2, 4] }
  }
}

interface PreviewData {
  deletedCount: number
  updatedCount: number
  createdCount: number
  protectedCount: number
  skippedCount: number
  firstJobDate: string | null
  lastJobDate: string | null
}

interface FutureChangePreviewData {
  oldScheduleEndDate: string
  futureOldJobsRemoved: number
  futureProtectedJobsCount: number
  futureJobsToCreate: number
  futureJobsSkipped: number
  firstNewJobDate: string | null
  lastNewJobDate: string | null
  recurringAddOnsToCarry: number
  overlappingScheduleCount: number
  dateDiff?: ScheduleDiff
}

type ScheduleFrequency =
  | 'WEEKLY'
  | 'BI_WEEKLY'
  | 'EVERY_3_WEEKS'
  | 'EVERY_4_WEEKS'
  | 'EVERY_6_WEEKS'
  | 'MONTHLY'
  | '2X_MONTHLY'
  | 'CUSTOM'

const DAY_BASED_FREQUENCIES: ScheduleFrequency[] = [
  'WEEKLY',
  'BI_WEEKLY',
  'EVERY_3_WEEKS',
  'EVERY_4_WEEKS',
  'EVERY_6_WEEKS',
]

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  WEEKLY: 'Weekly',
  BI_WEEKLY: 'Bi-Weekly',
  EVERY_3_WEEKS: 'Every 3 Weeks',
  EVERY_4_WEEKS: 'Every 4 Weeks',
  EVERY_6_WEEKS: 'Every 6 Weeks',
  MONTHLY: 'Monthly',
  '2X_MONTHLY': '2x Monthly',
  CUSTOM: 'Custom',
}

export function ScheduleForm({
  locationId,
  clientBillingType,
  clientCleanerPayType = 'PER_CLEAN',
  schedule,
  mode,
  futureStartDate,
  embedded = false,
  onSuccess,
  onCancel,
}: ScheduleFormProps) {
  const resolvedMode: ScheduleFormMode = mode || (schedule ? 'edit' : 'create')
  return (
    <ScheduleFormInner
      locationId={locationId}
      clientBillingType={clientBillingType}
      clientCleanerPayType={clientCleanerPayType}
      schedule={schedule}
      mode={resolvedMode}
      futureStartDate={futureStartDate}
      embedded={embedded}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  )
}

function getDefaultStartDate(mode: ScheduleFormMode, schedule?: ScheduleRecord, futureStartDate?: string | Date) {
  if (mode === 'future') {
    return formatDateForInput(futureStartDate || new Date())
  }
  if (schedule?.startDate) {
    return formatDateForInput(schedule.startDate)
  }
  return formatDateForInput(new Date())
}

function ScheduleFormInner({
  locationId,
  clientBillingType,
  clientCleanerPayType = 'PER_CLEAN',
  schedule,
  mode = schedule ? 'edit' : 'create',
  futureStartDate,
  embedded = false,
  onSuccess,
  onCancel,
}: ScheduleFormProps) {
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [futurePreview, setFuturePreview] = useState<FutureChangePreviewData | null>(null)
  const [pendingSaveData, setPendingSaveData] = useState<Record<string, unknown> | null>(null)
  const [liveUpdating, setLiveUpdating] = useState(false)
  const [subcontractors, setSubcontractors] = useState<Array<{ id: string; name: string; isActive?: boolean }>>([])
  const [carryForwardRecurringAddOns, setCarryForwardRecurringAddOns] = useState(true)
  const isFutureChange = mode === 'future'
  const recurringAddOnCount = schedule?.recurringAddOnServices?.length || 0
  
  // 2x Monthly pattern state
  const initialPattern = parseMonthlyPattern(schedule)
  const [monthlyPatternType, setMonthlyPatternType] = useState<'FIXED_DATES' | 'NTH_WEEKDAY'>(initialPattern.type)
  const [fixedDates, setFixedDates] = useState<[number, number]>([initialPattern.dates[0] || 1, initialPattern.dates[1] || 15])
  const [nthWeekday, setNthWeekday] = useState<number>(initialPattern.weekday)
  const [nthWeeks, setNthWeeks] = useState<(number | 'last')[]>(initialPattern.weeks)
  
  // Safely parse daysOfWeek JSON
  const parseDaysOfWeek = (daysOfWeek: string | null | undefined): number[] => {
    if (!daysOfWeek) return []
    try {
      const parsed = JSON.parse(daysOfWeek)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  
  const [formData, setFormData] = useState({
    locationId,
    frequency: (schedule?.frequency || 'WEEKLY') as ScheduleFrequency,
    daysOfWeek: parseDaysOfWeek(schedule?.daysOfWeek),
    timeType: (schedule?.timeType || 'SPECIFIC') as 'SPECIFIC' | 'WINDOW',
    startTime: schedule?.startTime || '',
    startWindowBegin: schedule?.startWindowBegin || '',
    startWindowEnd: schedule?.startWindowEnd || '',
    defaultClientRate: schedule?.defaultClientRate?.toString() || '',
    defaultSubcontractorRate: schedule?.defaultSubcontractorRate?.toString() || '',
    clientPayType: (schedule?.clientPayType || clientBillingType) as 'FLAT_RATE' | 'PER_CLEAN',
    subcontractorPayType: (schedule?.subcontractorPayType || clientCleanerPayType) as 'FLAT_RATE' | 'PER_CLEAN',
    startDate: getDefaultStartDate(mode, schedule, futureStartDate),
    endDate: schedule?.endDate ? formatDateForInput(schedule.endDate) : '',
    subcontractorId: schedule?.subcontractorId || '',
    isActive: schedule?.isActive ?? true,
  })

  useEffect(() => {
    fetch('/api/subcontractors')
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch subcontractors')
        }
        return res.json()
      })
      .then(data => {
        logger.debug('Loaded subcontractors:', data)
        setSubcontractors(data)
      })
      .catch(error => {
        logger.error('Error loading subcontractors:', error)
        showError('Failed to load subcontractors. Please refresh the page.')
      })
  }, [])

  // Update form data when schedule prop changes
  useEffect(() => {
    if (schedule) {
      const pattern = parseMonthlyPattern(schedule)
      setMonthlyPatternType(pattern.type)
      setFixedDates([pattern.dates[0] || 1, pattern.dates[1] || 15])
      setNthWeekday(pattern.weekday)
      setNthWeeks(pattern.weeks)
      
      setFormData({
        locationId,
        frequency: (schedule.frequency || 'WEEKLY') as ScheduleFrequency,
        daysOfWeek: parseDaysOfWeek(schedule.daysOfWeek),
        timeType: (schedule.timeType || 'SPECIFIC') as 'SPECIFIC' | 'WINDOW',
        startTime: schedule.startTime || '',
        startWindowBegin: schedule.startWindowBegin || '',
        startWindowEnd: schedule.startWindowEnd || '',
        defaultClientRate: schedule.defaultClientRate?.toString() || '',
        defaultSubcontractorRate: schedule.defaultSubcontractorRate?.toString() || '',
        clientPayType: (schedule.clientPayType || clientBillingType) as 'FLAT_RATE' | 'PER_CLEAN',
        subcontractorPayType: (schedule.subcontractorPayType || clientCleanerPayType) as 'FLAT_RATE' | 'PER_CLEAN',
        startDate: getDefaultStartDate(mode, schedule, futureStartDate),
        endDate: schedule.endDate ? formatDateForInput(schedule.endDate) : '',
        subcontractorId: schedule.subcontractorId || '',
        isActive: schedule.isActive ?? true,
      })
    }
  }, [schedule, locationId, clientBillingType, clientCleanerPayType, mode, futureStartDate])

  useEffect(() => {
    setCarryForwardRecurringAddOns(true)
  }, [schedule?.id, mode])

  useEffect(() => {
    if (!futurePreview) return
    setFuturePreview(null)
    setPendingSaveData(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, monthlyPatternType, fixedDates, nthWeekday, nthWeeks, carryForwardRecurringAddOns])

  const daysOfWeekOptions = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ]

  const toggleDay = (day: number) => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d: number) => d !== day)
        : [...prev.daysOfWeek, day].sort()
    }))
  }

  // Build + validate the payload from the current form state. Shared by the live
  // preview so the diff you see is exactly what Confirm will save.
  const buildValidatedPayload = () => {
    const schema = isFutureChange ? createScheduleSchema : schedule ? updateScheduleSchema : createScheduleSchema
    const startDate = new Date(formData.startDate + 'T12:00:00Z')
    const endDate = formData.endDate ? new Date(formData.endDate + 'T12:00:00Z') : null
    let monthlyPattern: string | null = null
    if (formData.frequency === '2X_MONTHLY') {
      monthlyPattern = monthlyPatternType === 'FIXED_DATES'
        ? JSON.stringify({ type: 'FIXED_DATES', dates: fixedDates })
        : JSON.stringify({ type: 'NTH_WEEKDAY', weekday: nthWeekday, weeks: nthWeeks })
    } else if (formData.frequency === 'MONTHLY' && monthlyPatternType === 'NTH_WEEKDAY') {
      monthlyPattern = JSON.stringify({ type: 'NTH_WEEKDAY', weekday: nthWeekday, weeks: nthWeeks })
    }
    return schema.safeParse({
      ...formData,
      daysOfWeek: (formData.frequency === '2X_MONTHLY' || (formData.frequency === 'MONTHLY' && monthlyPatternType === 'NTH_WEEKDAY')) ? null : JSON.stringify(formData.daysOfWeek),
      monthlyPattern,
      defaultClientRate: parseFloat(formData.defaultClientRate),
      defaultSubcontractorRate: parseFloat(formData.defaultSubcontractorRate),
      clientPayType: formData.clientPayType,
      subcontractorPayType: formData.subcontractorPayType,
      startDate,
      endDate,
      subcontractorId: formData.subcontractorId || null,
    })
  }
  const toDataToSend = (data: Record<string, unknown>) => ({
    ...data,
    startDate: data.startDate instanceof Date ? data.startDate.toISOString() : data.startDate,
    endDate: data.endDate instanceof Date ? data.endDate.toISOString() : data.endDate,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Client-side validation
    const schema = isFutureChange
      ? createScheduleSchema
      : schedule
        ? updateScheduleSchema
        : createScheduleSchema
    // Use explicit UTC (noon UTC) to avoid timezone edge cases
    const startDate = new Date(formData.startDate + 'T12:00:00Z')
    const endDate = formData.endDate ? new Date(formData.endDate + 'T12:00:00Z') : null
    
    // Build monthly pattern JSON for MONTHLY or 2X_MONTHLY
    let monthlyPattern: string | null = null
    if (formData.frequency === '2X_MONTHLY') {
      if (monthlyPatternType === 'FIXED_DATES') {
        monthlyPattern = JSON.stringify({ type: 'FIXED_DATES', dates: fixedDates })
      } else {
        monthlyPattern = JSON.stringify({ type: 'NTH_WEEKDAY', weekday: nthWeekday, weeks: nthWeeks })
      }
    } else if (formData.frequency === 'MONTHLY' && monthlyPatternType === 'NTH_WEEKDAY') {
      monthlyPattern = JSON.stringify({ type: 'NTH_WEEKDAY', weekday: nthWeekday, weeks: nthWeeks })
    }
    
    const validationData = {
      ...formData,
      daysOfWeek: (formData.frequency === '2X_MONTHLY' || (formData.frequency === 'MONTHLY' && monthlyPatternType === 'NTH_WEEKDAY')) ? null : JSON.stringify(formData.daysOfWeek),
      monthlyPattern,
      defaultClientRate: parseFloat(formData.defaultClientRate),
      defaultSubcontractorRate: parseFloat(formData.defaultSubcontractorRate),
      clientPayType: formData.clientPayType,
      subcontractorPayType: formData.subcontractorPayType,
      startDate,
      endDate,
      subcontractorId: formData.subcontractorId || null,
    }
    
    const validationResult = schema.safeParse(validationData)
    if (!validationResult.success) {
      const { formatZodErrors } = await import('@/lib/validations')
      const errors = formatZodErrors(validationResult.error)
      const { showError } = await import('@/lib/toast')
      showError(errors[0] || 'Please check all required fields')
      return
    }
    
    // Convert Date objects to ISO strings for JSON serialization
    const dataToSend = {
      ...validationResult.data,
      startDate: validationResult.data.startDate instanceof Date
        ? validationResult.data.startDate.toISOString()
        : validationResult.data.startDate,
      endDate: validationResult.data.endDate instanceof Date
        ? validationResult.data.endDate.toISOString()
        : validationResult.data.endDate,
    }

    if (isFutureChange && schedule) {
      const currentScheduleStart = schedule.startDate ? new Date(schedule.startDate) : null
      if (currentScheduleStart && startDate <= new Date(currentScheduleStart)) {
        showError('Choose a start date after the current schedule start date.')
        return
      }
      await previewFutureScheduleChange(dataToSend as Record<string, unknown>)
      return
    }

    // For edits, show preview first; for new schedules, save directly
    if (schedule) {
      setPreviewLoading(true)
      try {
        const previewRes = await fetch('/api/schedules/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduleId: schedule.id, updates: dataToSend }),
        })
        if (previewRes.ok) {
          const previewData = await previewRes.json()
          setPreview(previewData.preview)
          setPendingSaveData(dataToSend as Record<string, unknown>)
        } else {
          // Preview failed — fall through to save directly
          await saveSchedule(dataToSend as Record<string, unknown>)
        }
      } catch (error) {
        logger.error('Error fetching preview:', error)
        // Preview failed — fall through to save directly
        await saveSchedule(dataToSend as Record<string, unknown>)
      } finally {
        setPreviewLoading(false)
      }
    } else {
      await saveSchedule(dataToSend as Record<string, unknown>)
    }
  }

  const saveFutureSchedule = async (dataToSend: Record<string, unknown>) => {
    if (!schedule) return
    setLoading(true)
    try {
      const response = await fetch(`/api/schedules/${schedule.id}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...dataToSend,
          carryForwardRecurringAddOns,
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to create future schedule change')
        setLoading(false)
        return
      }

      const result = await response.json()
      const parts: string[] = []
      const newSummary = result.regenerationSummary?.newSchedule
      const oldSummary = result.regenerationSummary?.oldSchedule

      if (newSummary?.createdCount > 0) parts.push(`${newSummary.createdCount} future jobs created`)
      if (oldSummary?.deletedCount > 0) parts.push(`${oldSummary.deletedCount} old future jobs removed`)
      if (result.carriedForwardRecurringAddOns > 0) {
        parts.push(`${result.carriedForwardRecurringAddOns} recurring add-on${result.carriedForwardRecurringAddOns === 1 ? '' : 's'} carried forward`)
      }
      if (result.futureProtectedJobsCount > 0) {
        parts.push(`${result.futureProtectedJobsCount} protected future job${result.futureProtectedJobsCount === 1 ? '' : 's'} kept on the old schedule`)
      }

      const endDateLabel = result.oldScheduleEndDate
        ? new Date(result.oldScheduleEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null

      showSuccess(
        parts.length > 0
          ? `Future change saved${endDateLabel ? `: old schedule ends ${endDateLabel}, ` : ': '}${parts.join(', ')}`
          : 'Future change saved successfully'
      )

      onSuccess()
    } catch (error) {
      logger.error('Error saving future schedule change:', error)
      showError('Failed to create future schedule change. Please try again.')
    } finally {
      setLoading(false)
      setPreview(null)
      setFuturePreview(null)
      setPendingSaveData(null)
    }
  }

  const previewFutureScheduleChange = async (dataToSend: Record<string, unknown>, silent = false) => {
    if (!schedule) return
    if (silent) setLiveUpdating(true)
    else setPreviewLoading(true)
    try {
      const response = await fetch(`/api/schedules/${schedule.id}/change-going-forward/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...dataToSend,
          carryForwardRecurringAddOns,
        }),
      })

      if (!response.ok) {
        // Silent (live) calls stay quiet — the form may be mid-edit/invalid.
        if (!silent) await showApiError(response, 'Failed to preview future schedule change')
        return
      }

      const result = await response.json()
      setFuturePreview({ ...result.preview, dateDiff: result.dateDiff })
      setPendingSaveData(dataToSend)
    } catch (error) {
      logger.error('Error previewing future schedule change:', error)
      if (!silent) showError('Failed to preview future schedule change. Please try again.')
    } finally {
      if (silent) setLiveUpdating(false)
      else setPreviewLoading(false)
    }
  }

  // Live preview: as the future-change form is edited, refresh the dated diff
  // (debounced + silent) so the clean-by-clean preview you see is exactly what
  // Confirm will save — no separate "Preview" click needed.
  useEffect(() => {
    if (!isFutureChange || !schedule) return
    // The moment any field changes, the on-screen diff no longer matches the form
    // — mark it stale so Confirm is blocked until the fresh preview lands. If the
    // form is invalid/incomplete it stays stale (you can't confirm a bad change).
    setLiveUpdating(true)
    const result = buildValidatedPayload()
    if (!result.success) return
    const startDate = new Date(formData.startDate + 'T12:00:00Z')
    const currentStart = schedule.startDate ? new Date(schedule.startDate) : null
    if (currentStart && startDate <= new Date(currentStart)) return
    const data = toDataToSend(result.data as Record<string, unknown>)
    const t = setTimeout(() => { previewFutureScheduleChange(data, true) }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFutureChange, schedule, formData, monthlyPatternType, fixedDates, nthWeekday, nthWeeks, carryForwardRecurringAddOns])

  const saveSchedule = async (dataToSend: Record<string, unknown>) => {
    setLoading(true)
    try {
      const url = schedule ? `/api/schedules/${schedule.id}` : '/api/schedules'
      const method = schedule ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend),
      })

      if (!response.ok) {
        await showApiError(response, `Failed to ${schedule ? 'update' : 'create'} schedule`)
        setLoading(false)
        return
      }

      const result = await response.json()
      const summary = result.regenerationSummary

      if (summary && schedule) {
        const parts: string[] = []
        if (summary.createdCount > 0) parts.push(`${summary.createdCount} new jobs created`)
        if (summary.updatedCount > 0) parts.push(`${summary.updatedCount} jobs updated`)
        if (summary.deletedCount > 0) parts.push(`${summary.deletedCount} old jobs removed`)
        showSuccess(parts.length > 0 ? `Schedule updated: ${parts.join(', ')}` : 'Schedule updated successfully')
      } else {
        showSuccess(`Schedule ${schedule ? 'updated' : 'created'} successfully`)
      }

      onSuccess()
    } catch (error) {
      logger.error('Error saving schedule:', error)
      showError(`Failed to ${schedule ? 'update' : 'create'} schedule. Please try again.`)
    } finally {
      setLoading(false)
      setPreview(null)
      setFuturePreview(null)
      setPendingSaveData(null)
    }
  }

  const handleConfirmSave = async () => {
    if (pendingSaveData) {
      if (futurePreview) {
        await saveFutureSchedule(pendingSaveData)
        return
      }
      await saveSchedule(pendingSaveData)
    }
  }

  const handleCancelPreview = () => {
    setPreview(null)
    setFuturePreview(null)
    setPendingSaveData(null)
  }

  const clientRateLabel = formData.clientPayType === 'FLAT_RATE'
    ? 'Monthly Flat Rate'
    : 'Per Clean Rate'

  const subcontractorRateLabel = formData.subcontractorPayType === 'FLAT_RATE'
    ? 'Monthly Subcontractor Rate'
    : 'Per Clean Subcontractor Rate'

  const formTitle = isFutureChange
    ? 'Change Going Forward'
    : schedule
      ? `Editing: ${FREQUENCY_LABELS[formData.frequency]} Schedule`
      : 'Edit Schedule'

  const submitLabel = isFutureChange
    ? 'Create Future Change'
    : schedule
      ? 'Update Schedule'
      : 'Create Schedule'

  const savingLabel = isFutureChange
    ? 'Creating...'
    : schedule
      ? 'Updating...'
      : 'Creating...'

  // Plain-English headline of what's changing vs the current plan — the one-line
  // "here's what you're about to do" so a frequency/cleaner/pay switch is obvious.
  const changeSummary = useMemo(() => {
    if (!isFutureChange || !schedule) return null
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const parts: string[] = []

    if (schedule.frequency !== formData.frequency) {
      parts.push(`${FREQUENCY_LABELS[schedule.frequency as ScheduleFrequency] || schedule.frequency} → ${FREQUENCY_LABELS[formData.frequency] || formData.frequency}`)
    }

    const usesWeekdays = formData.frequency !== '2X_MONTHLY' && !(formData.frequency === 'MONTHLY' && monthlyPatternType === 'NTH_WEEKDAY')
    const oldDays = parseDaysOfWeek(schedule.daysOfWeek).slice().sort().join(',')
    const newDays = formData.daysOfWeek.slice().sort().join(',')
    if (usesWeekdays && oldDays !== newDays) {
      const names = formData.daysOfWeek.slice().sort().map((d: number) => DAY[d]).join(', ')
      parts.push(`days → ${names || 'none set'}`)
    }

    const oldSub = schedule.subcontractorId || null
    const newSub = formData.subcontractorId || null
    if (oldSub !== newSub) {
      const name = subcontractors.find((s) => s.id === newSub)?.name || 'Unassigned'
      parts.push(`cleaner → ${name}`)
    }

    const newCRate = formData.defaultClientRate === '' ? null : parseFloat(formData.defaultClientRate)
    if (schedule.clientPayType !== formData.clientPayType) {
      parts.push(`client billing → ${formData.clientPayType === 'FLAT_RATE' ? 'monthly flat' : 'per clean'}${newCRate != null && !Number.isNaN(newCRate) ? ` $${newCRate}` : ''}`)
    } else if (newCRate != null && !Number.isNaN(newCRate) && newCRate !== (schedule.defaultClientRate ?? null)) {
      parts.push(`client rate → $${newCRate}`)
    }

    const newSRate = formData.defaultSubcontractorRate === '' ? null : parseFloat(formData.defaultSubcontractorRate)
    if (schedule.subcontractorPayType !== formData.subcontractorPayType) {
      parts.push(`cleaner pay → ${formData.subcontractorPayType === 'FLAT_RATE' ? 'monthly flat' : 'per clean'}${newSRate != null && !Number.isNaN(newSRate) ? ` $${newSRate}` : ''}`)
    } else if (newSRate != null && !Number.isNaN(newSRate) && newSRate !== (schedule.defaultSubcontractorRate ?? null)) {
      parts.push(`cleaner pay → $${newSRate}`)
    }

    return { parts, when: formData.startDate ? formatReadableDate(formData.startDate) : null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFutureChange, schedule, formData, monthlyPatternType, subcontractors])

  return (
    <form onSubmit={handleSubmit}>
      <div className={embedded ? "space-y-5" : `rounded-xl border-2 ${schedule ? 'border-teal-200' : 'border-gray-200'} overflow-hidden`}>
        {!embedded && (
          <div className={`px-4 py-3 ${schedule ? 'bg-teal-50 border-b border-teal-200' : 'bg-gray-50 border-b border-gray-200'}`}>
            <div className="flex items-center gap-2">
              {schedule && (
                <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              )}
              <span className={`font-semibold ${schedule ? 'text-teal-800' : 'text-gray-800'}`}>
                {formTitle}
              </span>
            </div>
          </div>
        )}

        <div className={embedded ? "space-y-5" : "p-5 bg-white space-y-5"}>
          {isFutureChange && schedule && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 space-y-3">
              <div>
                <p className="font-medium text-blue-900">This will create a new rule starting on the date below.</p>
                <p className="text-sm text-blue-700">
                  Everything before that date stays exactly the same on the old schedule.
                </p>
              </div>
              {recurringAddOnCount > 0 && (
                <label className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white px-3 py-3 cursor-pointer">
                  <Checkbox
                    checked={carryForwardRecurringAddOns}
                    onCheckedChange={(checked) => setCarryForwardRecurringAddOns(checked === true)}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Carry recurring add-ons forward</p>
                    <p className="text-xs text-gray-500">
                      Copy {recurringAddOnCount} recurring add-on{recurringAddOnCount === 1 ? '' : 's'} to the new schedule.
                    </p>
                  </div>
                </label>
              )}
            </div>
          )}

          {futurePreview && isFutureChange && (
            <div className={`rounded-lg border-2 p-4 space-y-3 ${
              futurePreview.futureProtectedJobsCount > 0 || futurePreview.overlappingScheduleCount > 0
                ? 'border-amber-300 bg-amber-50'
                : 'border-blue-200 bg-blue-50'
            }`}>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold text-gray-900">What this change does</span>
                {liveUpdating && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" /> updating…
                  </span>
                )}
              </div>

              {/* Plain-English headline of the change — updates live as you edit */}
              {changeSummary && (
                <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2.5">
                  {changeSummary.parts.length === 0 ? (
                    <p className="text-[13px] text-gray-500">No changes yet — adjust the plan below and you&apos;ll see the effect here live.</p>
                  ) : (
                    <p className="text-[13px] leading-snug text-gray-800">
                      <span className="font-semibold">{changeSummary.parts.join('  ·  ')}</span>
                      {changeSummary.when && <span className="text-gray-500"> — starting {changeSummary.when}</span>}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5 text-sm">
                <div className="text-gray-700">
                  The current schedule will end on{' '}
                  <span className="font-medium">
                    {new Date(futurePreview.oldScheduleEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>.
                </div>
                {futurePreview.futureOldJobsRemoved > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-700">{futurePreview.futureOldJobsRemoved} old future job{futurePreview.futureOldJobsRemoved === 1 ? '' : 's'} will be removed from the current rule</span>
                  </div>
                )}
                {futurePreview.futureJobsToCreate > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-700">{futurePreview.futureJobsToCreate} future job{futurePreview.futureJobsToCreate === 1 ? '' : 's'} will be created on the new rule</span>
                  </div>
                )}
                {futurePreview.futureJobsSkipped > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-gray-700">{futurePreview.futureJobsSkipped} future date{futurePreview.futureJobsSkipped === 1 ? '' : 's'} already have jobs and will be skipped</span>
                  </div>
                )}
                {futurePreview.futureProtectedJobsCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-700">{futurePreview.futureProtectedJobsCount} invoiced/paid/draft future job{futurePreview.futureProtectedJobsCount === 1 ? '' : 's'} will stay on the old schedule</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${futurePreview.recurringAddOnsToCarry > 0 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                  <span className="text-gray-700">
                    {futurePreview.recurringAddOnsToCarry > 0
                      ? `${futurePreview.recurringAddOnsToCarry} recurring add-on${futurePreview.recurringAddOnsToCarry === 1 ? '' : 's'} will carry forward`
                      : 'No recurring add-ons will carry forward'}
                  </span>
                </div>
                {futurePreview.overlappingScheduleCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-700">This location already has {futurePreview.overlappingScheduleCount} other schedule rule{futurePreview.overlappingScheduleCount === 1 ? '' : 's'} in the same date range</span>
                  </div>
                )}
                {futurePreview.firstNewJobDate && futurePreview.lastNewJobDate && (
                  <div className="text-gray-500 text-xs pt-1">
                    New schedule date range: {new Date(futurePreview.firstNewJobDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &ndash; {new Date(futurePreview.lastNewJobDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>

              {futurePreview.dateDiff && (
                <div className="rounded-lg border border-white/70 bg-white/80 p-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Clean-by-clean preview</div>
                  <ScheduleDiffPreview diff={futurePreview.dateDiff} />
                </div>
              )}

              <p className="flex items-center gap-1.5 pt-0.5 text-[11px] text-gray-500">
                <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                Updates live as you edit. When it looks right, hit <span className="font-semibold text-gray-700">Confirm change</span> at the bottom.
              </p>
            </div>
          )}

          {/* Frequency */}
          <div className="space-y-2">
            <Label>Frequency *</Label>
            <Select
              value={formData.frequency}
              onValueChange={(value) => setFormData({ ...formData, frequency: value as typeof formData.frequency })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Every Week</SelectItem>
                <SelectItem value="BI_WEEKLY">Bi-Weekly</SelectItem>
                <SelectItem value="EVERY_3_WEEKS">Every 3 Weeks</SelectItem>
                <SelectItem value="EVERY_4_WEEKS">Every 4 Weeks</SelectItem>
                <SelectItem value="EVERY_6_WEEKS">Every 6 Weeks</SelectItem>
                <SelectItem value="2X_MONTHLY">2x Monthly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="CUSTOM">One-Time / Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Monthly Pattern Options */}
          {formData.frequency === 'MONTHLY' && (
            <div className="space-y-4 p-4 bg-teal-50 rounded-xl border border-teal-200">
              <div>
                <Label className="text-teal-900">How do you want to schedule?</Label>
                <p className="text-xs text-teal-700 mt-0.5">Choose a pattern for the monthly cleans</p>
              </div>
              
              {/* Pattern Type Toggle */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMonthlyPatternType('FIXED_DATES')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-all ${
                    monthlyPatternType === 'FIXED_DATES'
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Same date each month
                  <span className="block text-xs mt-0.5 opacity-80">e.g., the 9th of each month</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyPatternType('NTH_WEEKDAY')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-all ${
                    monthlyPatternType === 'NTH_WEEKDAY'
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Specific weekday
                  <span className="block text-xs mt-0.5 opacity-80">e.g., 1st Tuesday or 1st &amp; 3rd Tuesday</span>
                </button>
              </div>

              {/* NTH_WEEKDAY Options for MONTHLY */}
              {monthlyPatternType === 'NTH_WEEKDAY' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-teal-900">Day of week</Label>
                    <Select
                      value={nthWeekday.toString()}
                      onValueChange={(value) => setNthWeekday(parseInt(value))}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-teal-900">Which weeks of the month?</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 1 as number | 'last', label: '1st' },
                        { value: 2 as number | 'last', label: '2nd' },
                        { value: 3 as number | 'last', label: '3rd' },
                        { value: 4 as number | 'last', label: '4th' },
                        { value: 'last' as number | 'last', label: 'Last' },
                      ].map(week => (
                        <button
                          key={String(week.value)}
                          type="button"
                          onClick={() => {
                            if (nthWeeks.includes(week.value)) {
                              setNthWeeks(nthWeeks.filter(w => w !== week.value))
                            } else {
                              const next = [...nthWeeks, week.value]
                              // Sort: numbers first, then 'last'
                              next.sort((a, b) => {
                                if (a === 'last') return 1
                                if (b === 'last') return -1
                                return (a as number) - (b as number)
                              })
                              setNthWeeks(next)
                            }
                          }}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                            nthWeeks.includes(week.value)
                              ? 'bg-teal-600 text-white shadow-sm'
                              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {week.label}
                        </button>
                      ))}
                    </div>
                    {nthWeeks.length > 0 && (
                      <p className="text-xs text-teal-700 font-medium">
                        Every {nthWeeks.map(w => w === 'last' ? 'Last' : w === 1 ? '1st' : w === 2 ? '2nd' : w === 3 ? '3rd' : `${w}th`).join(' and ')} {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nthWeekday]}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2x Monthly Pattern Options */}
          {formData.frequency === '2X_MONTHLY' && (
            <div className="space-y-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div>
                <Label className="text-blue-900">How do you want to schedule?</Label>
                <p className="text-xs text-blue-700 mt-0.5">Choose a pattern for the twice-monthly cleans</p>
              </div>
              
              {/* Pattern Type Toggle */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMonthlyPatternType('FIXED_DATES')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-all ${
                    monthlyPatternType === 'FIXED_DATES'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Same dates each month
                  <span className="block text-xs mt-0.5 opacity-80">e.g., 1st and 15th</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyPatternType('NTH_WEEKDAY')}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-all ${
                    monthlyPatternType === 'NTH_WEEKDAY'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Specific weekday
                  <span className="block text-xs mt-0.5 opacity-80">e.g., 2nd & 4th Saturday</span>
                </button>
              </div>
              
              {/* Fixed Dates Options */}
              {monthlyPatternType === 'FIXED_DATES' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-blue-900">First date</Label>
                    <Select
                      value={fixedDates[0].toString()}
                      onValueChange={(value) => setFixedDates([parseInt(value), fixedDates[1]])}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                          <SelectItem key={day} value={day.toString()}>
                            {day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-blue-900">Second date</Label>
                    <Select
                      value={fixedDates[1].toString()}
                      onValueChange={(value) => setFixedDates([fixedDates[0], parseInt(value)])}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                          <SelectItem key={day} value={day.toString()}>
                            {day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              
              {/* Nth Weekday Options */}
              {monthlyPatternType === 'NTH_WEEKDAY' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-blue-900">Day of week</Label>
                    <Select
                      value={nthWeekday.toString()}
                      onValueChange={(value) => setNthWeekday(parseInt(value))}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                    <div className="space-y-2">
                    <Label className="text-blue-900">Which weeks of the month?</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 1 as number | 'last', label: '1st' },
                        { value: 2 as number | 'last', label: '2nd' },
                        { value: 3 as number | 'last', label: '3rd' },
                        { value: 4 as number | 'last', label: '4th' },
                        { value: 'last' as number | 'last', label: 'Last' },
                      ].map(week => (
                        <button
                          key={String(week.value)}
                          type="button"
                          onClick={() => {
                            if (nthWeeks.includes(week.value)) {
                              setNthWeeks(nthWeeks.filter(w => w !== week.value))
                            } else {
                              const next = [...nthWeeks, week.value]
                              next.sort((a, b) => {
                                if (a === 'last') return 1
                                if (b === 'last') return -1
                                return (a as number) - (b as number)
                              })
                              setNthWeeks(next)
                            }
                          }}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                            nthWeeks.includes(week.value)
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {week.label}
                        </button>
                      ))}
                    </div>
                    {nthWeeks.length > 0 && (
                      <p className="text-xs text-blue-700 font-medium">
                        Every {nthWeeks.map(w => w === 'last' ? 'Last' : w === 1 ? '1st' : w === 2 ? '2nd' : w === 3 ? '3rd' : `${w}th`).join(' and ')} {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nthWeekday]}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Days of Week for weekly-style recurring schedules */}
          {DAY_BASED_FREQUENCIES.includes(formData.frequency) && (
            <div className="space-y-3">
              <div>
                <Label>
                  Days of Week *
                  <InlineHelp content="days-of-week" />
                </Label>
                <p className="text-xs text-gray-500 mt-0.5">Tap to select (you can pick multiple)</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 0, label: 'Sun' },
                  { value: 1, label: 'Mon' },
                  { value: 2, label: 'Tue' },
                  { value: 3, label: 'Wed' },
                  { value: 4, label: 'Thu' },
                  { value: 5, label: 'Fri' },
                  { value: 6, label: 'Sat' },
                ].map(day => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                      formData.daysOfWeek.includes(day.value)
                        ? 'bg-teal-500 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              {formData.daysOfWeek.length > 0 && (
                <p className="text-xs text-teal-600 font-medium">
                  Selected: {formData.daysOfWeek.map((d: number) => 
                    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]
                  ).join(', ')}
                </p>
              )}

              </div>
          )}

          {/* Time Type */}
          <div className="space-y-2">
            <Label>
              Time Type *
              <InlineHelp content="help-time-window" />
            </Label>
            <div className="flex gap-4">
              <SimpleTooltip content="time-specific">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="SPECIFIC"
                    checked={formData.timeType === 'SPECIFIC'}
                    onChange={(e) => setFormData({ ...formData, timeType: e.target.value as 'SPECIFIC' | 'WINDOW' })}
                  />
                  Specific Time
                </label>
              </SimpleTooltip>
              <SimpleTooltip content="time-window">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="WINDOW"
                    checked={formData.timeType === 'WINDOW'}
                    onChange={(e) => setFormData({ ...formData, timeType: e.target.value as 'SPECIFIC' | 'WINDOW' })}
                  />
                  Time Window
                </label>
              </SimpleTooltip>
            </div>
          </div>

          {/* Time Fields */}
          {formData.timeType === 'SPECIFIC' ? (
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time *</Label>
              <TimePicker
                id="startTime"
                value={formData.startTime}
                onChange={(value) => setFormData({ ...formData, startTime: value })}
                required
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startWindowBegin">Window Start *</Label>
                <TimePicker
                  id="startWindowBegin"
                  value={formData.startWindowBegin}
                  onChange={(value) => setFormData({ ...formData, startWindowBegin: value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="startWindowEnd">Window End *</Label>
                <TimePicker
                  id="startWindowEnd"
                  value={formData.startWindowEnd}
                  onChange={(value) => setFormData({ ...formData, startWindowEnd: value })}
                  required
                />
              </div>
            </div>
          )}

          {/* Pay Types */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Client Pay Type *
                <InlineHelp content="client-pay-type" />
              </Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="FLAT_RATE"
                    checked={formData.clientPayType === 'FLAT_RATE'}
                    onChange={(e) => setFormData({ ...formData, clientPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })}
                  />
                  Monthly Flat Rate
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="PER_CLEAN"
                    checked={formData.clientPayType === 'PER_CLEAN'}
                    onChange={(e) => setFormData({ ...formData, clientPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })}
                  />
                  Per Clean
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Subcontractor Pay Type *
                <InlineHelp content="subcontractor-pay-type" />
              </Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="FLAT_RATE"
                    checked={formData.subcontractorPayType === 'FLAT_RATE'}
                    onChange={(e) => setFormData({ ...formData, subcontractorPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })}
                  />
                  Monthly Flat Rate
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="PER_CLEAN"
                    checked={formData.subcontractorPayType === 'PER_CLEAN'}
                    onChange={(e) => setFormData({ ...formData, subcontractorPayType: e.target.value as 'FLAT_RATE' | 'PER_CLEAN' })}
                  />
                  Per Clean
                </label>
              </div>
            </div>
          </div>

          {/* Rates */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clientRate">
                {clientRateLabel} *
                <InlineHelp content="client-rate" />
              </Label>
              <Input
                id="clientRate"
                type="number"
                step="0.01"
                min="0"
                value={formData.defaultClientRate}
                onChange={(e) => setFormData({ ...formData, defaultClientRate: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subcontractorRate">
                {subcontractorRateLabel} *
                <InlineHelp content="subcontractor-rate" />
              </Label>
              <Input
                id="subcontractorRate"
                type="number"
                step="0.01"
                min="0"
                value={formData.defaultSubcontractorRate}
                onChange={(e) => setFormData({ ...formData, defaultSubcontractorRate: e.target.value })}
                placeholder="0.00"
                required
              />
              {formData.subcontractorPayType === 'FLAT_RATE' && (
                <p className="text-xs text-muted-foreground">
                  Note: This is the total monthly amount paid to the subcontractor, regardless of number of cleans
                </p>
              )}
            </div>
          </div>

          {/* Subcontractor */}
          <div className="space-y-2">
            <Label>
              Assigned Cleaner
              <InlineHelp content="subcontractor-assign" />
            </Label>
            <Select
              value={formData.subcontractorId || "unassigned"}
              onValueChange={(value) => setFormData({ ...formData, subcontractorId: value === "unassigned" ? "" : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {subcontractors.length === 0 && (
                  <SelectItem value="loading" disabled>Loading cleaners...</SelectItem>
                )}
                {subcontractors.filter(sub => sub.isActive !== false).map(sub => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {sub.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subcontractors.length > 0 && (
              <p className="text-xs text-muted-foreground">{subcontractors.length} cleaner(s) available</p>
            )}
          </div>

          {/* Dates */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">
                {isFutureChange ? 'New plan starts on *' : 'Start Date *'}
                <InlineHelp content="schedule-start-date" />
              </Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
              {isFutureChange && formData.startDate && (
                <p className="text-xs font-medium text-blue-700">
                  Switches on {formatReadableDate(formData.startDate)}. Cleans before then keep the current plan.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">
                End Date (optional)
                <InlineHelp content="schedule-end-date" />
              </Label>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Leave blank for ongoing schedule</p>
            </div>
          </div>

          {/* Schedule Active Toggle (only show when editing) */}
          {schedule && !isFutureChange && (
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${formData.isActive ? 'bg-teal-100' : 'bg-gray-200'}`}>
                  <svg className={`w-5 h-5 ${formData.isActive ? 'text-teal-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Schedule {formData.isActive ? 'Active' : 'Paused'}</p>
                  <p className="text-sm text-gray-500">
                    {formData.isActive ? 'Jobs are being generated for this schedule' : 'No jobs will be generated'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors ${
                  formData.isActive
                    ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50'
                    : 'bg-teal-500 text-white hover:bg-teal-600'
                }`}
              >
                {formData.isActive ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Pause Schedule
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    Resume Schedule
                  </>
                )}
              </button>
            </div>
          )}

          {/* Preview confirmation dialog */}
          {preview && !isFutureChange && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold text-amber-800">Review Changes Before Saving</span>
              </div>

              <div className="space-y-1.5 text-sm">
                {preview.createdCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-700">{preview.createdCount} new {preview.createdCount === 1 ? 'job' : 'jobs'} will be created</span>
                  </div>
                )}
                {preview.updatedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-gray-700">{preview.updatedCount} existing {preview.updatedCount === 1 ? 'job' : 'jobs'} will be updated</span>
                  </div>
                )}
                {preview.deletedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-700">{preview.deletedCount} old {preview.deletedCount === 1 ? 'job' : 'jobs'} will be removed</span>
                  </div>
                )}
                {preview.protectedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-gray-700">{preview.protectedCount} invoiced/paid {preview.protectedCount === 1 ? 'job' : 'jobs'} will not be changed</span>
                  </div>
                )}
                {preview.createdCount === 0 && preview.updatedCount === 0 && preview.deletedCount === 0 && (
                  <div className="text-gray-600">No job changes needed — only the schedule settings will be updated.</div>
                )}
                {preview.firstJobDate && preview.lastJobDate && (
                  <div className="text-gray-500 text-xs pt-1">
                    Date range: {new Date(preview.firstJobDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &ndash; {new Date(preview.lastJobDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={loading}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  {loading ? 'Saving...' : 'Confirm Changes'}
                </Button>
                <Button type="button" variant="outline" onClick={handleCancelPreview} disabled={loading}>
                  Go Back
                </Button>
              </div>
            </div>
          )}

          {isFutureChange ? (
            <div className="flex items-center gap-4 pt-4">
              <Button
                type="button"
                onClick={handleConfirmSave}
                disabled={loading || !futurePreview || liveUpdating}
                className="bg-teal-600 hover:bg-teal-700"
              >
                {loading ? 'Saving…' : 'Confirm change'}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                Cancel
              </Button>
              {!loading && liveUpdating && (
                <span className="text-[11px] text-gray-400">Updating preview…</span>
              )}
            </div>
          ) : (!preview && !futurePreview) && (
            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={loading || previewLoading}>
                {previewLoading ? 'Checking...' : loading ? savingLabel : submitLabel}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </form>
  )
}
