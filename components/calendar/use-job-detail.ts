"use client"

import { useState, useEffect, useMemo } from "react"
import { formatCurrency, formatTime } from "@/lib/utils"
import { addDays, format } from "date-fns"
import { useConfirm } from "@/hooks/use-confirm"
import { getErrorMessage } from '@/lib/logger'
import { showApiError, showError, showSuccess, showUndoToast } from "@/lib/toast"
import { refreshCalendarData } from "./calendar-client"
import type { JobWithFullRelations, Subcontractor, AddOnService } from "@/types"
import { hasFinalInvoice as jobHasFinalInvoice, hasPaidInvoice as jobHasPaidInvoice } from "@/lib/invoice-status"

/**
 * The calendar API returns jobs with all Prisma fields. The `notes` field and
 * `schedule.clientPayType` exist at runtime but are absent from the shared
 * type definitions. This local extension bridges the gap.
 */
export type CalendarJob = JobWithFullRelations & {
  notes?: string | null
  schedule: (NonNullable<JobWithFullRelations['schedule']> & { clientPayType?: string }) | null
}

export type OutcomeType = 'skipped' | 'no-access' | 're-clean'
export type OutcomeAmountMode = 'normal' | 'partial' | 'none'
export type QuickFixPanel = 'move' | 'cleaner' | 'client-rate' | 'cleaner-pay' | 'addon' | 'outcome' | 'schedule' | 'convert' | null
export type QuickFixScope = 'single' | 'future' | 'all'
export type ScopeDialogAction = Exclude<QuickFixPanel, 'outcome' | 'schedule' | 'convert' | null>
export type DesktopSection = 'actions' | 'details' | 'more'

type UndoJobPayload = {
  date?: string
  startTime?: string | null
  startWindowBegin?: string | null
  startWindowEnd?: string | null
  subcontractorId?: string | null
  clientRate?: number
  subcontractorRate?: number
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  notes?: string | null
  isTrial?: boolean
  trialNotes?: string | null
}

interface UseJobDetailOptions {
  job: CalendarJob
  open: boolean
  onOpenChange: (open: boolean) => void
  subcontractors: Subcontractor[]
}

export function useJobDetail({ job, open, onOpenChange, subcontractors }: UseJobDetailOptions) {
  const { confirm, ConfirmDialog } = useConfirm()

  // Shared state
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isSavingTrial, setIsSavingTrial] = useState(false)
  const [isEditingSubcontractor, setIsEditingSubcontractor] = useState(false)
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string>('')
  const [isSavingSubcontractor, setIsSavingSubcontractor] = useState(false)
  const [isMarkingInvoiced, setIsMarkingInvoiced] = useState(false)
  const [trialEnabled, setTrialEnabled] = useState<boolean>(Boolean((job as any).isTrial))
  const [trialNotesDraft, setTrialNotesDraft] = useState<string>(((job as any).trialNotes as string | null) || '')

  const [addOns, setAddOns] = useState<AddOnService[]>(job?.addOnServices || [])
  const [isAddingAddOn, setIsAddingAddOn] = useState(false)
  const [isSavingAddOn, setIsSavingAddOn] = useState(false)
  const [deletingAddOnId, setDeletingAddOnId] = useState<string | null>(null)
  const [editingAddOnId, setEditingAddOnId] = useState<string | null>(null)
  const [newAddOn, setNewAddOn] = useState<{ description: string; clientRate: string; subcontractorRate: string; vendorId?: string }>({ description: '', clientRate: '', subcontractorRate: '' })
  const [editingAddOn, setEditingAddOn] = useState({ description: '', clientRate: '', subcontractorRate: '' })

  // Mobile-specific state
  const [mobileConfirmAction, setMobileConfirmAction] = useState<'cancel' | 'delete' | null>(null)
  const [isSelectingCleaner, setIsSelectingCleaner] = useState(false)

  // Inline date/time picker state (mobile card rows)
  const [activeInlinePicker, setActiveInlinePicker] = useState<'date' | 'time' | null>(null)
  const [localDate, setLocalDate] = useState<Date | null>(null)
  const [localTime, setLocalTime] = useState<string | null>(null)
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const [isSavingInlineDate, setIsSavingInlineDate] = useState(false)
  const [isSavingInlineTime, setIsSavingInlineTime] = useState(false)
  const [quickRescheduleLabel, setQuickRescheduleLabel] = useState<'tomorrow' | 'next-week' | null>(null)

  // Inline rate editor state
  const [isEditingRates, setIsEditingRates] = useState(false)
  const [draftClientRate, setDraftClientRate] = useState('')
  const [draftSubcontractorRate, setDraftSubcontractorRate] = useState('')
  const [isSavingRates, setIsSavingRates] = useState(false)

  // Cancellation flow state
  const [showCancellationSheet, setShowCancellationSheet] = useState(false)
  const [cancelReason, setCancelReason] = useState<string | null>(null)
  const [cancelNote, setCancelNote] = useState('')
  const [chargeFee, setChargeFee] = useState(false)
  const [feeAmount, setFeeAmount] = useState('')

  // Outcome flow state
  const [showOutcomeSheet, setShowOutcomeSheet] = useState(false)
  const [outcomeType, setOutcomeType] = useState<OutcomeType | null>(null)
  const [clientChargeMode, setClientChargeMode] = useState<OutcomeAmountMode>('none')
  const [cleanerPayMode, setCleanerPayMode] = useState<OutcomeAmountMode>('none')
  const [partialClientAmount, setPartialClientAmount] = useState('')
  const [partialCleanerAmount, setPartialCleanerAmount] = useState('')
  const [outcomeNote, setOutcomeNote] = useState('')
  const [isSavingOutcome, setIsSavingOutcome] = useState(false)
  const [activeQuickFixPanel, setActiveQuickFixPanel] = useState<QuickFixPanel>(null)
  // Convert-to-One-Time draft state — separate from the regular rate edits because the convert
  // flow runs against a different API endpoint and also changes the assigned cleaner.
  const [convertClientRate, setConvertClientRate] = useState('')
  const [convertSubcontractorRate, setConvertSubcontractorRate] = useState('')
  const [convertSubcontractorId, setConvertSubcontractorId] = useState<string>('unassigned')
  const [isConvertingToOneTime, setIsConvertingToOneTime] = useState(false)
  const [scopeDialogAction, setScopeDialogAction] = useState<ScopeDialogAction | null>(null)
  const [scopeChoice, setScopeChoice] = useState<QuickFixScope>('single')
  const [showDetails, setShowDetails] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [desktopSection, setDesktopSection] = useState<DesktopSection>('actions')

  useEffect(() => {
    if (job?.addOnServices) {
      setAddOns(job.addOnServices || [])
    } else {
      setAddOns([])
    }
  }, [job])

  useEffect(() => {
    setTrialEnabled(Boolean((job as any).isTrial))
    setTrialNotesDraft(((job as any).trialNotes as string | null) || '')
  }, [job?.id])

  // Reset ALL state when dialog closes
  useEffect(() => {
    if (!open) {
      // Reset action-in-progress flags (fixes "Saving..." stuck bug)
      setIsCompleting(false)
      setIsCancelling(false)
      setIsRestoring(false)
      setIsDeleting(false)
      setIsMarkingInvoiced(false)
      setIsSavingSubcontractor(false)
      setIsSavingTrial(false)
      setIsSavingRates(false)
      setIsSavingOutcome(false)
      setIsSavingAddOn(false)
      setIsSavingInlineDate(false)
      setIsSavingInlineTime(false)
      setMobileConfirmAction(null)
      setIsSelectingCleaner(false)
      setActiveInlinePicker(null)
      setLocalDate(null)
      setLocalTime(null)
      setQuickRescheduleLabel(null)
      setShowCancellationSheet(false)
      setCancelReason(null)
      setCancelNote('')
      setChargeFee(false)
      setFeeAmount('')
      setShowOutcomeSheet(false)
      setOutcomeType(null)
      setClientChargeMode('none')
      setCleanerPayMode('none')
      setPartialClientAmount('')
      setPartialCleanerAmount('')
      setOutcomeNote('')
      setIsEditingRates(false)
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      setScopeChoice('single')
      setSelectedSubcontractorId('')
      setShowDetails(false)
      setShowMoreActions(false)
      setDesktopSection('actions')
    }
  }, [open])

  const hasPaidInvoice = useMemo(() => {
    return jobHasPaidInvoice(job?.invoiceLineItems)
  }, [job])

  const hasFinalInvoice = useMemo(() => {
    return jobHasFinalInvoice(job?.invoiceLineItems)
  }, [job])

  const showJobUndo = (
    message: string,
    payload: UndoJobPayload,
    afterUndo?: () => void
  ) => {
    showUndoToast(message, async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          await showApiError(response, 'Failed to undo change')
          return
        }
        afterUndo?.()
        showSuccess('Change undone')
        refreshCalendarData()
      } catch {
        showError('Failed to undo change. Please try again.')
      }
    })
  }

  const confirmJobEdit = (
    title: string,
    description: string,
    confirmText = 'Save Change'
  ) => confirm({
    title,
    description,
    confirmText,
    cancelText: 'Go Back',
  })

  // ─── Desktop helpers ────────────────────────────────────────────────────────

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-green-600 bg-green-50 border-green-200'
      case 'CANCELLED': return 'text-red-600 bg-red-50 border-red-200'
      default: return 'text-blue-600 bg-blue-50 border-blue-200'
    }
  }

  // ─── Mobile helpers ──────────────────────────────────────────────────────────

  const getMobileStatusStyle = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return { bg: 'rgba(34,197,94,0.12)', text: '#16A34A', border: 'rgba(34,197,94,0.35)' }
      case 'CANCELLED':
        return { bg: 'rgba(229,57,53,0.12)', text: '#E53935', border: 'rgba(229,57,53,0.35)' }
      default:
        return { bg: 'rgba(0,168,150,0.12)', text: '#00A896', border: 'rgba(0,168,150,0.35)' }
    }
  }

  const getMobileStatusLabel = (status: string) => {
    if (status === 'SCHEDULED') return 'Scheduled'
    if (status === 'COMPLETED') return 'Completed'
    return 'Cancelled'
  }

  // ─── Shared handlers ───────────────────────────────────────────────────────

  const handleSaveTrialFields = async (nextIsTrial: boolean, nextTrialNotes: string) => {
    const previousTrialEnabled = Boolean((job as any).isTrial)
    const previousTrialNotes = ((job as any).trialNotes as string | null) || null
    const normalizedTrialNotes = nextIsTrial ? (nextTrialNotes.trim() || null) : null
    if (nextIsTrial === previousTrialEnabled && normalizedTrialNotes === previousTrialNotes) {
      return
    }

    const confirmed = await confirmJobEdit(
      nextIsTrial ? 'Mark as trial clean?' : 'Remove trial flag?',
      nextIsTrial
        ? 'This will mark this clean as a trial visit. It does not change billing logic.'
        : 'This will remove the trial marker from this clean.',
      nextIsTrial ? 'Mark Trial' : 'Remove Flag'
    )
    if (!confirmed) {
      setTrialEnabled(previousTrialEnabled)
      setTrialNotesDraft(previousTrialNotes || '')
      return
    }

    setIsSavingTrial(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTrial: nextIsTrial,
          trialNotes: normalizedTrialNotes,
        }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update trial fields')
        return
      }
      showJobUndo(nextIsTrial ? 'Marked as trial clean' : 'Removed trial flag', {
        isTrial: previousTrialEnabled,
        trialNotes: previousTrialNotes,
      }, () => {
        setTrialEnabled(previousTrialEnabled)
        setTrialNotesDraft(previousTrialNotes || '')
      })
      refreshCalendarData()
    } finally {
      setIsSavingTrial(false)
    }
  }

  const handleToggleTrial = async (next: boolean) => {
    setTrialEnabled(next)
    if (!next) setTrialNotesDraft('')
    await handleSaveTrialFields(next, next ? trialNotesDraft : '')
  }

  const handleSaveTrialNotes = async () => {
    await handleSaveTrialFields(trialEnabled, trialNotesDraft)
  }

  const handleEditSubcontractor = () => {
    setSelectedSubcontractorId(job.subcontractor?.id || 'unassigned')
    setIsEditingSubcontractor(true)
  }

  const handleSaveSubcontractor = async () => {
    const currentSubcontractorId = job.subcontractor?.id || 'unassigned'
    if (!selectedSubcontractorId || selectedSubcontractorId === currentSubcontractorId) {
      handleCancelEdit()
      return
    }
    const confirmed = await confirmJobEdit(
      'Change cleaner?',
      `This will update the cleaner for ${job.location.client.name} on ${format(new Date(job.date), 'MMM d, yyyy')}.`,
      'Change Cleaner'
    )
    if (!confirmed) return

    setIsSavingSubcontractor(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId,
        }),
      })
      if (!response.ok) throw new Error('Failed to update subcontractor')
      setIsEditingSubcontractor(false)
      showJobUndo('Cleaner updated', {
        subcontractorId: currentSubcontractorId === 'unassigned' ? null : currentSubcontractorId,
      }, () => {
        setSelectedSubcontractorId(currentSubcontractorId)
      })
      refreshCalendarData()
    } catch (error) {
      showError('Failed to update subcontractor. Please try again.')
    } finally {
      setIsSavingSubcontractor(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditingSubcontractor(false)
    setSelectedSubcontractorId('')
  }

  const handleDeleteAddOn = async (addOnId: string) => {
    const originalAddOn = addOns.find((addOn) => addOn.id === addOnId)
    setDeletingAddOnId(addOnId)
    try {
      const res = await fetch(`/api/add-on-services/${addOnId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showError(err.error || 'Failed to remove add-on')
        return
      }
      setAddOns((prev) => prev.filter((a) => a.id !== addOnId))
      if (originalAddOn) {
        showUndoToast('Add-on removed', async () => {
          try {
            const restoreResponse = await fetch('/api/add-on-services', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobId: job.id,
                description: originalAddOn.description,
                clientRate: Number(originalAddOn.clientRate || 0),
                subcontractorRate: Number(originalAddOn.subcontractorRate || 0),
              }),
            })
            if (!restoreResponse.ok) {
              await showApiError(restoreResponse, 'Failed to restore add-on')
              return
            }
            const restored = await restoreResponse.json()
            setAddOns((prev) => [...prev, restored])
            showSuccess('Add-on restored')
            refreshCalendarData()
          } catch {
            showError('Failed to restore add-on')
          }
        })
      } else {
        showSuccess('Add-on removed')
      }
    } catch {
      showError('Failed to remove add-on')
    } finally {
      setDeletingAddOnId(null)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Job?",
      description: `Are you sure you want to delete this job for ${job.location.client.name}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return
    setIsDeleting(true)
    onOpenChange(false)
    refreshCalendarData({ jobId: job.id, remove: true })
    showSuccess('Job deleted')
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
      if (!response.ok) {
        refreshCalendarData()
        showError('Failed to delete job. Please try again.')
      }
    } catch {
      refreshCalendarData()
      showError('Failed to delete job. Please try again.')
    }
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    try {
      const previousStatus = job.status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to complete job')
        setIsCompleting(false)
        return
      }
      onOpenChange(false)
      showJobUndo('Job marked as completed', { status: previousStatus })
      refreshCalendarData()
    } catch (error) {
      showError('Failed to complete job. Please try again.')
      setIsCompleting(false)
    }
  }

  const handleCancel = async () => {
    const confirmed = await confirm({
      title: "Cancel Job?",
      description: `Are you sure you want to cancel this job for ${job.location.client.name}?`,
      confirmText: "Cancel Job",
      cancelText: "Keep Scheduled",
      variant: "destructive",
    })
    if (!confirmed) return
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to cancel job')
        setIsCancelling(false)
        return
      }
      onOpenChange(false)
      const jobId = job.id
      showUndoToast('Job cancelled', async () => {
        try {
          await fetch(`/api/jobs/${jobId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'SCHEDULED' }),
          })
          refreshCalendarData()
        } catch { /* noop */ }
      })
      refreshCalendarData()
    } catch (error) {
      showError('Failed to cancel job. Please try again.')
      setIsCancelling(false)
    }
  }

  const handleRestoreCancelledClean = async () => {
    if (hasFinalInvoice || job.subcontractorPaid || isRestoring) return

    setIsRestoring(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SCHEDULED' }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to restore clean')
        return
      }

      onOpenChange(false)
      showSuccess('Clean restored')
      refreshCalendarData()
    } catch {
      showError('Failed to restore clean. Please try again.')
    } finally {
      setIsRestoring(false)
    }
  }

  const handleMarkAsInvoiced = async () => {
    if (!job) return
    const confirmed = await confirm({
      title: "Mark as Already Invoiced?",
      description: `Client: ${job.location.client.name}\nLocation: ${job.location.name}\nDate: ${format(new Date(job.date), 'MMM d, yyyy')}\n\nThis will mark this job as already invoiced.\n\nIt will no longer appear in the ready-to-bill list.\n\nUse this for historical jobs that were invoiced outside the system.`,
      confirmText: "Mark as Invoiced",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    setIsMarkingInvoiced(true)
    try {
      const response = await fetch('/api/jobs/mark-invoiced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [job.id] }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to mark job as invoiced')
      }
      showSuccess('Job marked as already invoiced')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError('Failed to mark job as invoiced. Please try again.')
    } finally {
      setIsMarkingInvoiced(false)
    }
  }

  // ─── Mobile-specific handlers ────────────────────────────────────────────────

  const handleSaveSubcontractorMobile = async (subId: string) => {
    const currentSubcontractorId = job.subcontractor?.id || 'unassigned'
    if (subId === currentSubcontractorId) {
      setIsSelectingCleaner(false)
      setActiveQuickFixPanel(null)
      return
    }

    const selectedCleanerName = subId === 'unassigned'
      ? 'Unassigned'
      : subcontractors.find((sub) => sub.id === subId)?.name || 'the selected cleaner'
    const confirmed = await confirmJobEdit(
      'Change cleaner?',
      `This will assign ${selectedCleanerName} to this clean only.`,
      'Change Cleaner'
    )
    if (!confirmed) return

    setIsSelectingCleaner(false)
    setActiveQuickFixPanel(null)
    setIsSavingSubcontractor(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcontractorId: subId === 'unassigned' ? null : subId }),
      })
      if (!response.ok) throw new Error('Failed to update cleaner')
      showJobUndo('Cleaner updated', {
        subcontractorId: currentSubcontractorId === 'unassigned' ? null : currentSubcontractorId,
      })
      refreshCalendarData({
        jobId: job.id,
        updates: { subcontractorId: subId === 'unassigned' ? null : subId },
      })
    } catch (error) {
      showError('Failed to update cleaner. Please try again.')
    } finally {
      setIsSavingSubcontractor(false)
    }
  }

  const handleConfirmCancelMobile = async () => {
    setMobileConfirmAction(null)
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to cancel job')
        setIsCancelling(false)
        return
      }
      onOpenChange(false)
      const jobId = job.id
      showUndoToast('Job cancelled', async () => {
        try {
          await fetch(`/api/jobs/${jobId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'SCHEDULED' }),
          })
          refreshCalendarData()
        } catch { /* noop */ }
      })
      refreshCalendarData()
    } catch (error) {
      showError('Failed to cancel job. Please try again.')
      setIsCancelling(false)
    }
  }

  const handleConfirmDeleteMobile = async () => {
    setMobileConfirmAction(null)
    setIsDeleting(true)
    onOpenChange(false)
    refreshCalendarData({ jobId: job.id, remove: true })
    showSuccess('Job deleted')
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
      if (!response.ok) {
        refreshCalendarData()
        showError('Failed to delete job. Please try again.')
      }
    } catch {
      refreshCalendarData()
      showError('Failed to delete job. Please try again.')
    }
  }

  // ─── Inline picker handlers ───────────────────────────────────────────────────

  const canEditDateTime = !hasFinalInvoice && !job.subcontractorPaid
  const canUseQuickFixes = job.status !== 'CANCELLED'
  const canShowFutureScope = Boolean(job.scheduleId && job.schedule)

  const weeklyLikeFrequencies = new Set([
    'WEEKLY', 'BI_WEEKLY', 'EVERY_3_WEEKS', 'EVERY_4_WEEKS', 'EVERY_6_WEEKS',
  ])

  const getDateInputValue = (value: string | Date | null | undefined) => {
    if (!value) return null
    if (typeof value === 'string') return value.slice(0, 10)
    return format(value, 'yyyy-MM-dd')
  }

  const parseDaysOfWeek = (value: string | null | undefined) => {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    } catch {
      return []
    }
  }

  const buildFutureSchedulePayload = (overrides: Partial<Record<string, unknown>>) => {
    if (!job.scheduleId || !job.schedule) {
      throw new Error('This clean is not part of a recurring schedule.')
    }

    const schedule = job.schedule as CalendarJob['schedule'] & {
      frequency: string
      daysOfWeek?: string | null
      monthlyPattern?: string | null
      startDate: string | Date
      endDate?: string | Date | null
      defaultClientRate?: number | null
      defaultSubcontractorRate?: number | null
      subcontractorPayType?: string | null
      subcontractorId?: string | null
      timeType?: string | null
      startTime?: string | null
      startWindowBegin?: string | null
      startWindowEnd?: string | null
    }

    return {
      locationId: job.location.id,
      frequency: schedule.frequency,
      daysOfWeek: schedule.daysOfWeek ?? null,
      monthlyPattern: schedule.monthlyPattern ?? null,
      startDate: getDateInputValue(schedule.startDate) || format(new Date(job.date), 'yyyy-MM-dd'),
      endDate: getDateInputValue(schedule.endDate) ?? null,
      defaultClientRate: schedule.defaultClientRate ?? job.clientRate ?? 0,
      defaultSubcontractorRate: schedule.defaultSubcontractorRate ?? job.subcontractorRate ?? 0,
      clientPayType: schedule.clientPayType ?? (job.location.client as { billingType?: string }).billingType ?? 'PER_CLEAN',
      subcontractorPayType:
        schedule.subcontractorPayType ??
        (job.location.client as { cleanerPayType?: string }).cleanerPayType ??
        'PER_CLEAN',
      subcontractorId: schedule.subcontractorId ?? null,
      timeType:
        schedule.timeType ??
        ((schedule.startTime || job.startTime) ? 'SPECIFIC' : 'WINDOW'),
      startTime: schedule.startTime ?? job.startTime ?? null,
      startWindowBegin: schedule.startWindowBegin ?? job.startWindowBegin ?? null,
      startWindowEnd: schedule.startWindowEnd ?? job.startWindowEnd ?? null,
      carryForwardRecurringAddOns: true,
      ...overrides,
    }
  }

  // Computed display values
  const displayDate = localDate || new Date(job.date)
  const displayTime = localTime !== null ? localTime : job.startTime
  const currentDateInputValue = () => format(localDate || new Date(job.date), 'yyyy-MM-dd')
  const currentTimeInputValue = () => localTime !== null ? localTime : (job.startTime || '')
  const closeQuickEdit = () => {
    setActiveInlinePicker(null)
    setActiveQuickFixPanel(null)
    setScopeDialogAction(null)
  }

  const handleQuickReschedule = (daysToAdd: number, label: 'tomorrow' | 'next-week') => {
    if (!canEditDateTime) return
    const baseDate = localDate || new Date(job.date)
    const nextDate = addDays(baseDate, daysToAdd)
    const nextDateString = format(nextDate, 'yyyy-MM-dd')
    const currentTime = localTime !== null ? localTime : (job.startTime || '')
    setDraftDate(nextDateString)
    setDraftTime(currentTime)
    setQuickRescheduleLabel(label)
    setActiveQuickFixPanel('move')
  }

  const openCleanerPicker = () => {
    if (job.subcontractorPaid) return
    setActiveQuickFixPanel(null)
    setActiveInlinePicker(null)
    setIsEditingRates(false)
    setIsSelectingCleaner(true)
  }

  const openAddOnEditor = () => {
    if (hasFinalInvoice) return
    setActiveQuickFixPanel(null)
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setIsAddingAddOn(true)
  }

  const handleOpenDatePicker = (forceOpen = false) => {
    if (!canEditDateTime) return
    setActiveQuickFixPanel(null)
    setQuickRescheduleLabel(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    if (!forceOpen && activeInlinePicker === 'date') {
      setActiveInlinePicker(null)
      return
    }
    const base = localDate || new Date(job.date)
    setDraftDate(format(base, 'yyyy-MM-dd'))
    setActiveInlinePicker('date')
  }

  const handleOpenTimePicker = () => {
    if (!canEditDateTime) return
    setActiveQuickFixPanel(null)
    setQuickRescheduleLabel(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    if (activeInlinePicker === 'time') {
      setActiveInlinePicker(null)
      return
    }
    const base = localTime !== null ? localTime : (job.startTime || '')
    setDraftTime(base)
    setActiveInlinePicker('time')
  }

  const handleSaveInlineDate = async () => {
    if (!draftDate) return
    if (draftDate === currentDateInputValue()) {
      setActiveInlinePicker(null)
      return
    }
    const confirmed = await confirmJobEdit(
      'Change clean date?',
      `Move this clean from ${format(new Date(job.date), 'MMM d, yyyy')} to ${format(new Date(`${draftDate}T12:00:00`), 'MMM d, yyyy')}?`,
      'Change Date'
    )
    if (!confirmed) return

    setIsSavingInlineDate(true)
    try {
      const previousDate = currentDateInputValue()
      const currentTime = localTime !== null ? localTime : (job.startTime || null)
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: draftDate, startTime: currentTime }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update date')
      }
      const saved = new Date(draftDate + 'T12:00:00')
      setLocalDate(saved)
      setActiveInlinePicker(null)
      setActiveQuickFixPanel(null)
      showJobUndo('Date updated', { date: previousDate, startTime: currentTime }, () => {
        setLocalDate(new Date(`${previousDate}T12:00:00`))
      })
      refreshCalendarData({
        jobId: job.id,
        updates: { date: saved.toISOString(), startTime: currentTime },
      })
    } catch (error) {
      showError('Failed to update — try again')
    } finally {
      setIsSavingInlineDate(false)
    }
  }

  const handleSaveInlineTime = async () => {
    if ((draftTime || '') === currentTimeInputValue()) {
      setActiveInlinePicker(null)
      return
    }
    const confirmed = await confirmJobEdit(
      'Change clean time?',
      `Update the time for this clean to ${draftTime ? formatTime(draftTime) : 'TBD'}?`,
      'Change Time'
    )
    if (!confirmed) return

    setIsSavingInlineTime(true)
    try {
      const base = localDate || new Date(job.date)
      const dateStr = format(base, 'yyyy-MM-dd')
      const previousTime = currentTimeInputValue() || null
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, startTime: draftTime || null }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update time')
      }
      setLocalTime(draftTime)
      setActiveInlinePicker(null)
      setActiveQuickFixPanel(null)
      showJobUndo('Time updated', { date: dateStr, startTime: previousTime }, () => {
        setLocalTime(previousTime)
      })
      refreshCalendarData({
        jobId: job.id,
        updates: { date: base.toISOString(), startTime: draftTime || null },
      })
    } catch (error) {
      showError('Failed to update — try again')
    } finally {
      setIsSavingInlineTime(false)
    }
  }

  const handleSaveQuickMoveSingle = async () => {
    if (!draftDate || isSavingInlineDate) return
    const nextTime = draftTime || null
    if (draftDate === currentDateInputValue() && (nextTime || '') === currentTimeInputValue()) {
      closeQuickEdit()
      return
    }
    if (!scopeDialogAction) {
      const confirmed = await confirmJobEdit(
        'Move this clean?',
        `This will move only this clean to ${format(new Date(`${draftDate}T12:00:00`), 'MMM d, yyyy')}${nextTime ? ` at ${formatTime(nextTime)}` : ''}.`,
        'Move Clean'
      )
      if (!confirmed) return
    }

    setIsSavingInlineDate(true)
    try {
      const previousDate = currentDateInputValue()
      const previousTime = currentTimeInputValue() || null
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: draftDate, startTime: nextTime }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to move job')
      }
      const savedDate = new Date(`${draftDate}T12:00:00`)
      setLocalDate(savedDate)
      setLocalTime(nextTime)
      setActiveQuickFixPanel(null)
      showJobUndo('Job moved', { date: previousDate, startTime: previousTime }, () => {
        setLocalDate(new Date(`${previousDate}T12:00:00`))
        setLocalTime(previousTime)
      })
      onOpenChange(false)
      refreshCalendarData({
        jobId: job.id,
        updates: { date: savedDate.toISOString(), startTime: nextTime },
      })
    } catch {
      showError('Failed to move job — try again')
    } finally {
      setIsSavingInlineDate(false)
    }
  }

  const handleSaveQuickMoveFuture = async () => {
    if (!draftDate || isSavingInlineDate) return
    if (!job.scheduleId || !job.schedule) {
      await handleSaveQuickMoveSingle()
      return
    }
    const schedule = job.schedule as { frequency?: string; daysOfWeek?: string | null }
    const selectedDate = new Date(`${draftDate}T12:00:00`)
    if (!weeklyLikeFrequencies.has(schedule.frequency || '')) {
      showError('For monthly or custom schedules, use the full schedule editor for future changes.')
      return
    }
    const existingDays = parseDaysOfWeek(schedule.daysOfWeek)
    const currentDay = new Date(job.date).getDay()
    const newDay = selectedDate.getDay()
    const nextDays = existingDays.length
      ? Array.from(new Set(existingDays.map((day) => (day === currentDay ? newDay : day)))).sort((a, b) => a - b)
      : [newDay]

    setIsSavingInlineDate(true)
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFutureSchedulePayload({
            startDate: draftDate,
            daysOfWeek: JSON.stringify(nextDays),
            timeType: 'SPECIFIC',
            startTime: draftTime || null,
            startWindowBegin: null,
            startWindowEnd: null,
          })
        ),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update future schedule')
        return
      }
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showSuccess('Future schedule updated')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingInlineDate(false)
    }
  }

  // ─── Inline rate editor handlers ─────────────────────────────────────────────

  const canEditRates = !hasFinalInvoice && !job.subcontractorPaid && job.status !== 'CANCELLED'

  const handleOpenRateEditor = (forceOpen = false) => {
    if (!canEditRates) return
    setActiveQuickFixPanel(null)
    setIsSelectingCleaner(false)
    setActiveInlinePicker(null)
    if (!forceOpen && isEditingRates) {
      setIsEditingRates(false)
      return
    }
    setDraftClientRate(String(job.clientRate ?? ''))
    setDraftSubcontractorRate(String(job.subcontractorRate ?? ''))
    setIsEditingRates(true)
  }

  const handleQuickFixMove = () => {
    if (!canEditDateTime) return
    const baseDate = localDate || new Date(job.date)
    setDraftDate(format(baseDate, 'yyyy-MM-dd'))
    setDraftTime(localTime !== null ? localTime : (job.startTime || ''))
    setQuickRescheduleLabel(null)
    setIsSelectingCleaner(false)
    setActiveInlinePicker(null)
    setIsEditingRates(false)
    setIsAddingAddOn(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('move')
  }

  const handleQuickFixCleaner = () => {
    if (job.subcontractorPaid || isSavingSubcontractor) return
    setSelectedSubcontractorId(job.subcontractor?.id || 'unassigned')
    setActiveInlinePicker(null)
    setIsEditingRates(false)
    setIsAddingAddOn(false)
    setIsSelectingCleaner(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('cleaner')
  }

  const handleQuickFixClientRate = () => {
    if (!canEditRates) return
    setDraftClientRate(String(job.clientRate ?? ''))
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsAddingAddOn(false)
    setIsEditingRates(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('client-rate')
  }

  const handleQuickFixCleanerPay = () => {
    if (!canEditRates) return
    setDraftSubcontractorRate(String(job.subcontractorRate ?? ''))
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsAddingAddOn(false)
    setIsEditingRates(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('cleaner-pay')
  }

  const handleQuickFixAddOn = () => {
    if (hasFinalInvoice) return
    setNewAddOn({ description: '', clientRate: '', subcontractorRate: '' })
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setIsAddingAddOn(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('addon')
  }

  const handleQuickFixSchedule = () => {
    if (!job.scheduleId || !job.schedule) return
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setIsAddingAddOn(false)
    setShowCancellationSheet(false)
    setShowOutcomeSheet(false)
    setScopeDialogAction(null)
    setActiveQuickFixPanel('schedule')
  }

  // ── Convert to One-Time ─────────────────────────────────────────────────────────────────
  // Opens the convert sub-panel. Pre-fills with current rates and cleaner so the VA just clicks
  // "Convert" if nothing needs to change. Refuses if the job is finalized.
  const handleQuickFixConvert = () => {
    if (!job.scheduleId || !job.schedule) return
    if (hasFinalInvoice || job.subcontractorPaid) return
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setIsAddingAddOn(false)
    setShowCancellationSheet(false)
    setShowOutcomeSheet(false)
    setScopeDialogAction(null)
    setConvertClientRate(String(Number(job.clientRate || 0)))
    setConvertSubcontractorRate(String(Number(job.subcontractorRate || 0)))
    setConvertSubcontractorId(job.subcontractorId || 'unassigned')
    setActiveQuickFixPanel('convert')
  }

  const handleConfirmConvert = async () => {
    if (isConvertingToOneTime) return
    const nextClientRate = parseFloat(convertClientRate)
    const nextSubRate = parseFloat(convertSubcontractorRate)
    if (isNaN(nextClientRate) || nextClientRate < 0 || isNaN(nextSubRate) || nextSubRate < 0) {
      showError('Enter valid rates before converting.')
      return
    }
    const confirmed = await confirmJobEdit(
      'Convert this clean to one-time?',
      'This will permanently end the recurring schedule from this date forward and remove all uninvoiced future cleans. This cannot be undone.'
    )
    if (!confirmed) return

    setIsConvertingToOneTime(true)
    try {
      const subId = convertSubcontractorId === 'unassigned' ? null : convertSubcontractorId
      const response = await fetch(`/api/jobs/${job.id}/convert-to-one-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRate: nextClientRate,
          subcontractorRate: nextSubRate,
          subcontractorId: subId,
        }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to convert clean')
        return
      }
      const result = await response.json()
      const removed = result?.futureJobsRemoved ?? 0
      showSuccess(`Converted to one-time${removed > 0 ? ` · ${removed} future clean${removed === 1 ? '' : 's'} removed` : ''}`)
      setActiveQuickFixPanel(null)
      onOpenChange(false)
      // Refresh calendar / page data so the converted job and the cleared future cleans are visible
      try { (globalThis as any)?.window && (await import('swr')).mutate('/api/calendar/data') } catch { /* noop */ }
    } catch {
      showError('Failed to convert clean. Please try again.')
    } finally {
      setIsConvertingToOneTime(false)
    }
  }

  const handleSaveRatesSingle = async () => {
    const newClientRate = parseFloat(draftClientRate)
    const newSubRate = parseFloat(draftSubcontractorRate)
    if (isNaN(newClientRate) || isNaN(newSubRate)) return
    if (newClientRate === Number(job.clientRate || 0) && newSubRate === Number(job.subcontractorRate || 0)) {
      setIsEditingRates(false)
      closeQuickEdit()
      return
    }
    if (!scopeDialogAction) {
      const confirmed = await confirmJobEdit(
        'Change this clean\'s rates?',
        `Client price will be ${formatCurrency(newClientRate)} and cleaner pay will be ${formatCurrency(newSubRate)} for this clean only.`,
        'Change Rates'
      )
      if (!confirmed) return
    }

    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRate: newClientRate, subcontractorRate: newSubRate }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update rates')
      }
      setIsEditingRates(false)
      setActiveQuickFixPanel(null)
      showJobUndo('Rates updated', {
        clientRate: Number(job.clientRate || 0),
        subcontractorRate: Number(job.subcontractorRate || 0),
      })
      refreshCalendarData({
        jobId: job.id,
        updates: { clientRate: newClientRate, subcontractorRate: newSubRate },
      })
    } catch {
      showError('Failed to update rates — try again')
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveClientRateSingle = async () => {
    const newClientRate = parseFloat(draftClientRate)
    if (isNaN(newClientRate)) return
    if (newClientRate === Number(job.clientRate || 0)) {
      closeQuickEdit()
      return
    }
    if (!scopeDialogAction) {
      const confirmed = await confirmJobEdit(
        'Change client price?',
        `Client price will be ${formatCurrency(newClientRate)} for this clean only.`,
        'Change Price'
      )
      if (!confirmed) return
    }

    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRate: newClientRate, subcontractorRate: job.subcontractorRate }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update client price')
      }
      setActiveQuickFixPanel(null)
      showJobUndo('Client price updated', { clientRate: Number(job.clientRate || 0) })
      refreshCalendarData({ jobId: job.id, updates: { clientRate: newClientRate } })
    } catch {
      showError('Failed to update client price — try again')
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveClientRateFuture = async () => {
    const newClientRate = parseFloat(draftClientRate)
    if (isNaN(newClientRate)) return
    if (newClientRate === Number(job.schedule?.defaultClientRate ?? job.clientRate ?? 0)) {
      closeQuickEdit()
      return
    }
    if (!job.scheduleId || !job.schedule) {
      await handleSaveClientRateSingle()
      return
    }
    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFutureSchedulePayload({
            startDate: format(displayDate, 'yyyy-MM-dd'),
            defaultClientRate: newClientRate,
            defaultSubcontractorRate: job.schedule?.defaultSubcontractorRate ?? job.subcontractorRate ?? 0,
          })
        ),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update future client price')
        return
      }
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showSuccess('Future client price updated')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveCleanerPaySingle = async () => {
    const newSubRate = parseFloat(draftSubcontractorRate)
    if (isNaN(newSubRate)) return
    if (newSubRate === Number(job.subcontractorRate || 0)) {
      closeQuickEdit()
      return
    }
    if (!scopeDialogAction) {
      const confirmed = await confirmJobEdit(
        'Change cleaner pay?',
        `Cleaner pay will be ${formatCurrency(newSubRate)} for this clean only.`,
        'Change Pay'
      )
      if (!confirmed) return
    }

    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRate: job.clientRate, subcontractorRate: newSubRate }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update cleaner pay')
      }
      setActiveQuickFixPanel(null)
      showJobUndo('Cleaner pay updated', { subcontractorRate: Number(job.subcontractorRate || 0) })
      refreshCalendarData({ jobId: job.id, updates: { subcontractorRate: newSubRate } })
    } catch {
      showError('Failed to update cleaner pay — try again')
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveCleanerPayFuture = async () => {
    const newSubRate = parseFloat(draftSubcontractorRate)
    if (isNaN(newSubRate)) return
    if (newSubRate === Number(job.schedule?.defaultSubcontractorRate ?? job.subcontractorRate ?? 0)) {
      closeQuickEdit()
      return
    }
    if (!job.scheduleId || !job.schedule) {
      await handleSaveCleanerPaySingle()
      return
    }
    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFutureSchedulePayload({
            startDate: format(displayDate, 'yyyy-MM-dd'),
            defaultClientRate: job.schedule?.defaultClientRate ?? job.clientRate ?? 0,
            defaultSubcontractorRate: newSubRate,
          })
        ),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update future cleaner pay')
        return
      }
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showSuccess('Future cleaner pay updated')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveRates = handleSaveRatesSingle

  const handleSaveRatesFuture = async () => {
    const newClientRate = parseFloat(draftClientRate)
    const newSubRate = parseFloat(draftSubcontractorRate)
    if (isNaN(newClientRate) || isNaN(newSubRate)) return
    if (
      newClientRate === Number(job.schedule?.defaultClientRate ?? job.clientRate ?? 0) &&
      newSubRate === Number(job.schedule?.defaultSubcontractorRate ?? job.subcontractorRate ?? 0)
    ) {
      closeQuickEdit()
      return
    }
    if (!job.scheduleId || !job.schedule) {
      await handleSaveRatesSingle()
      return
    }
    setIsSavingRates(true)
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFutureSchedulePayload({
            startDate: format(displayDate, 'yyyy-MM-dd'),
            defaultClientRate: newClientRate,
            defaultSubcontractorRate: newSubRate,
          })
        ),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update future prices')
        return
      }
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showSuccess('Future prices updated')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingRates(false)
    }
  }

  const handleSaveAddOnSingle = async () => {
    if (!newAddOn.description || !newAddOn.clientRate || isSavingAddOn) return
    setIsSavingAddOn(true)
    try {
      const response = await fetch('/api/add-on-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          description: newAddOn.description,
          clientRate: parseFloat(newAddOn.clientRate),
          subcontractorRate: parseFloat(newAddOn.subcontractorRate || '0'),
          vendorId: newAddOn.vendorId || null,
        }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create add-on')
      }
      const created = await response.json()
      setAddOns(prev => [...prev, created])
      showUndoToast('Add-on service added', async () => {
        try {
          const undoResponse = await fetch(`/api/add-on-services/${created.id}`, { method: 'DELETE' })
          if (!undoResponse.ok) {
            await showApiError(undoResponse, 'Failed to undo add-on')
            return
          }
          setAddOns(prev => prev.filter((addOn) => addOn.id !== created.id))
          showSuccess('Add-on removed')
          refreshCalendarData()
        } catch {
          showError('Failed to undo add-on')
        }
      })
      setNewAddOn({ description: '', clientRate: '', subcontractorRate: '' })
      setIsAddingAddOn(false)
      setActiveQuickFixPanel(null)
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingAddOn(false)
    }
  }

  const handleSaveAddOnFuture = async () => {
    if (!newAddOn.description || !newAddOn.clientRate || isSavingAddOn) return
    if (!job.scheduleId || !job.schedule) {
      await handleSaveAddOnSingle()
      return
    }
    setIsSavingAddOn(true)
    try {
      const clientRate = parseFloat(newAddOn.clientRate)
      const subcontractorRate = parseFloat(newAddOn.subcontractorRate || '0')

      const currentResponse = await fetch('/api/add-on-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          description: newAddOn.description,
          clientRate,
          subcontractorRate,
          vendorId: newAddOn.vendorId || null,
        }),
      })
      if (!currentResponse.ok) {
        await showApiError(currentResponse, 'Failed to add service to this clean')
        return
      }
      const recurringResponse = await fetch('/api/add-on-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: job.scheduleId,
          description: newAddOn.description,
          clientRate,
          subcontractorRate,
          frequency: job.schedule.frequency,
          isRecurring: true,
          vendorId: newAddOn.vendorId || null,
        }),
      })
      if (!recurringResponse.ok) {
        await showApiError(recurringResponse, 'Failed to add service to future cleans')
        return
      }
      showSuccess('Added to this clean and future cleans')
      setNewAddOn({ description: '', clientRate: '', subcontractorRate: '' })
      setIsAddingAddOn(false)
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingAddOn(false)
    }
  }

  const handleSaveCleanerSingle = async () => {
    if (!selectedSubcontractorId || isSavingSubcontractor) return
    const currentCleanerId = job.subcontractor?.id || 'unassigned'
    if (selectedSubcontractorId === currentCleanerId) {
      closeQuickEdit()
      return
    }
    if (!scopeDialogAction) {
      const selectedCleanerName = selectedSubcontractorId === 'unassigned'
        ? 'Unassigned'
        : subcontractors.find((sub) => sub.id === selectedSubcontractorId)?.name || 'the selected cleaner'
      const confirmed = await confirmJobEdit(
        'Change cleaner?',
        `This will assign ${selectedCleanerName} to this clean only.`,
        'Change Cleaner'
      )
      if (!confirmed) return
    }

    setIsSavingSubcontractor(true)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId }),
      })
      if (!response.ok) throw new Error('Failed to update cleaner')
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showJobUndo('Cleaner updated', {
        subcontractorId: currentCleanerId === 'unassigned' ? null : currentCleanerId,
      }, () => {
        setSelectedSubcontractorId(currentCleanerId)
      })
      onOpenChange(false)
      refreshCalendarData({
        jobId: job.id,
        updates: { subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId },
      })
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingSubcontractor(false)
    }
  }

  const handleSaveCleanerFuture = async () => {
    if (!selectedSubcontractorId || isSavingSubcontractor) return
    const currentCleanerId = job.schedule?.subcontractorId || job.subcontractor?.id || 'unassigned'
    if (selectedSubcontractorId === currentCleanerId) {
      closeQuickEdit()
      return
    }
    if (!job.scheduleId || !job.schedule) {
      await handleSaveCleanerSingle()
      return
    }
    setIsSavingSubcontractor(true)
    try {
      const response = await fetch(`/api/schedules/${job.scheduleId}/change-going-forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFutureSchedulePayload({
            startDate: format(displayDate, 'yyyy-MM-dd'),
            subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId,
          })
        ),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update future cleaner')
        return
      }
      setActiveQuickFixPanel(null)
      setScopeDialogAction(null)
      showSuccess('Future cleaner updated')
      onOpenChange(false)
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingSubcontractor(false)
    }
  }

  const quickFixHasNoChanges = () => {
    if (activeQuickFixPanel === 'move') {
      const nextTime = draftTime || ''
      return Boolean(draftDate) && draftDate === currentDateInputValue() && nextTime === currentTimeInputValue()
    }

    if (activeQuickFixPanel === 'cleaner') {
      const currentCleanerId = job.subcontractor?.id || 'unassigned'
      return Boolean(selectedSubcontractorId) && selectedSubcontractorId === currentCleanerId
    }

    if (activeQuickFixPanel === 'client-rate') {
      const newClientRate = parseFloat(draftClientRate)
      return !Number.isNaN(newClientRate) && newClientRate === Number(job.clientRate || 0)
    }

    if (activeQuickFixPanel === 'cleaner-pay') {
      const newSubcontractorRate = parseFloat(draftSubcontractorRate)
      return !Number.isNaN(newSubcontractorRate) && newSubcontractorRate === Number(job.subcontractorRate || 0)
    }

    return false
  }

  const handleQuickFixSave = async () => {
    if (!activeQuickFixPanel) return
    if (quickFixHasNoChanges()) {
      closeQuickEdit()
      return
    }
    if (canShowFutureScope && activeQuickFixPanel && activeQuickFixPanel !== 'outcome' && activeQuickFixPanel !== 'schedule' && activeQuickFixPanel !== 'convert') {
      setScopeChoice('single')
      setScopeDialogAction(activeQuickFixPanel)
      return
    }
    if (activeQuickFixPanel === 'move') { await handleSaveQuickMoveSingle(); return }
    if (activeQuickFixPanel === 'cleaner') { await handleSaveCleanerSingle(); return }
    if (activeQuickFixPanel === 'client-rate') { await handleSaveClientRateSingle(); return }
    if (activeQuickFixPanel === 'cleaner-pay') { await handleSaveCleanerPaySingle(); return }
    if (activeQuickFixPanel === 'addon') { await handleSaveAddOnSingle() }
  }

  const handleConfirmScopeChoice = async () => {
    if (!scopeDialogAction) return
    const applyFuture = scopeChoice === 'future' || scopeChoice === 'all'
    if (scopeDialogAction === 'move') {
      applyFuture ? await handleSaveQuickMoveFuture() : await handleSaveQuickMoveSingle()
      setScopeDialogAction(null)
      return
    }
    if (scopeDialogAction === 'cleaner') {
      applyFuture ? await handleSaveCleanerFuture() : await handleSaveCleanerSingle()
      setScopeDialogAction(null)
      return
    }
    if (scopeDialogAction === 'client-rate') {
      applyFuture ? await handleSaveClientRateFuture() : await handleSaveClientRateSingle()
      setScopeDialogAction(null)
      return
    }
    if (scopeDialogAction === 'cleaner-pay') {
      applyFuture ? await handleSaveCleanerPayFuture() : await handleSaveCleanerPaySingle()
      setScopeDialogAction(null)
      return
    }
    if (scopeDialogAction === 'addon') {
      applyFuture ? await handleSaveAddOnFuture() : await handleSaveAddOnSingle()
      setScopeDialogAction(null)
    }
  }

  // ─── Cancellation flow handlers ──────────────────────────────────────────────

  const handleOpenCancellationSheet = () => {
    setActiveQuickFixPanel(null)
    setScopeDialogAction(null)
    setShowOutcomeSheet(false)
    setOutcomeType(null)
    setCancelReason(null)
    setCancelNote('')
    setChargeFee(false)
    setFeeAmount('')
    setShowCancellationSheet(true)
  }

  const canApplyOutcome = !hasFinalInvoice && !job.subcontractorPaid && job.status !== 'CANCELLED'

  const handleOutcomeTypeChange = (nextOutcome: OutcomeType) => {
    setOutcomeType(nextOutcome)
    setPartialClientAmount('')
    setPartialCleanerAmount('')
    if (nextOutcome === 'skipped') {
      setClientChargeMode('none')
      setCleanerPayMode('none')
      return
    }
    if (nextOutcome === 'no-access') {
      setClientChargeMode('partial')
      setCleanerPayMode('partial')
      return
    }
    setClientChargeMode('none')
    setCleanerPayMode('none')
  }

  const handleOpenOutcomeSheet = () => {
    if (!canApplyOutcome) return
    setActiveQuickFixPanel('outcome')
    setScopeDialogAction(null)
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setShowCancellationSheet(false)
    setOutcomeNote('')
    handleOutcomeTypeChange('skipped')
    setShowOutcomeSheet(false)
  }

  const openOutcomeQuickFix = (nextOutcome: OutcomeType) => {
    if (!canApplyOutcome) return
    setActiveQuickFixPanel('outcome')
    setScopeDialogAction(null)
    setActiveInlinePicker(null)
    setIsSelectingCleaner(false)
    setIsEditingRates(false)
    setShowCancellationSheet(false)
    setOutcomeNote('')
    handleOutcomeTypeChange(nextOutcome)
    setShowOutcomeSheet(false)
  }

  const resolveOutcomeAmount = (
    mode: OutcomeAmountMode,
    partialValue: string,
    normalValue: number | null | undefined,
    label: string
  ) => {
    if (mode === 'none') return 0
    if (mode === 'normal') return normalValue ?? 0
    const parsed = parseFloat(partialValue)
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new Error(`Enter a valid ${label} amount`)
    }
    return parsed
  }

  const handleSaveOutcome = async (generalNotes: string | null | undefined) => {
    if (!outcomeType || isSavingOutcome) return
    try {
      const clientAmount = resolveOutcomeAmount(clientChargeMode, partialClientAmount, job.clientRate, 'client charge')
      const cleanerAmount = resolveOutcomeAmount(cleanerPayMode, partialCleanerAmount, job.subcontractorRate, 'cleaner pay')
      const outcomeLabel =
        outcomeType === 'skipped' ? 'Skipped'
        : outcomeType === 'no-access' ? 'No Access / No Show'
        : 'Re-clean / Make Good'

      const describeAmount = (mode: OutcomeAmountMode, amount: number, label: 'charge' | 'pay') => {
        if (mode === 'none') return label === 'charge' ? 'No charge' : 'No pay'
        if (mode === 'normal') return `Normal ${label === 'charge' ? 'charge' : 'pay'} (${formatCurrency(amount)})`
        return `Partial ${label === 'charge' ? 'charge' : 'pay'} (${formatCurrency(amount)})`
      }

      const noteLines = [
        `${outcomeLabel}:`,
        `Client charge: ${describeAmount(clientChargeMode, clientAmount, 'charge')}`,
        `Cleaner pay: ${describeAmount(cleanerPayMode, cleanerAmount, 'pay')}`,
      ]
      if (outcomeNote.trim()) noteLines.push(`Note: ${outcomeNote.trim()}`)
      if (generalNotes?.trim()) noteLines.push(`Previous notes: ${generalNotes.trim()}`)

      const updatedNotes = noteLines.join('\n')
      const nextStatus = clientAmount === 0 && cleanerAmount === 0 ? 'CANCELLED' : 'COMPLETED'
      const originalStatus = job.status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
      const originalNotes = job.notes ?? null
      const originalClientRate = job.clientRate
      const originalSubcontractorRate = job.subcontractorRate

      const confirmed = await confirmJobEdit(
        `${outcomeLabel} this clean?`,
        `This will set client charge to ${formatCurrency(clientAmount)} and cleaner pay to ${formatCurrency(cleanerAmount)}.`,
        outcomeType === 'skipped' ? 'Skip Clean' : 'Save Outcome'
      )
      if (!confirmed) return

      setIsSavingOutcome(true)
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          clientRate: clientAmount,
          subcontractorRate: cleanerAmount,
          notes: updatedNotes,
        }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to save job outcome')
        setIsSavingOutcome(false)
        return
      }
      setShowOutcomeSheet(false)
      setActiveQuickFixPanel(null)
      onOpenChange(false)
      showJobUndo(outcomeType === 'skipped' ? 'Clean skipped' : `${outcomeLabel} saved`, {
        status: originalStatus,
        clientRate: originalClientRate,
        subcontractorRate: originalSubcontractorRate,
        notes: originalNotes,
      })
      refreshCalendarData()
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setIsSavingOutcome(false)
    }
  }

  const handleCancelWithReason = async () => {
    if (!cancelReason || isCancelling) return
    setIsCancelling(true)
    const reasonLabel =
      cancelReason === 'no-access' ? "Couldn't access" :
      cancelReason === 'cleaner-unavailable' ? "Cleaner unavailable" :
      cancelReason === 'client-cancelled' ? "Client cancelled" :
      'Other'
    const cancellationNote = `Cancelled: ${reasonLabel}`
    const updatedNotes = job.notes ? `${cancellationNote}\n\n${job.notes}` : cancellationNote
    const originalStatus = job.status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
    const originalNotes = job.notes ?? null
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED', notes: updatedNotes }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to cancel job')
        setIsCancelling(false)
        return
      }
      const feeValue = chargeFee ? parseFloat(feeAmount) : 0
      if (feeValue > 0) {
        const feeResponse = await fetch('/api/jobs/cancellation-fee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: job.location.client.id,
            amount: feeValue,
            description: `Cancellation fee — ${reasonLabel} — ${format(new Date(job.date), 'MMM d, yyyy')}`,
            serviceDate: new Date(job.date).toISOString(),
          }),
        })
        if (!feeResponse.ok) {
          await showApiError(feeResponse, 'Job cancelled, but the cancellation fee was not created')
          return
        }
      }
      setShowCancellationSheet(false)
      refreshCalendarData()
      onOpenChange(false)
      if (feeValue > 0) {
        showSuccess('Job cancelled')
      } else {
        showJobUndo('Job cancelled', { status: originalStatus, notes: originalNotes })
      }
    } catch (error) {
      showError('Failed to cancel job. Please try again.')
    } finally {
      setIsCancelling(false)
    }
  }

  return {
    // Core
    confirm, ConfirmDialog,
    job, open, onOpenChange, subcontractors,

    // State
    isDeleting, isCancelling, isRestoring, isCompleting,
    isSavingTrial,
    isEditingSubcontractor, setIsEditingSubcontractor,
    selectedSubcontractorId, setSelectedSubcontractorId,
    isSavingSubcontractor,
    isMarkingInvoiced,
    trialEnabled, setTrialEnabled,
    trialNotesDraft, setTrialNotesDraft,
    addOns, setAddOns,
    isAddingAddOn, setIsAddingAddOn,
    isSavingAddOn,
    deletingAddOnId,
    editingAddOnId, setEditingAddOnId,
    newAddOn, setNewAddOn,
    editingAddOn, setEditingAddOn,
    mobileConfirmAction, setMobileConfirmAction,
    isSelectingCleaner, setIsSelectingCleaner,
    activeInlinePicker, setActiveInlinePicker,
    localDate, localTime,
    draftDate, setDraftDate,
    draftTime, setDraftTime,
    isSavingInlineDate,
    isSavingInlineTime,
    quickRescheduleLabel, setQuickRescheduleLabel,
    isEditingRates, setIsEditingRates,
    draftClientRate, setDraftClientRate,
    draftSubcontractorRate, setDraftSubcontractorRate,
    isSavingRates,
    showCancellationSheet, setShowCancellationSheet,
    cancelReason, setCancelReason,
    cancelNote, setCancelNote,
    chargeFee, setChargeFee,
    feeAmount, setFeeAmount,
    showOutcomeSheet, setShowOutcomeSheet,
    outcomeType, setOutcomeType,
    clientChargeMode, setClientChargeMode,
    cleanerPayMode, setCleanerPayMode,
    partialClientAmount, setPartialClientAmount,
    partialCleanerAmount, setPartialCleanerAmount,
    outcomeNote, setOutcomeNote,
    isSavingOutcome,
    activeQuickFixPanel, setActiveQuickFixPanel,
    scopeDialogAction, setScopeDialogAction,
    scopeChoice, setScopeChoice,
    showDetails, setShowDetails,
    showMoreActions, setShowMoreActions,
    desktopSection, setDesktopSection,

    // Computed
    hasPaidInvoice, hasFinalInvoice,
    canEditDateTime, canUseQuickFixes, canShowFutureScope,
    canEditRates, canApplyOutcome,
    displayDate, displayTime,

    // Helpers
    getStatusColor, getMobileStatusStyle, getMobileStatusLabel,

    // Handlers  
    handleToggleTrial, handleSaveTrialNotes,
    handleEditSubcontractor, handleSaveSubcontractor, handleCancelEdit,
    handleDeleteAddOn, handleDelete, handleComplete, handleCancel, handleRestoreCancelledClean,
    handleMarkAsInvoiced,
    handleSaveSubcontractorMobile, handleConfirmCancelMobile, handleConfirmDeleteMobile,
    handleQuickReschedule, openCleanerPicker, openAddOnEditor,
    handleOpenDatePicker, handleOpenTimePicker,
    handleSaveInlineDate, handleSaveInlineTime,
    handleSaveQuickMoveSingle, handleSaveQuickMoveFuture,
    handleOpenRateEditor,
    handleQuickFixMove, handleQuickFixCleaner, handleQuickFixClientRate,
    handleQuickFixCleanerPay, handleQuickFixAddOn, handleQuickFixSchedule,
    handleQuickFixConvert, handleConfirmConvert,
    convertClientRate, setConvertClientRate,
    convertSubcontractorRate, setConvertSubcontractorRate,
    convertSubcontractorId, setConvertSubcontractorId,
    isConvertingToOneTime,
    handleSaveRates, handleSaveRatesSingle, handleSaveRatesFuture,
    handleSaveClientRateSingle, handleSaveClientRateFuture,
    handleSaveCleanerPaySingle, handleSaveCleanerPayFuture,
    handleSaveAddOnSingle, handleSaveAddOnFuture,
    handleSaveCleanerSingle, handleSaveCleanerFuture,
    handleQuickFixSave, handleConfirmScopeChoice,
    handleOpenCancellationSheet, handleOutcomeTypeChange,
    handleOpenOutcomeSheet, openOutcomeQuickFix,
    handleSaveOutcome, handleCancelWithReason,
    buildFutureSchedulePayload,
  }
}

export type JobDetailState = ReturnType<typeof useJobDetail>
