"use client"

import { type ReactNode, useState, useRef, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { ScheduleForm, type ScheduleRecord } from "@/components/clients/schedule-form"
import {
  MapPin, Clock, User, DollarSign, Calendar as CalendarIcon,
  Trash2, XCircle, Edit2, Check, X, CheckCircle, Plus, FileText, ChevronLeft, Coins,
  Loader2, StickyNote, Sparkles, ChevronDown,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { refreshCalendarData } from "./calendar-client"
import { useJobDetail, type CalendarJob, type OutcomeType, type OutcomeAmountMode } from "./use-job-detail"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { Subcontractor, AddOnService } from "@/types"

interface JobDetailDialogProps {
  job: CalendarJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  subcontractors: Subcontractor[]
}

// Outer wrapper: guards the null-job case BEFORE any hooks run, so the inner component can
// always call its hooks unconditionally. Without this split, the React hook order changes
// when `job` toggles between truthy and null, which crashes the dialog at runtime.
export function JobDetailDialog(props: JobDetailDialogProps) {
  if (!props.job) return null
  // Narrowed copy: the inner component only mounts when job is non-null, so its hooks can
  // be called unconditionally without violating React's rules-of-hooks.
  return (
    <JobDetailDialogInner
      job={props.job}
      open={props.open}
      onOpenChange={props.onOpenChange}
      subcontractors={props.subcontractors}
    />
  )
}

type JobDetailDialogInnerProps = Omit<JobDetailDialogProps, 'job'> & { job: NonNullable<JobDetailDialogProps['job']> }
function JobDetailDialogInner({ job, open, onOpenChange, subcontractors }: JobDetailDialogInnerProps) {
  // All state and handlers are in the custom hook — see use-job-detail.ts.
  // Now called unconditionally because the outer wrapper guarantees `job` is non-null.
  const state = useJobDetail({ job, open, onOpenChange, subcontractors })
  // v5 Problem menu (lives in the dialog, not the hook, since it's purely UI state)
  const [problemMenuOpen, setProblemMenuOpen] = useState(false)
  const problemMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!problemMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (problemMenuRef.current && !problemMenuRef.current.contains(e.target as Node)) {
        setProblemMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [problemMenuOpen])
  // Close the menu when the dialog itself opens/closes
  useEffect(() => { if (!open) setProblemMenuOpen(false) }, [open])

  // Filter archived cleaners from assignment dropdowns, but always include the currently assigned one
  const activeSubcontractors = subcontractors.filter(s => (s as any).isActive !== false || s.id === job.subcontractor?.id)

  // Vendors for the add-on "Performed by" selector. A vendor add-on is payable via the
  // vendor list (AddOnService.vendorId); "Cleaner" means the job's primary cleaner.
  const { data: vendorData } = useSWR<Array<{ id: string; name: string }>>(open ? '/api/vendors' : null, fetcher)
  const addOnVendors = vendorData || []

  const {
    ConfirmDialog,
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
    isSavingInlineDate, isSavingInlineTime,
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
  } = state


  // ─── Render ──────────────────────────────────────────────────────────────────

  const mobileStatus = getMobileStatusStyle(job.status)
  const jobTimeDisplay = displayTime
    ? formatTime(displayTime)
    : job.startWindowBegin
      ? `${formatTime(job.startWindowBegin!)} – ${formatTime(job.startWindowEnd || '')}`
      : 'TBD'
  const recurringScheduleRecord = job.schedule as ScheduleRecord | null
  const clientBillingType = job.location.client.billingType
  const clientCleanerPayType = job.location.client.cleanerPayType

  // Status-line schedule summary (e.g. "Weekly · Thu") for recurring jobs — the handoff wants the
  // schedule here, not the location (location lives only in the info card's Location cell).
  const scheduleLine = (() => {
    if (!recurringScheduleRecord) return null
    const FREQ: Record<string, string> = { WEEKLY: 'Weekly', BI_WEEKLY: 'Bi-weekly', EVERY_3_WEEKS: 'Every 3 wks', EVERY_4_WEEKS: 'Every 4 wks', EVERY_6_WEEKS: 'Every 6 wks', MONTHLY: 'Monthly' }
    const label = FREQ[recurringScheduleRecord.frequency] || recurringScheduleRecord.frequency
    let days = ''
    try {
      const arr = JSON.parse((recurringScheduleRecord.daysOfWeek as string) || '[]')
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      if (Array.isArray(arr) && arr.length) days = arr.map((d: number) => names[d]).join(', ')
    } catch { /* ignore */ }
    return days ? `${label} · ${days}` : label
  })()

  const quickActionButtons = [
    {
      key: 'move',
      label: 'Reschedule Clean',
      icon: CalendarIcon,
      disabled: !canEditDateTime,
      onClick: handleQuickFixMove,
    },
    // Convert to One-Time chip — only shown for recurring jobs. Ends the schedule and detaches
    // this job as a standalone. Disabled if the clean is finalized (invoiced/paid).
    ...(job.scheduleId && job.schedule ? [{
      key: 'convert',
      label: 'Convert to One-Time',
      icon: Sparkles,
      disabled: hasFinalInvoice || job.subcontractorPaid,
      onClick: handleQuickFixConvert,
    }] : []),
    // 'skip' chip removed in v5 — Skip lives inside the Problem menu now (alongside No Access,
    // Cancel This Clean, and Cancel Service) so all four sit-out / cancel paths are one entry point.
    {
      key: 'cleaner',
      label: 'Change Cleaner',
      icon: User,
      disabled: hasFinalInvoice || job.subcontractorPaid || isSavingSubcontractor,
      onClick: handleQuickFixCleaner,
    },
    {
      key: 'client-rate',
      label: 'Change Client Price',
      icon: DollarSign,
      disabled: !canEditRates,
      onClick: handleQuickFixClientRate,
    },
    {
      key: 'cleaner-pay',
      label: 'Change Cleaner Pay',
      icon: Coins,
      disabled: !canEditRates,
      onClick: handleQuickFixCleanerPay,
    },
  ]

  const recurringPlanButton = {
    key: 'schedule',
    label: 'Change Schedule Going Forward',
    icon: Edit2,
    disabled: !job.scheduleId || !job.schedule,
    onClick: handleQuickFixSchedule,
  }

  // No standalone secondary chips — the v5 layout consolidates Skip / No Access / Cancel This Clean /
  // Cancel Service under a single red "Problem" chip rendered separately in renderQuickFixSection.
  const specialSituationButtons: Array<{
    key: string
    label: string
    icon: typeof XCircle
    disabled: boolean
    onClick: () => void
  }> = []

  const renderQuickFixSection = (isMobile: boolean, compact = false) => {
    if (!canUseQuickFixes) return null

    if (compact && !isMobile) {
      // v5 layout: chip-style action buttons wrapping inline, instead of a stacked list.
      // Special-situation actions (No Access) get a quieter outline. Recurring plan stays
      // bundled in so users can change the schedule from the same row of chips.
      // Order follows job_detail_clean.jsx: Reschedule · Change Schedule · Convert · Change Cleaner · Change Client Price · Change Cleaner Pay.
      const primaryChips = [
        quickActionButtons[0],
        { ...recurringPlanButton, label: 'Change Schedule' },
        ...quickActionButtons.slice(1),
      ]
      const secondaryChips = specialSituationButtons
      // Suppress the unused secondaryChips alias — the v5 layout uses the Problem button below instead.
      void secondaryChips
      const problemOptions = [
        {
          key: 'skipped',
          label: 'Skipped',
          sub: "Clean didn't happen",
          disabled: !canApplyOutcome,
          onClick: () => { setProblemMenuOpen(false); openOutcomeQuickFix('skipped') },
        },
        {
          key: 'no-access',
          label: 'No Access / No Show',
          sub: "Couldn't get in",
          disabled: !canApplyOutcome,
          onClick: () => { setProblemMenuOpen(false); openOutcomeQuickFix('no-access') },
        },
        {
          key: 'cancel-clean',
          label: 'Cancel This Clean',
          sub: 'Mark this clean as cancelled',
          disabled: !canApplyOutcome || job.status === 'CANCELLED',
          onClick: () => { setProblemMenuOpen(false); handleOpenCancellationSheet() },
        },
        {
          key: 'cancel-service',
          label: 'Cancel Service',
          sub: 'End all future recurring cleans',
          danger: true,
          disabled: !job.scheduleId || !job.schedule,
          onClick: () => { setProblemMenuOpen(false); handleQuickFixSchedule() },
        },
      ]

      return (
        <div className="space-y-3">
          {/* Peer edit actions — tidy 2-column grid (job_detail_clean.jsx) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {primaryChips.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="transition-colors hover:bg-slate-50 hover:border-slate-300 disabled:cursor-default disabled:opacity-40"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '10px 13px',
                    borderRadius: 9,
                    border: '1px solid #E2E8F0',
                    background: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 600,
                    color: action.disabled ? '#94A3B8' : '#0F172A',
                    cursor: action.disabled ? 'default' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Icon className="h-[15px] w-[15px] flex-shrink-0" style={{ color: action.disabled ? '#94A3B8' : '#0D9488' }} />
                  {action.label}
                </button>
              )
            })}
          </div>

          {/* Destructive — quiet, separated, single path. Keeps the consolidated Problem menu
              (Skip / No Access / Cancel This Clean / Cancel Service); opens upward since it sits at the bottom. */}
          <div className="relative" ref={problemMenuRef} style={{ paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <button
              onClick={() => setProblemMenuOpen(v => !v)}
              className="transition-colors hover:bg-rose-50"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 12px',
                borderRadius: 8,
                background: problemMenuOpen ? '#FEF2F2' : 'transparent',
                fontSize: 12.5,
                fontWeight: 600,
                color: '#DC2626',
                cursor: 'pointer',
              }}
            >
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#DC2626' }} />
              Problem / Cancel this clean
            </button>
            {problemMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 bottom-full z-50 mb-1 min-w-[260px] overflow-hidden rounded-xl bg-white shadow-xl"
                style={{ border: '1px solid #E2E8F0' }}
              >
                {problemOptions.map((opt, idx) => (
                  <button
                    key={opt.key}
                    onClick={opt.onClick}
                    disabled={opt.disabled}
                    className="block w-full text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-45"
                    style={{
                      padding: '10px 14px',
                      borderTop: idx === 0 ? 'none' : '1px solid #F1F5F9',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: opt.danger ? '#B91C1C' : '#0F172A',
                      }}
                    >
                      {opt.label}
                    </span>
                    <span style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginTop: 1 }}>
                      {opt.sub}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    const content = (
      <>
        <div className="grid grid-cols-2 gap-2">
          {quickActionButtons.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.key}
                onClick={action.onClick}
                disabled={action.disabled}
                className="rounded-[12px] bg-white text-left transition-all hover:bg-[#FBFBFB] disabled:cursor-default disabled:opacity-45"
                style={{
                  border: '1px solid #E7E7E1',
                  minHeight: isMobile ? '54px' : '50px',
                  padding: isMobile ? '12px 12px' : '11px 12px',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: action.disabled ? 'rgba(203,213,225,0.20)' : 'rgba(15,118,110,0.08)',
                      border: action.disabled ? '1px solid rgba(203,213,225,0.28)' : '1px solid rgba(15,118,110,0.12)',
                    }}
                  >
                    <Icon className="h-4 w-4" style={{ color: action.disabled ? '#94A3B8' : '#0F766E' }} />
                  </div>
                  <span style={{ fontSize: isMobile ? '13px' : '13px', fontWeight: 600, color: '#111111' }}>
                    {action.label}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-4">
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            Recurring Plan
          </p>
          <button
            onClick={recurringPlanButton.onClick}
            disabled={recurringPlanButton.disabled}
            className="w-full rounded-[12px] bg-white text-left transition-all hover:bg-[#FBFBFB] disabled:cursor-default disabled:opacity-45"
            style={{
              border: '1px solid #E7E7E1',
              minHeight: isMobile ? '54px' : '50px',
              padding: isMobile ? '12px 12px' : '11px 12px',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
                style={{
                  backgroundColor: recurringPlanButton.disabled ? 'rgba(203,213,225,0.20)' : 'rgba(15,118,110,0.08)',
                  border: recurringPlanButton.disabled ? '1px solid rgba(203,213,225,0.28)' : '1px solid rgba(15,118,110,0.12)',
                }}
              >
                <Edit2 className="h-4 w-4" style={{ color: recurringPlanButton.disabled ? '#94A3B8' : '#0F766E' }} />
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#111111' }}>
                  Change Schedule
                </span>
                <span style={{ display: 'block', fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                  Change frequency or recurring days from here
                </span>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-4">
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
            Special Situations
          </p>
          <div className="grid grid-cols-1 gap-2">
            {specialSituationButtons.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="rounded-[12px] bg-white text-left transition-all hover:bg-[#FBFBFB] disabled:cursor-default disabled:opacity-45"
                  style={{
                    border: '1px solid #E7E7E1',
                    minHeight: isMobile ? '54px' : '50px',
                    padding: isMobile ? '12px 12px' : '11px 12px',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: action.disabled ? 'rgba(203,213,225,0.20)' : 'rgba(15,118,110,0.08)',
                        border: action.disabled ? '1px solid rgba(203,213,225,0.28)' : '1px solid rgba(15,118,110,0.12)',
                      }}
                    >
                      <Icon className="h-4 w-4" style={{ color: action.disabled ? '#94A3B8' : '#0F766E' }} />
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#111111' }}>
                      {action.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </>
    )

    if (compact) return <div className="space-y-4">{content}</div>

    return (
      <div
        className="rounded-[16px] p-4"
        style={{
          background: isMobile
            ? 'linear-gradient(180deg, #FAFCFD 0%, #FFFFFF 100%)'
            : 'linear-gradient(180deg, #FCFCFB 0%, #FFFFFF 100%)',
          border: '1px solid #E7E7E1',
          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)',
        }}
      >
        {!compact && (
          <div className="mb-3.5 flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'rgba(15,118,110,0.10)',
                border: '1px solid rgba(15,118,110,0.12)',
              }}
            >
              <Sparkles className="h-4 w-4" style={{ color: '#0F766E' }} />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#111827', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Quick Actions
              </p>
              <p style={{ fontSize: '13px', color: '#5F6B76', marginTop: '2px' }}>
                Fastest ways to change this clean
              </p>
            </div>
          </div>
        )}

        {content}
      </div>
    )
  }

  const renderQuickFixPanel = (isMobile: boolean) => {
    if (!activeQuickFixPanel) return null

    const panelMeta = {
      move: {
        title: 'Reschedule Clean',
        description: 'Pick a new date or time.',
      },
      cleaner: {
        title: 'Change Cleaner',
        description: 'Choose who should handle this clean.',
      },
      'client-rate': {
        title: 'Change Client Price',
        description: 'Update what the client should pay for this clean.',
      },
      'cleaner-pay': {
        title: 'Change Cleaner Pay',
        description: 'Update what the cleaner should be paid for this clean.',
      },
      addon: {
        title: 'Add Add-on',
        description: 'Add an add-on to this clean.',
      },
      outcome: {
        title: 'Fix Problem With This Clean',
        description: 'Choose what happened and how to handle billing and pay.',
      },
      schedule: {
        title: 'Change Schedule Going Forward',
        description: 'Change the recurring plan starting with this clean.',
      },
      convert: {
        title: 'Convert to One-Time',
        description: 'Keep this clean as a standalone job and end the recurring schedule.',
      },
    }[activeQuickFixPanel]

    const renderQuickFixFooter = (
      primaryLabel: string,
      onPrimaryClick: () => void,
      primaryDisabled: boolean,
      busyLabel?: string,
      backDisabled = false,
    ) => (
      <div
        className="flex-shrink-0 pt-3"
        style={{
          borderTop: '1px solid rgba(15,118,110,0.08)',
        }}
      >
        <button
          onClick={onPrimaryClick}
          disabled={primaryDisabled}
          className="w-full rounded-full px-4 py-2.5 font-semibold text-white disabled:opacity-45"
          style={{ backgroundColor: '#0F766E', fontSize: '15px' }}
        >
          {backDisabled && busyLabel ? busyLabel : primaryLabel}
        </button>
      </div>
    )

    return (
      <div
        className="flex h-full min-h-0 flex-col rounded-[18px] p-4"
        style={{
          background: 'linear-gradient(180deg, #FEFFFE 0%, #F7FBFA 100%)',
          border: '1px solid rgba(15,118,110,0.16)',
          boxShadow: '0 18px 36px rgba(15, 23, 42, 0.07)',
        }}
      >
        <div className="mb-3 flex-shrink-0">
          <div>
            <button
              onClick={() => setActiveQuickFixPanel(null)}
              className="mb-3 inline-flex items-center gap-1 rounded-full transition-colors hover:text-[#0B5F59]"
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#0F766E',
              }}
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <p style={{ fontSize: isMobile ? '22px' : '20px', fontWeight: 800, color: '#111827', lineHeight: 1.1 }}>
              {panelMeta.title}
            </p>
            <p style={{ fontSize: isMobile ? '14px' : '13px', color: '#5F6B76', marginTop: '6px' }}>{panelMeta.description}</p>
          </div>
        </div>

        {activeQuickFixPanel === 'move' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'block' }}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={(e) => {
                      setQuickRescheduleLabel(null)
                      setDraftDate(e.target.value)
                    }}
                    disabled={isSavingInlineDate}
                    className="w-full rounded-[12px] bg-white px-3 py-2.5 outline-none"
                    style={{ fontSize: '15px', color: '#111111', border: '1px solid #D9E3E1', colorScheme: 'light' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'block' }}>
                    Time
                  </label>
                  <select
                    value={draftTime}
                    onChange={(e) => {
                      setQuickRescheduleLabel(null)
                      setDraftTime(e.target.value)
                    }}
                    disabled={isSavingInlineDate}
                    className="w-full rounded-[12px] bg-white px-3 py-2.5 outline-none"
                    style={{ fontSize: '15px', color: '#111111', border: '1px solid #D9E3E1', colorScheme: 'light', height: '42px' }}
                  >
                    <option value="">No time set</option>
                    {Array.from({ length: 24 * 4 }, (_, i) => {
                      const h = Math.floor(i / 4)
                      const m = (i % 4) * 15
                      const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                      const ampm = h < 12 ? 'AM' : 'PM'
                      return <option key={val} value={val}>{h12}:{String(m).padStart(2, '0')} {ampm}</option>
                    })}
                  </select>
                </div>
              </div>

              <div>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Fast Reschedule
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleQuickReschedule(1, 'tomorrow')}
                    disabled={isSavingInlineDate}
                    className="rounded-full bg-white px-4 py-2 font-semibold disabled:opacity-45"
                    style={{
                      border: quickRescheduleLabel === 'tomorrow' ? '1px solid #0F766E' : '1px solid #D9E3E1',
                      fontSize: '14px',
                      color: quickRescheduleLabel === 'tomorrow' ? '#0F766E' : '#111827',
                    }}
                  >
                    Tomorrow
                  </button>
                  <button
                    onClick={() => handleQuickReschedule(7, 'next-week')}
                    disabled={isSavingInlineDate}
                    className="rounded-full bg-white px-4 py-2 font-semibold disabled:opacity-45"
                    style={{
                      border: quickRescheduleLabel === 'next-week' ? '1px solid #0F766E' : '1px solid #D9E3E1',
                      fontSize: '14px',
                      color: quickRescheduleLabel === 'next-week' ? '#0F766E' : '#111827',
                    }}
                  >
                    Next Week
                  </button>
                </div>
              </div>
            </div>
            {renderQuickFixFooter(
              canShowFutureScope ? 'Continue' : 'Save Move',
              handleQuickFixSave,
              !draftDate || isSavingInlineDate,
              isSavingInlineDate ? 'Saving…' : undefined,
              isSavingInlineDate
            )}
          </div>
        )}

        {activeQuickFixPanel === 'cleaner' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="rounded-[12px] overflow-hidden bg-white" style={{ border: '1px solid #D9E3E1' }}>
                <button onClick={() => setSelectedSubcontractorId('unassigned')} className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-[#F7FAFA] transition-colors" style={{ borderBottom: '1px solid #EEF2F1' }}>
                  <span className="font-medium" style={{ fontSize: '14px', color: selectedSubcontractorId === 'unassigned' ? '#0F766E' : '#111111' }}>Unassigned</span>
                  {selectedSubcontractorId === 'unassigned' && <Check className="h-4 w-4" style={{ color: '#0F766E' }} />}
                </button>
                {activeSubcontractors.map((sub) => (
                  <button key={sub.id} onClick={() => setSelectedSubcontractorId(sub.id)} className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-[#F7FAFA] transition-colors" style={{ borderBottom: '1px solid #EEF2F1' }}>
                    <div>
                      <p className="font-medium" style={{ fontSize: '14px', color: selectedSubcontractorId === sub.id ? '#0F766E' : '#111111' }}>{sub.name}</p>
                      {sub.phone && <p style={{ fontSize: '13px', color: '#6B7280' }}>{sub.phone}</p>}
                    </div>
                    {selectedSubcontractorId === sub.id && <Check className="h-4 w-4 flex-shrink-0" style={{ color: '#0F766E' }} />}
                  </button>
                ))}
              </div>
            </div>
            {renderQuickFixFooter(
              canShowFutureScope ? 'Continue' : 'Save Cleaner',
              handleQuickFixSave,
              !selectedSubcontractorId || isSavingSubcontractor,
              isSavingSubcontractor ? 'Saving…' : undefined,
              isSavingSubcontractor
            )}
          </div>
        )}

        {activeQuickFixPanel === 'client-rate' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'block' }}>
                  Client Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={draftClientRate}
                  onChange={(e) => setDraftClientRate(e.target.value)}
                  disabled={isSavingRates}
                  className="w-full rounded-[12px] bg-white px-3 py-2.5 outline-none"
                  style={{ fontSize: '15px', color: '#111111', border: '1px solid #D9E3E1' }}
                />
              </div>
              <div className="rounded-[12px] bg-white px-3 py-3" style={{ border: '1px solid #D9E3E1' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                  Cleaner Pay Stays
                </p>
                <p style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                  {formatCurrency(job.subcontractorRate ?? 0)}
                </p>
              </div>
            </div>
            {renderQuickFixFooter(
              canShowFutureScope ? 'Continue' : 'Save Client Price',
              handleQuickFixSave,
              isSavingRates || !draftClientRate,
              isSavingRates ? 'Saving…' : undefined,
              isSavingRates
            )}
          </div>
        )}

        {activeQuickFixPanel === 'cleaner-pay' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'block' }}>
                  Cleaner Pay
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={draftSubcontractorRate}
                  onChange={(e) => setDraftSubcontractorRate(e.target.value)}
                  disabled={isSavingRates}
                  className="w-full rounded-[12px] bg-white px-3 py-2.5 outline-none"
                  style={{ fontSize: '15px', color: '#111111', border: '1px solid #D9E3E1' }}
                />
              </div>
              <div className="rounded-[12px] bg-white px-3 py-3" style={{ border: '1px solid #D9E3E1' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                  Client Price Stays
                </p>
                <p style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>
                  {formatCurrency(job.clientRate ?? 0)}
                </p>
              </div>
            </div>
            {renderQuickFixFooter(
              canShowFutureScope ? 'Continue' : 'Save Cleaner Pay',
              handleQuickFixSave,
              isSavingRates || !draftSubcontractorRate,
              isSavingRates ? 'Saving…' : undefined,
              isSavingRates
            )}
          </div>
        )}

        {activeQuickFixPanel === 'addon' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
              <Input
                value={newAddOn.description}
                onChange={(e) => setNewAddOn({ ...newAddOn, description: e.target.value })}
                placeholder="Add-on name"
                className="text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  value={newAddOn.clientRate}
                  onChange={(e) => setNewAddOn({ ...newAddOn, clientRate: e.target.value })}
                  placeholder="Client price"
                  className="text-sm"
                />
                <Input
                  type="number"
                  value={newAddOn.subcontractorRate}
                  onChange={(e) => setNewAddOn({ ...newAddOn, subcontractorRate: e.target.value })}
                  placeholder="Cleaner pay"
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block text-[11px] text-stone-500">Performed by</Label>
                <select
                  value={newAddOn.vendorId || ''}
                  onChange={(e) => setNewAddOn({ ...newAddOn, vendorId: e.target.value })}
                  className="h-9 w-full rounded-md border border-stone-200 bg-white px-2 text-sm text-stone-800 outline-none focus:border-teal-500"
                >
                  <option value="">Cleaner (same as job)</option>
                  {addOnVendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-stone-400">Pick a vendor to bill their pay through the vendor list.</p>
              </div>
            </div>
            {renderQuickFixFooter(
              canShowFutureScope ? 'Continue' : 'Save Service',
              handleQuickFixSave,
              !newAddOn.description || !newAddOn.clientRate,
            )}
          </div>
        )}

        {activeQuickFixPanel === 'outcome' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="space-y-2">
                {[
                  { id: 'skipped', label: 'Skipped' },
                  { id: 'no-access', label: 'No Access / No Show' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleOutcomeTypeChange(option.id as OutcomeType)}
                    className="w-full rounded-[14px] bg-white px-4 py-3 text-left transition-colors hover:bg-[#F9FBFB]"
                    style={{
                      border: outcomeType === option.id ? '2px solid #0F766E' : '1px solid #D9E3E1',
                      boxShadow: outcomeType === option.id ? '0 0 0 3px rgba(15,118,110,0.08)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: '15px', fontWeight: 600, color: outcomeType === option.id ? '#0F766E' : '#111827' }}>
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>

              <div className="grid gap-4">
                {renderOutcomeModeButtons('Client Charge', clientChargeMode, setClientChargeMode)}
                {clientChargeMode === 'partial' && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={partialClientAmount}
                    onChange={(e) => setPartialClientAmount(e.target.value)}
                    placeholder={`Enter client amount (normal ${formatCurrency(job.clientRate ?? 0)})`}
                  />
                )}

                {renderOutcomeModeButtons('Cleaner Pay', cleanerPayMode, setCleanerPayMode)}
                {cleanerPayMode === 'partial' && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={partialCleanerAmount}
                    onChange={(e) => setPartialCleanerAmount(e.target.value)}
                    placeholder={`Enter cleaner pay (normal ${formatCurrency(job.subcontractorRate ?? 0)})`}
                  />
                )}

                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                    Note
                  </p>
                  <textarea
                    value={outcomeNote}
                    onChange={(e) => setOutcomeNote(e.target.value)}
                    placeholder="Optional note for why this happened"
                    rows={2}
                    className="w-full rounded-[12px] px-3 py-2 outline-none resize-none"
                    style={{ border: '1px solid #D9E3E1', fontSize: '14px', color: '#111111' }}
                  />
                </div>
              </div>
            </div>
            {renderQuickFixFooter(
              'Save Problem',
              () => handleSaveOutcome(generalNotes),
              !outcomeType || isSavingOutcome,
              isSavingOutcome ? 'Saving…' : undefined,
              isSavingOutcome
            )}
          </div>
        )}

        {activeQuickFixPanel === 'schedule' && recurringScheduleRecord && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <ScheduleForm
              locationId={job.location.id}
              clientBillingType={clientBillingType}
              clientCleanerPayType={clientCleanerPayType}
              schedule={recurringScheduleRecord}
              mode="future"
              futureStartDate={displayDate}
              embedded={true}
              onSuccess={() => {
                setActiveQuickFixPanel(null)
                onOpenChange(false)
                refreshCalendarData()
              }}
              onCancel={() => setActiveQuickFixPanel(null)}
            />
          </div>
        )}

        {/* Convert to One-Time — ends the recurring schedule and detaches this job as standalone */}
        {activeQuickFixPanel === 'convert' && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-3">
            <div
              className="rounded-[10px] p-3"
              style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}
            >
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#991B1B', marginBottom: '4px' }}>
                All future recurring cleans will be removed
              </p>
              <p style={{ fontSize: '12px', color: '#7F1D1D', lineHeight: 1.4 }}>
                This clean becomes standalone with its own rates and (optionally) a different cleaner.
                Future uninvoiced cleans on this recurring schedule will be deleted. This can&apos;t be undone.
              </p>
            </div>

            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Client rate (this clean)</Label>
              <div className="relative">
                <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={convertClientRate}
                  onChange={e => setConvertClientRate(e.target.value)}
                  className="h-10 pl-7 text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cleaner pay (this clean)</Label>
              <div className="relative">
                <Coins className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={convertSubcontractorRate}
                  onChange={e => setConvertSubcontractorRate(e.target.value)}
                  className="h-10 pl-7 text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assigned cleaner</Label>
              <Select value={convertSubcontractorId} onValueChange={setConvertSubcontractorId}>
                <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned"><span className="text-amber-700">Unassigned</span></SelectItem>
                  {activeSubcontractors.map(cleaner => (
                    <SelectItem key={cleaner.id} value={cleaner.id}>{cleaner.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveQuickFixPanel(null)}
                disabled={isConvertingToOneTime}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmConvert}
                disabled={isConvertingToOneTime}
                className="rounded-md px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: '#DC2626' }}
              >
                {isConvertingToOneTime ? 'Converting…' : 'Convert & Remove Future Cleans'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderSummaryCard = (label: string, value: string, isMobile: boolean, muted = false, accentColor?: string) => (
    <div
      className="rounded-[14px] bg-white"
      style={{
        border: '1px solid #E7E7E1',
        padding: isMobile ? '12px 14px' : '14px 16px',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        {accentColor && (
          <span aria-hidden="true" style={{ flexShrink: 0, width: '8px', height: '8px', borderRadius: '50%', backgroundColor: accentColor }} />
        )}
        <p style={{ fontSize: isMobile ? '14px' : '13px', fontWeight: 600, color: muted ? '#6B7280' : '#111827', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
          {value}
        </p>
      </div>
    </div>
  )

  const renderBillingBadgeCard = (label: string, payType: string, colorScheme: 'blue' | 'purple', isMobile: boolean) => {
    const isFR = payType === 'FLAT_RATE'
    const badgeLabel = isFR ? 'Flat Rate' : 'Per Clean'
    const badgeCode = isFR ? 'FR' : 'PC'
    const colors = colorScheme === 'blue'
      ? { bg: isFR ? 'rgba(59,130,246,0.10)' : 'rgba(107,114,128,0.08)', color: isFR ? '#3B82F6' : '#6B7280', border: isFR ? 'rgba(59,130,246,0.20)' : 'rgba(107,114,128,0.15)' }
      : { bg: isFR ? 'rgba(168,85,247,0.10)' : 'rgba(107,114,128,0.08)', color: isFR ? '#A855F7' : '#6B7280', border: isFR ? 'rgba(168,85,247,0.20)' : 'rgba(107,114,128,0.15)' }
    return (
      <div
        className="rounded-[14px] bg-white"
        style={{
          border: '1px solid #E7E7E1',
          padding: isMobile ? '12px 14px' : '14px 16px',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
        }}
      >
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
          {label}
        </p>
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
              padding: '2px 8px', borderRadius: '5px',
              backgroundColor: colors.bg, color: colors.color,
              border: `1px solid ${colors.border}`,
            }}
          >{badgeCode}</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{badgeLabel}</span>
        </div>
      </div>
    )
  }

  const renderSummarySection = (isMobile: boolean) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {renderSummaryCard('Date', format(displayDate, isMobile ? 'EEE, MMM d' : 'EEE, MMM d, yyyy'), isMobile)}
        {renderSummaryCard('Time', jobTimeDisplay, isMobile)}
        {renderSummaryCard('Cleaner', job.subcontractor?.name || 'Unassigned', isMobile, !job.subcontractor, job.subcontractor ? getCleanerColorInfo(job.subcontractor.name).hex : undefined)}
        {renderSummaryCard('Client Price', formatCurrency(job.clientRate ?? 0), isMobile)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderSummaryCard('Cleaner Pay', formatCurrency(job.subcontractorRate ?? 0), isMobile)}
        {renderSummaryCard('Margin', formatCurrency((job.clientRate ?? 0) - (job.subcontractorRate ?? 0)), isMobile)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderBillingBadgeCard('Client Billing', clientBillingType, 'blue', isMobile)}
        {renderBillingBadgeCard('Cleaner Pay Type', clientCleanerPayType, 'purple', isMobile)}
      </div>
    </div>
  )

  const renderCompactFact = (label: string, value: ReactNode, tone: 'default' | 'muted' | 'profit' = 'default') => (
    <div className="min-w-0">
      <p style={{ fontSize: '11px', fontWeight: 700, color: '#8A95A3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>
        {label}
      </p>
      <p
        title={typeof value === 'string' ? value : undefined}
        style={{
          fontSize: '15px',
          fontWeight: 700,
          color: tone === 'muted' ? '#6B7280' : tone === 'profit' ? '#0D9488' : '#111827',
          lineHeight: 1.25,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </p>
    </div>
  )

  const renderDesktopOverviewSection = () => {
    const margin = (job.clientRate ?? 0) - (job.subcontractorRate ?? 0)
    const addOnsTotal = (addOns || []).reduce((sum, a) => sum + (a.clientRate ?? 0), 0)
    const locationSummary = job.location.address
      ? `${job.location.name} - ${job.location.address}`
      : job.location.name || 'No location set'

    return (
      <div className="space-y-0 overflow-hidden rounded-[10px] bg-white" style={{ border: '1px solid #E4E7EC' }}>
        {/* v5 click-to-edit — both Date and Time cells open the Move panel where the VA can pick a new
            date/time. Visual cue on hover so users discover the affordance. */}
        <div className="grid grid-cols-2 gap-0 border-b border-[#EEF0F3]">
          <button
            type="button"
            onClick={canEditDateTime ? handleQuickFixMove : undefined}
            disabled={!canEditDateTime}
            className="text-left transition-colors hover:enabled:bg-[#FAFBFC] disabled:cursor-default border-r border-[#EEF0F3] px-4 py-3"
          >
            {renderCompactFact('Date', format(displayDate, 'EEE, MMM d, yyyy'))}
          </button>
          <button
            type="button"
            onClick={canEditDateTime ? handleQuickFixMove : undefined}
            disabled={!canEditDateTime}
            className="text-left transition-colors hover:enabled:bg-[#FAFBFC] disabled:cursor-default px-4 py-3"
          >
            {renderCompactFact('Time', jobTimeDisplay)}
          </button>
        </div>

        {/* v5 compact pricing bar — inline Client | Pay | Margin | Add-ons */}
        <div className="border-b border-[#EEF0F3] px-3 py-2">
          <div className="flex items-center gap-3 rounded-md px-3 py-1.5" style={{ background: '#F8FAFC' }}>
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Client </span>
              <span className="font-mono text-[14px] font-bold text-slate-900">{formatCurrency(job.clientRate ?? 0)}</span>
            </div>
            <span aria-hidden="true" className="h-4 w-px bg-slate-200" />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pay </span>
              <span className="font-mono text-[14px] font-bold text-slate-900">{formatCurrency(job.subcontractorRate ?? 0)}</span>
            </div>
            <span aria-hidden="true" className="h-4 w-px bg-slate-200" />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Margin </span>
              <span className={`font-mono text-[14px] font-bold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatCurrency(margin)}</span>
            </div>
            {addOnsTotal > 0 && (
              <>
                <span aria-hidden="true" className="h-4 w-px bg-slate-200" />
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Add-ons </span>
                  <span className="font-mono text-[14px] font-bold text-slate-900">+{formatCurrency(addOnsTotal)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[110px_1fr] gap-0 border-b border-[#EEF0F3]">
          {/* v5 click-to-edit Cleaner cell — opens the cleaner picker. Disabled if the cleaner is
              already paid (locked) or the job is on a final invoice. */}
          <button
            type="button"
            onClick={(hasFinalInvoice || job.subcontractorPaid || isSavingSubcontractor) ? undefined : handleQuickFixCleaner}
            disabled={hasFinalInvoice || job.subcontractorPaid || isSavingSubcontractor}
            className="text-left transition-colors hover:enabled:bg-[#FAFBFC] disabled:cursor-default border-r border-[#EEF0F3] px-4 py-3"
          >
            {renderCompactFact(
              'Cleaner',
              job.subcontractor ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <span aria-hidden="true" style={{ flexShrink: 0, width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getCleanerColorInfo(job.subcontractor.name).hex }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{job.subcontractor.name}</span>
                </span>
              ) : 'Unassigned',
              job.subcontractor ? 'default' : 'muted'
            )}
          </button>
          <div className="px-4 py-3">
            {renderCompactFact('Location', locationSummary)}
          </div>
        </div>

        {job.location.accessInfo && (
          <div className="grid grid-cols-[110px_1fr] gap-0">
            <div className="border-r border-[#EEF0F3] px-4 py-3">
              {renderCompactFact('Access', 'Entry')}
            </div>
            <div className="px-4 py-3">
              <p className="whitespace-pre-wrap" style={{ fontSize: '14px', fontWeight: 600, color: '#111827', lineHeight: 1.35 }}>
                {job.location.accessInfo}
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderDesktopSectionTabs = () => (
    <div
      className="inline-flex items-center rounded-full p-1"
      style={{ backgroundColor: '#F3F6F5', border: '1px solid #E2E8E6' }}
    >
      {[
        { key: 'actions' as const, label: 'Actions' },
        { key: 'details' as const, label: 'Details' },
        { key: 'more' as const, label: 'More' },
      ].map((tab) => {
        const active = desktopSection === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => setDesktopSection(tab.key)}
            className="rounded-full px-4 py-2 transition-all"
            style={{
              background: active ? 'linear-gradient(180deg, #0F766E 0%, #0D9488 100%)' : 'transparent',
              color: active ? '#FFFFFF' : '#5F6B76',
              boxShadow: active ? '0 8px 20px rgba(15, 118, 110, 0.18)' : 'none',
              fontSize: '13px',
              fontWeight: 700,
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )

  const renderDetailsSection = (isMobile: boolean, compact = false) => {
    const content = (
      <div className="space-y-3">
        <div
          className="rounded-[12px] bg-[#FAFCFC] px-3 py-3"
          style={{ border: '1px solid #E7E7E1' }}
        >
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
            Location
          </p>
          <p style={{ fontSize: '14px', fontWeight: 600, color: '#111827', lineHeight: 1.35 }}>
            {job.location.name}
          </p>
        </div>

        {renderStructuredNoteCard()}

        {generalNotes && (
          <div className="rounded-[12px] p-3" style={{ backgroundColor: '#FFFBEF', border: '1px solid #FDE68A' }}>
            <div className="mb-1.5 flex items-center gap-2">
              <StickyNote className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#D97706' }} />
              <p className="font-medium uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px', color: '#D97706' }}>Notes</p>
            </div>
            <p className="whitespace-pre-wrap" style={{ fontSize: '13px', color: '#111111' }}>{generalNotes}</p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Add-ons
            </p>
            {!hasFinalInvoice && (
              <button type="button" onClick={handleQuickFixAddOn} className="text-[12px] font-bold text-teal-700 hover:text-teal-800">+ Add</button>
            )}
          </div>
          {addOns.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#6B7280' }}>No add-ons on this clean.</p>
          ) : (
            <div className="space-y-2">
              {addOns.map((addOn) => (
                <div
                  key={addOn.id}
                  className="flex items-center justify-between rounded-[12px] bg-[#FAFCFC] px-3 py-2.5"
                  style={{ border: '1px solid #E7E7E1' }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{addOn.description}</span>
                  <span style={{ fontSize: '13px', color: '#111827' }}>{formatCurrency(addOn.clientRate)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )

    if (compact) return content

    return (
      <div
        className="rounded-[16px] bg-white"
        style={{
          border: '1px solid #E7E7E1',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
          padding: isMobile ? '14px' : '16px',
        }}
      >
        {content}
      </div>
    )
  }

  const renderMoreActionsSection = (isMobile: boolean, compact = false) => {
    const content = (
      <div className="space-y-3">
        {/* Mark as Completed removed — assumed completion model */}

        {job.status === 'CANCELLED' && (
          <button
            onClick={handleRestoreCancelledClean}
            disabled={isRestoring || hasFinalInvoice || job.subcontractorPaid}
            className="w-full rounded-[12px] px-4 py-3 text-left disabled:opacity-60"
            style={{ backgroundColor: '#F0FDFA', border: '1px solid #99F6E4', fontSize: '15px', fontWeight: 600, color: '#0F766E' }}
          >
            <span>{isRestoring ? 'Restoring...' : 'Restore This Clean'}</span>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: '#5B7280', marginTop: '2px' }}>
              Put a skipped or cancelled clean back on the schedule
            </span>
          </button>
        )}

        {/* Cancel This Clean — marks as cancelled with a reason */}
        {job.status === 'SCHEDULED' && (
          <button
            onClick={handleOpenCancellationSheet}
            disabled={isCancelling}
            className="w-full rounded-[12px] px-4 py-3 text-left disabled:opacity-60"
            style={{ backgroundColor: '#FFF7F7', border: '1px solid #F5D2D2', fontSize: '15px', fontWeight: 600, color: '#C2410C' }}
          >
            <span>Cancel This Clean</span>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: '#9CA3AF', marginTop: '2px' }}>
              Mark this clean as cancelled with a reason
            </span>
          </button>
        )}

        {/* Pause / Cancel Service — sets schedule end date */}
        {job.scheduleId && job.schedule && (
          <button
            onClick={handleQuickFixSchedule}
            className="w-full rounded-[12px] px-4 py-3 text-left"
            style={{ backgroundColor: '#F8FAFC', border: '1px solid #D9E3E1', fontSize: '15px', fontWeight: 600, color: '#374151' }}
          >
            <span>Pause / Cancel Service</span>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: '#9CA3AF', marginTop: '2px' }}>
              Stop all future cleans on this recurring schedule
            </span>
          </button>
        )}

        {/* Delete — only for one-off (non-recurring) jobs */}
        {!job.scheduleId && (
          <button
            onClick={isMobile ? () => setMobileConfirmAction('delete') : handleDelete}
            disabled={isDeleting || hasFinalInvoice}
            className="w-full rounded-[12px] px-4 py-3 text-left disabled:opacity-50"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E7E7E1', fontSize: '13px', fontWeight: 500, color: '#9CA3AF' }}
          >
            {isDeleting ? 'Deleting…' : 'Delete Job'}
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: '#BBBBBB', marginTop: '2px' }}>
              Permanently remove this one-off job
            </span>
          </button>
        )}
      </div>
    )

    if (compact) return content

    return (
      <div
        className="rounded-[16px] bg-white"
        style={{
          border: '1px solid #F0E2E2',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
          padding: isMobile ? '14px' : '16px',
        }}
      >
        {content}
      </div>
    )
  }

  const structuredNotePrefixes = ['Cancelled:', 'Skipped:', 'No Access / No Show:', 'Re-clean / Make Good:']
  const structuredNotePrefix = structuredNotePrefixes.find((prefix) => job.notes?.startsWith(prefix)) || null
  const structuredNoteLines = structuredNotePrefix ? (job.notes?.split('\n') || []) : []
  const generalNotes = job.notes && !structuredNotePrefix ? job.notes : null
  const isQuickFixMode = activeQuickFixPanel !== null
  const isTrial = (job as any).isTrial === true

  const renderStructuredNoteCard = () => {
    if (!structuredNotePrefix) return null

    if (structuredNotePrefix === 'Cancelled:') {
      return (
        <div className="rounded-[12px] p-3" style={{ backgroundColor: 'rgba(229,57,53,0.05)', border: '1px solid rgba(229,57,53,0.2)' }}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#E53935' }} />
            <p className="font-medium uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px', color: '#E53935' }}>Cancelled</p>
          </div>
          <p style={{ fontSize: '13px', color: '#111111' }}>{structuredNoteLines[0]?.replace('Cancelled: ', '')}</p>
        </div>
      )
    }

    const label = structuredNotePrefix.replace(':', '')

    return (
      <div className="rounded-[12px] p-3" style={{ backgroundColor: 'rgba(0,168,150,0.06)', border: '1px solid rgba(0,168,150,0.2)' }}>
        <div className="flex items-center gap-2 mb-1.5">
          <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#00A896' }} />
          <p className="font-medium uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px', color: '#00A896' }}>{label}</p>
        </div>
        <div className="space-y-1">
          {structuredNoteLines.slice(1).map((line, index) => (
            <p key={`${line}-${index}`} className="whitespace-pre-wrap" style={{ fontSize: '13px', color: '#111111' }}>
              {line}
            </p>
          ))}
        </div>
      </div>
    )
  }

  const renderOutcomeModeButtons = (
    label: string,
    mode: OutcomeAmountMode,
    onChange: (nextMode: OutcomeAmountMode) => void
  ) => (
    <div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
        {label}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
        {[
          { id: 'normal', label: 'Normal' },
          { id: 'partial', label: 'Partial' },
          { id: 'none', label: 'None' },
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id as OutcomeAmountMode)}
            style={{
              height: '42px',
              borderRadius: '10px',
              border: mode === option.id ? '1.5px solid #00A896' : '1px solid #E5E7EB',
              backgroundColor: 'white',
              fontSize: '13px',
              fontWeight: mode === option.id ? 600 : 500,
              color: mode === option.id ? '#00A896' : '#333333',
              transition: 'border-color 120ms, color 120ms',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  const renderOutcomeSheetBody = () => (
    <div style={{ padding: '24px', maxHeight: '88%', overflowY: 'auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '18px', fontWeight: 700, color: '#111111', marginBottom: '6px' }}>Fix Problem With This Clean</p>
        <p style={{ fontSize: '14px', color: '#666666' }}>
          Capture what happened and decide what the client should be charged and what the cleaner should be paid.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px', marginBottom: '18px' }}>
        {[
          { id: 'skipped', label: 'Skipped' },
          { id: 'no-access', label: 'No Access / No Show' },
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => handleOutcomeTypeChange(option.id as OutcomeType)}
            style={{
              minHeight: '46px',
              borderRadius: '12px',
              border: outcomeType === option.id ? '1.5px solid #00A896' : '1px solid #E5E7EB',
              backgroundColor: 'white',
              fontSize: '14px',
              fontWeight: outcomeType === option.id ? 600 : 500,
              color: outcomeType === option.id ? '#00A896' : '#222222',
              padding: '0 14px',
              textAlign: 'left',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: '16px' }}>
        {renderOutcomeModeButtons('Client Charge', clientChargeMode, setClientChargeMode)}
        {clientChargeMode === 'partial' && (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={partialClientAmount}
            onChange={(e) => setPartialClientAmount(e.target.value)}
            placeholder={`Enter client amount (normal ${formatCurrency(job.clientRate ?? 0)})`}
          />
        )}

        {renderOutcomeModeButtons('Cleaner Pay', cleanerPayMode, setCleanerPayMode)}
        {cleanerPayMode === 'partial' && (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={partialCleanerAmount}
            onChange={(e) => setPartialCleanerAmount(e.target.value)}
            placeholder={`Enter cleaner pay (normal ${formatCurrency(job.subcontractorRate ?? 0)})`}
          />
        )}

        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            Note
          </p>
          <textarea
            value={outcomeNote}
            onChange={(e) => setOutcomeNote(e.target.value)}
            placeholder="Optional note for why this happened"
            rows={3}
            className="w-full rounded-[12px] px-3 py-2 outline-none resize-none"
            style={{ border: '1px solid #E5E7EB', fontSize: '14px', color: '#111111' }}
          />
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => handleSaveOutcome(generalNotes)}
          disabled={!outcomeType || isSavingOutcome}
          className="flex items-center justify-center gap-2"
          style={{
            width: '100%',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: outcomeType ? '#00A896' : '#E5E7EB',
            color: 'white',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
          }}
        >
          {isSavingOutcome ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Outcome'}
        </button>
        <button
          onClick={() => setShowOutcomeSheet(false)}
          disabled={isSavingOutcome}
          style={{ background: 'none', border: 'none', fontSize: '14px', color: '#888888', padding: '4px' }}
        >
          Never mind
        </button>
      </div>
    </div>
  )

  const renderScopeDialog = () => {
    if (!scopeDialogAction) return null

    const actionLabel = {
      move: 'move',
      cleaner: 'cleaner change',
      'client-rate': 'client price change',
      'cleaner-pay': 'cleaner pay change',
      addon: 'add-on',
    }[scopeDialogAction]

    const isBusy = isSavingInlineDate || isSavingSubcontractor || isSavingRates || isSavingAddOn

    return (
      <Dialog open={!!scopeDialogAction} onOpenChange={(nextOpen) => { if (!nextOpen) setScopeDialogAction(null) }}>
        <DialogContent
          hideClose={true}
          overlayClassName="!z-[110] bg-[rgba(15,23,42,0.24)]"
          className={[
            "!inset-auto !left-1/2 !top-1/2 !w-[min(92vw,360px)] !max-w-[360px] !h-auto !-translate-x-1/2 !-translate-y-1/2",
            "!rounded-[24px] !border !border-[#E5E7EB] !bg-white !p-6 !shadow-2xl !z-[120]",
            "!overflow-visible",
          ].join(" ")}
        >
          <DialogTitle className="sr-only">Choose recurring change scope</DialogTitle>
          <DialogDescription className="sr-only">
            Pick whether this change applies only to this clean, this clean and future cleans, or every clean in the recurring plan.
          </DialogDescription>
          <div className="space-y-2">
            <p style={{ fontSize: '28px', fontWeight: 600, color: '#111827', lineHeight: 1.1 }}>
              Apply recurring change
            </p>
            <p style={{ fontSize: '14px', color: '#5F6B76', lineHeight: 1.5 }}>
              Choose the scope for this {actionLabel}.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            {[
              {
                value: 'single' as const,
                label: 'Just this clean',
                description: 'Only this visit changes.',
              },
              {
                value: 'future' as const,
                label: 'This clean and future cleans',
                description: 'Update the recurring plan starting here.',
              },
              {
                value: 'all' as const,
                label: 'ALL cleans',
                description: 'Update past and future. Invoiced/paid jobs are protected.',
              },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setScopeChoice(option.value)}
                className="w-full rounded-[18px] bg-white px-4 py-3 text-left transition-colors hover:bg-[#F9FBFB]"
                style={{
                  border: scopeChoice === option.value ? '2px solid #2563EB' : '1px solid #D9E3E1',
                  boxShadow: scopeChoice === option.value ? '0 0 0 3px rgba(37,99,235,0.08)' : 'none',
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full"
                    style={{
                      border: scopeChoice === option.value ? '2px solid #2563EB' : '2px solid #9CA3AF',
                    }}
                  >
                    {scopeChoice === option.value && (
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#2563EB' }} />
                    )}
                  </div>
                  <div>
                    <p style={{ fontSize: '16px', fontWeight: 600, color: '#111827' }}>{option.label}</p>
                    <p style={{ fontSize: '13px', color: '#5F6B76', marginTop: '2px' }}>{option.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={() => setScopeDialogAction(null)}
              disabled={isBusy}
              className="rounded-full px-4 py-2 font-medium disabled:opacity-45"
              style={{ fontSize: '15px', color: '#2563EB' }}
            >
              Back
            </button>
            <button
              onClick={handleConfirmScopeChoice}
              disabled={isBusy}
              className="rounded-full px-5 py-2 font-semibold text-white disabled:opacity-45"
              style={{ backgroundColor: '#2563EB', fontSize: '15px' }}
            >
              {isBusy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const renderTrialCard = () => (
    <div className="rounded-[12px] p-3" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px', color: '#B45309' }}>
            Trial Clean
          </p>
          <p style={{ fontSize: '13px', color: '#111111', marginTop: '4px' }}>
            Mark this clean as a trial/intro visit. Badge only — no billing logic changes.
          </p>
        </div>
        <label className="flex items-center gap-2" style={{ cursor: isSavingTrial ? 'default' : 'pointer' }}>
          <span style={{ fontSize: '12px', color: '#92400E', fontWeight: 600 }}>{trialEnabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            checked={trialEnabled}
            disabled={isSavingTrial}
            onChange={(e) => handleToggleTrial(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#D97706' }}
          />
        </label>
      </div>

      {trialEnabled && (
        <div className="mt-3">
          <Label className="text-xs text-amber-900/80 mb-1 block">Trial notes</Label>
          <textarea
            value={trialNotesDraft}
            onChange={(e) => setTrialNotesDraft(e.target.value)}
            placeholder="Entry details, expectations, special prep…"
            rows={3}
            className="w-full rounded-[10px] px-3 py-2 outline-none resize-none"
            style={{ border: '1px solid #FDE68A', backgroundColor: 'white', fontSize: '14px', color: '#111111' }}
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={handleSaveTrialNotes}
              disabled={isSavingTrial}
              className="rounded-full px-4 py-2 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#D97706', fontSize: '13px' }}
            >
              {isSavingTrial ? 'Saving…' : 'Save trial notes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const renderRestoreCancelledCleanCard = () => {
    if (job.status !== 'CANCELLED') return null

    const restoreBlockedReason = hasFinalInvoice
      ? 'This clean is on a sent or paid invoice. Reset or void the invoice before restoring it.'
      : job.subcontractorPaid
        ? 'The cleaner has already been paid for this clean. Unmark the cleaner payment before restoring it.'
        : 'Put this skipped or cancelled clean back on the schedule.'

    return (
      <div
        className="rounded-[12px] p-3"
        style={{ backgroundColor: '#F0FDFA', border: '1px solid #99F6E4' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium uppercase" style={{ fontSize: '10px', letterSpacing: '0.5px', color: '#0F766E' }}>
              Skipped / cancelled clean
            </p>
            <p style={{ fontSize: '13px', color: '#0F172A', marginTop: '4px', lineHeight: 1.35 }}>
              {restoreBlockedReason}
            </p>
          </div>
          <button
            onClick={handleRestoreCancelledClean}
            disabled={isRestoring || hasFinalInvoice || job.subcontractorPaid}
            className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-full px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: '#0D9488', color: 'white', fontSize: '13px' }}
          >
            {isRestoring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isRestoring ? 'Restoring...' : 'Restore'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          hideClose={true}
          className={[
            // Shared resets
            "p-0 gap-0 border-0 shadow-2xl overflow-hidden flex",
            // Mobile: full-width bottom sheet
            "!left-0 !right-0 !top-auto !bottom-0 !w-full !max-w-none",
            "!translate-x-0 !translate-y-0",
            "!rounded-t-[20px] !rounded-b-none",
            // Desktop (md+): restore centered dialog. The schedule-change panel
            // hosts a dense 2-column form, so give it more room (480px clips it).
            "md:!left-1/2 md:!top-1/2 md:!bottom-auto md:!right-auto",
            activeQuickFixPanel === 'schedule'
              ? "md:!w-[min(94vw,720px)] md:!max-w-[720px] md:!max-h-[90vh]"
              : "md:!w-[min(92vw,480px)] md:!max-w-[480px] md:!max-h-[90vh]",
            "md:!-translate-x-1/2 md:!-translate-y-1/2",
            "md:!rounded-[12px]",
          ].join(" ")}
        >
          <DialogTitle className="sr-only">Job details for {job.location.client.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Review this clean, update schedule details, cleaner, rates, notes, add-ons, and status.
          </DialogDescription>
          {/* ═══════════════════════════════════════════════════════════
              MOBILE LAYOUT  (hidden on md+)
          ═══════════════════════════════════════════════════════════ */}
          <div
            className="md:hidden flex flex-col w-full relative bg-white rounded-t-[20px]"
            style={{ maxHeight: '90svh' }}
          >
            {/* Close button — inside relative container so absolute positioning is reliable */}
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 60,
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#F3F4F6',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} strokeWidth={2} style={{ color: '#6B7280' }} />
            </button>

            {/* ── Confirmation sheet overlay ── */}
            {mobileConfirmAction && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-t-[20px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-t-[20px] px-4 pt-6 space-y-3"
                  style={{ paddingBottom: '34px' }}
                >
                  <div className="text-center space-y-1 mb-4">
                    <p className="text-lg font-semibold text-[#111111]">
                      {mobileConfirmAction === 'cancel' ? 'Cancel this job?' : 'Delete this job?'}
                    </p>
                    <p className="text-sm text-[#888888]">This cannot be undone.</p>
                  </div>
                  <button
                    onClick={() => setMobileConfirmAction(null)}
                    className="w-full font-semibold text-base text-[#333333] bg-white border border-[#E0E0E0] rounded-[14px] transition-all active:scale-[0.97]"
                    style={{ height: '52px' }}
                  >
                    Never mind
                  </button>
                  <button
                    onClick={
                      mobileConfirmAction === 'cancel'
                        ? handleConfirmCancelMobile
                        : handleConfirmDeleteMobile
                    }
                    disabled={isCancelling || isDeleting}
                    className="w-full font-semibold text-base text-white rounded-[14px] transition-all active:scale-[0.97] flex items-center justify-center gap-2"
                    style={{ height: '52px', backgroundColor: '#E53935' }}
                  >
                    {(isCancelling || isDeleting) && <Loader2 className="h-4 w-4 animate-spin" />}
                    {mobileConfirmAction === 'cancel' ? 'Yes, Cancel Job' : 'Yes, Delete Job'}
                  </button>
                </div>
              </div>
            )}
            {/* ── Cleaner selection sheet overlay ── */}
            {isSelectingCleaner && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-t-[20px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-t-[20px] overflow-hidden"
                  style={{ paddingBottom: '34px' }}
                >
                  <div
                    className="px-5 py-4 flex items-center justify-between"
                    style={{ borderBottom: '1px solid #F5F5F5' }}
                  >
                    <button
                      onClick={() => setIsSelectingCleaner(false)}
                      className="inline-flex items-center gap-1 rounded-full pr-3 font-semibold transition-colors hover:text-[#0B5F59]"
                      style={{ fontSize: '14px', color: '#0F766E' }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>
                    <p className="font-semibold text-[#111111]">Assign Cleaner</p>
                    <button
                      onClick={() => setIsSelectingCleaner(false)}
                      className="w-[44px] h-[44px] flex items-center justify-center rounded-full transition-colors hover:bg-[#F3F3F3]"
                    >
                      <X className="h-5 w-5 text-gray-400" />
                    </button>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
                    <button
                      onClick={() => handleSaveSubcontractorMobile('unassigned')}
                      className="w-full px-5 py-4 text-left flex items-center justify-between transition-colors active:bg-[#F8F8F8]"
                      style={{ borderBottom: '1px solid #F5F5F5' }}
                    >
                      <span
                        className="text-[15px] font-medium"
                        style={{ color: !job.subcontractor ? '#00A896' : '#111111' }}
                      >
                        Unassigned
                      </span>
                      {!job.subcontractor && <Check className="h-4 w-4" style={{ color: '#00A896' }} />}
                    </button>
                    {activeSubcontractors.map(sub => (
                      <button
                        key={sub.id}
                        onClick={() => handleSaveSubcontractorMobile(sub.id)}
                        className="w-full px-5 py-4 text-left flex items-center justify-between transition-colors active:bg-[#F8F8F8]"
                        style={{ borderBottom: '1px solid #F5F5F5' }}
                      >
                        <div>
                          <p
                            className="text-[15px] font-medium"
                            style={{ color: job.subcontractor?.id === sub.id ? '#00A896' : '#111111' }}
                          >
                            {sub.name}
                          </p>
                          {sub.phone && (
                            <p className="text-[13px] text-[#888888] mt-0.5">{sub.phone}</p>
                          )}
                        </div>
                        {job.subcontractor?.id === sub.id && (
                          <Check className="h-4 w-4 flex-shrink-0" style={{ color: '#00A896' }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {/* ── Cancellation sheet overlay ── */}
            {showCancellationSheet && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-t-[20px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-t-[20px]"
                  style={{ paddingBottom: '40px', maxHeight: '88%', overflowY: 'auto' }}
                >
                  {/* Handle */}
                  <div style={{ width: '36px', height: '4px', backgroundColor: '#E0E0E0', borderRadius: '2px', margin: '12px auto 28px' }} />

                  <div style={{ paddingLeft: '24px', paddingRight: '24px' }}>

                    {/* Reason pills — 2×2 grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
                      {[
                        { id: 'no-access', label: "Couldn't access" },
                        { id: 'cleaner-unavailable', label: "Cleaner unavailable" },
                        { id: 'client-cancelled', label: "Client cancelled" },
                        { id: 'other', label: "Other" },
                      ].map(reason => (
                        <button
                          key={reason.id}
                          onClick={() => setCancelReason(reason.id)}
                          style={{
                            height: '46px',
                            borderRadius: '23px',
                            border: cancelReason === reason.id
                              ? '1.5px solid #00A896'
                              : '1.5px solid #E5E5E5',
                            backgroundColor: 'white',
                            fontSize: '14px',
                            fontWeight: cancelReason === reason.id ? 500 : 400,
                            color: cancelReason === reason.id ? '#00A896' : '#333333',
                            cursor: 'pointer',
                            transition: 'border-color 100ms, color 100ms',
                          }}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>

                    {/* Fee row */}
                    <div className="flex items-center justify-between" style={{ marginBottom: chargeFee ? '16px' : '0' }}>
                      <span style={{ fontSize: '15px', color: '#111111' }}>Charge a fee?</span>
                      <button
                        onClick={() => setChargeFee(v => !v)}
                        style={{
                          width: '44px', height: '26px', borderRadius: '13px',
                          backgroundColor: chargeFee ? '#00A896' : '#E0E0E0',
                          position: 'relative', transition: 'background-color 150ms', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: '3px',
                          left: chargeFee ? '21px' : '3px',
                          width: '20px', height: '20px', borderRadius: '50%',
                          backgroundColor: 'white', transition: 'left 150ms',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </button>
                    </div>

                    {/* Fee amount input */}
                    {chargeFee && (
                      <div
                        style={{ overflow: 'hidden', marginBottom: '4px' }}
                      >
                        <div className="flex items-center justify-center" style={{ padding: '12px 0' }}>
                          <span style={{ fontSize: '28px', fontWeight: 300, color: '#BBBBBB', lineHeight: 1, marginRight: '2px' }}>$</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={feeAmount}
                            onChange={(e) => setFeeAmount(e.target.value)}
                            placeholder="0.00"
                            autoFocus
                            className="outline-none bg-transparent"
                            style={{
                              fontSize: '28px', fontWeight: 400, color: '#111111',
                              width: '110px', border: 'none',
                              borderBottom: '2px solid #EEEEEE',
                              textAlign: 'center',
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* Buttons */}
                    <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button
                        onClick={handleCancelWithReason}
                        disabled={!cancelReason || isCancelling}
                        className="flex items-center justify-center gap-2"
                        style={{
                          width: '100%', height: '52px', borderRadius: '14px',
                          backgroundColor: cancelReason ? '#00A896' : '#E5E5E5',
                          color: 'white', fontSize: '16px', fontWeight: 600,
                          border: 'none', cursor: cancelReason ? 'pointer' : 'default',
                          transition: 'background-color 150ms',
                        }}
                      >
                        {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setShowCancellationSheet(false)}
                        style={{ background: 'none', border: 'none', fontSize: '15px', color: '#999999', cursor: 'pointer', padding: '4px' }}
                      >
                        Never mind
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            )}
            {showOutcomeSheet && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-t-[20px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-t-[20px]"
                  style={{ paddingBottom: '40px' }}
                >
                  {renderOutcomeSheetBody()}
                </div>
              </div>
            )}
            {/* ── Modal header ── */}
            <div
              className="relative text-center flex-shrink-0"
              style={{
                paddingTop: isQuickFixMode ? '16px' : '20px',
                paddingBottom: isQuickFixMode ? '12px' : '16px',
                paddingLeft: '16px',
                paddingRight: '16px',
              }}
            >
              {/* Status badge */}
              {!isQuickFixMode && (
                <div className="flex justify-center" style={{ marginBottom: '12px' }}>
                  <span
                    className="text-xs font-semibold tracking-wider uppercase px-4 py-1.5 rounded-full border"
                    style={{
                      backgroundColor: mobileStatus.bg,
                      color: mobileStatus.text,
                      borderColor: mobileStatus.border,
                    }}
                  >
                    {getMobileStatusLabel(job.status)}
                  </span>
                </div>
              )}

              {/* Client name — IS the title */}
              <p
                className="font-bold text-[#111111] leading-tight"
                style={{ fontSize: isQuickFixMode ? '22px' : '26px' }}
              >
                {job.location.client.name}
              </p>

            {/* Trial badge */}
            {isTrial && (
              <div className="flex justify-center mt-2">
                <span
                  className="text-[10px] font-extrabold tracking-wider uppercase px-3 py-1 rounded-full border"
                  style={{ backgroundColor: 'rgba(217,119,6,0.14)', color: '#B45309', borderColor: 'rgba(217,119,6,0.35)' }}
                >
                  Trial Clean
                </span>
              </div>
            )}

              {/* Schedule subtitle (location lives in the info card) */}
              <p className="text-[#888888] mt-1" style={{ fontSize: isQuickFixMode ? '14px' : '15px' }}>
                {scheduleLine || (job.scheduleId ? job.location.name : 'One-Time')}
              </p>
            </div>

            {/* ── Scrollable body ── */}
            <div
              className={isQuickFixMode ? "flex-1 min-h-0 overflow-hidden px-4 pb-6" : "flex-1 px-4 pb-6"}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >

              {!isQuickFixMode ? renderQuickFixSection(true) : null}
              {isQuickFixMode ? renderQuickFixPanel(true) : null}

              {!isQuickFixMode && (
                <>
                  {hasFinalInvoice && (
                    <div className="rounded-[12px] p-3 flex items-start gap-2" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                      <FileText className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-blue-900">This clean is on a sent or paid invoice. Big changes here should be handled by resetting or voiding that invoice.</p>
                    </div>
                  )}
                  {job.subcontractorPaid && !hasFinalInvoice && (
                    <div className="rounded-[12px] p-3 flex items-start gap-2" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                      <DollarSign className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-green-900">The cleaner is already paid, so money changes should be handled carefully.</p>
                    </div>
                  )}

                  {renderRestoreCancelledCleanCard()}

                  {renderTrialCard()}

                  {renderSummarySection(true)}

                  <div className="space-y-2">
                    <button
                      onClick={() => setShowDetails((current) => !current)}
                      className="w-full rounded-[14px] bg-white px-4 py-3 text-left"
                      style={{ border: '1px solid #E7E7E1', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)' }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                            {showDetails ? 'Hide details' : 'View details'}
                          </p>
                          <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
                            Notes, add-ons, and extra job information
                          </p>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} style={{ color: '#6B7280' }} />
                      </div>
                    </button>
                    {showDetails && renderDetailsSection(true)}

                    <button
                      onClick={() => setShowMoreActions((current) => !current)}
                      className="w-full rounded-[14px] bg-white px-4 py-3 text-left"
                      style={{ border: '1px solid #E7E7E1', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)' }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                            {showMoreActions ? 'Hide more actions' : 'More actions'}
                          </p>
                          <p style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
                            Completed, invoiced, cancel, and delete actions
                          </p>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showMoreActions ? 'rotate-180' : ''}`} style={{ color: '#6B7280' }} />
                      </div>
                    </button>
                    {showMoreActions && renderMoreActionsSection(true)}
                  </div>
                </>
              )}

            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════
              DESKTOP LAYOUT  (hidden below md)
          ═══════════════════════════════════════════════════════════ */}
          <div
            className="hidden md:flex md:flex-col md:w-full bg-white overflow-y-auto relative"
            style={{ maxHeight: '90vh' }}
          >
            {/* Close button — inside relative container so absolute positioning is reliable */}
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 60,
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#F3F4F6',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} strokeWidth={2} style={{ color: '#6B7280' }} />
            </button>
            {/* ── Desktop: Cancellation sheet overlay ── */}
            {showCancellationSheet && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-[12px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-[12px]"
                  style={{ maxHeight: '95%', overflowY: 'auto', paddingBottom: '28px' }}
                >
                  <div style={{ padding: '28px 24px 0' }}>

                    {/* Reason pills — 2×2 grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
                      {[
                        { id: 'no-access', label: "Couldn't access" },
                        { id: 'cleaner-unavailable', label: "Cleaner unavailable" },
                        { id: 'client-cancelled', label: "Client cancelled" },
                        { id: 'other', label: "Other" },
                      ].map(reason => (
                        <button
                          key={reason.id}
                          onClick={() => setCancelReason(reason.id)}
                          style={{
                            height: '46px',
                            borderRadius: '23px',
                            border: cancelReason === reason.id
                              ? '1.5px solid #00A896'
                              : '1.5px solid #E5E5E5',
                            backgroundColor: 'white',
                            fontSize: '14px',
                            fontWeight: cancelReason === reason.id ? 500 : 400,
                            color: cancelReason === reason.id ? '#00A896' : '#333333',
                            cursor: 'pointer',
                            transition: 'border-color 100ms, color 100ms',
                          }}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>

                    {/* Fee row */}
                    <div className="flex items-center justify-between" style={{ marginBottom: chargeFee ? '8px' : '0' }}>
                      <span style={{ fontSize: '15px', color: '#111111' }}>Charge a fee?</span>
                      <button
                        onClick={() => setChargeFee(v => !v)}
                        style={{
                          width: '44px', height: '26px', borderRadius: '13px',
                          backgroundColor: chargeFee ? '#00A896' : '#E0E0E0',
                          position: 'relative', transition: 'background-color 150ms', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: '3px',
                          left: chargeFee ? '21px' : '3px',
                          width: '20px', height: '20px', borderRadius: '50%',
                          backgroundColor: 'white', transition: 'left 150ms',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </button>
                    </div>
                    {chargeFee && (
                      <div
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="flex items-center justify-center" style={{ padding: '12px 0' }}>
                          <span style={{ fontSize: '28px', fontWeight: 300, color: '#BBBBBB', lineHeight: 1, marginRight: '2px' }}>$</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)}
                            placeholder="0.00" autoFocus
                            className="outline-none bg-transparent"
                            style={{
                              fontSize: '28px', fontWeight: 400, color: '#111111',
                              width: '110px', border: 'none',
                              borderBottom: '2px solid #EEEEEE', textAlign: 'center',
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* Buttons */}
                    <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <button
                        onClick={handleCancelWithReason}
                        disabled={!cancelReason || isCancelling}
                        className="flex items-center justify-center gap-2"
                        style={{
                          width: '100%', height: '48px', borderRadius: '10px',
                          backgroundColor: cancelReason ? '#00A896' : '#E5E5E5',
                          color: 'white', fontSize: '15px', fontWeight: 600,
                          border: 'none', cursor: cancelReason ? 'pointer' : 'default',
                          transition: 'background-color 150ms',
                        }}
                      >
                        {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setShowCancellationSheet(false)}
                        style={{ background: 'none', border: 'none', fontSize: '14px', color: '#999999', cursor: 'pointer', padding: '4px' }}
                      >
                        Never mind
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            )}
            {showOutcomeSheet && (
              <div
                className="absolute inset-0 z-50 flex flex-col justify-end rounded-[12px]"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              >
                <div
                  className="bg-white rounded-[12px]"
                  style={{ maxHeight: '95%', overflowY: 'auto', paddingBottom: '20px' }}
                >
                  {renderOutcomeSheetBody()}
                </div>
              </div>
            )}
            {/* ── Header (v5 layout: status pill + recurring/one-time chip on one row, client name below) ── */}
            <div
              className="flex-shrink-0"
              style={{
                borderBottom: '1px solid #F5F5F5',
                paddingTop: isQuickFixMode ? '16px' : '18px',
                paddingBottom: isQuickFixMode ? '12px' : '14px',
                paddingLeft: '20px',
                paddingRight: '20px',
              }}
            >
              {!isQuickFixMode && (
                <div className="flex items-center gap-1.5" style={{ marginBottom: '6px' }}>
                  <span
                    className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: mobileStatus.bg,
                      color: mobileStatus.text,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {getMobileStatusLabel(job.status)}
                  </span>
                  {job.scheduleId ? (
                    <span className="text-[11px] text-gray-400">{scheduleLine || job.location.name}</span>
                  ) : (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#FFFBEB', color: '#92400E' }}
                    >
                      One-Time
                    </span>
                  )}
                </div>
              )}
              <p className="font-bold text-[#0F172A] leading-tight tracking-tight" style={{ fontSize: isQuickFixMode ? '18px' : '19px' }}>
                {job.location.client.name}
              </p>
            </div>

            {/* v5 client notes yellow strip — surfaces client-level "always know this" info to the VA */}
            {(() => {
              const raw = job.location.client.notes
              if (!raw) return null
              // Strip the TRIAL CLIENT marker that AddClientWizard stamps in (it's metadata, not a real note)
              const cleaned = raw
                .replace(/^TRIAL CLIENT[^\n]*\n*/i, '')
                .replace(/^\s*$/m, '')
                .trim()
              if (!cleaned) return null
              return (
                <div
                  className="flex-shrink-0"
                  style={{
                    padding: '8px 20px',
                    background: '#FFFBEB',
                    borderTop: '1px solid #FEF3C7',
                    borderBottom: '1px solid #FEF3C7',
                  }}
                >
                  <p
                    className="whitespace-pre-wrap"
                    style={{ fontSize: '11.5px', color: '#92400E', lineHeight: 1.4 }}
                  >
                    {cleaned}
                  </p>
                </div>
              )
            })()}

            {/* ── Scrollable body ── */}
            <div className={isQuickFixMode ? "flex-1 min-h-0 overflow-hidden px-5 py-4 space-y-4" : "flex-1 px-5 py-4"}>

              {/* Invoiced / Paid warnings */}
              {hasFinalInvoice && (
                <div className="rounded-[10px] p-3 flex items-start gap-2" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <FileText className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-900">This job is on a sent or paid invoice and cannot be rescheduled.</p>
                </div>
              )}
              {job.subcontractorPaid && !hasFinalInvoice && (
                <div className="rounded-[10px] p-3 flex items-start gap-2" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                  <DollarSign className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-green-900">Subcontractor has been paid — rates and schedule are locked.</p>
                </div>
              )}

              {renderRestoreCancelledCleanCard()}

              {isQuickFixMode ? renderQuickFixPanel(false) : null}

              {!isQuickFixMode && (
                <div className="space-y-4">
                  {isTrial && (
                    <div className="rounded-[10px] px-3 py-2" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Trial clean
                      </p>
                      {job.trialNotes && (
                        <p className="mt-1 whitespace-pre-wrap" style={{ fontSize: '13px', color: '#78350F' }}>{job.trialNotes}</p>
                      )}
                    </div>
                  )}

                  {renderDesktopOverviewSection()}

                  {canUseQuickFixes ? (
                    <div>
                      {renderQuickFixSection(false, true)}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3">
                    {renderDetailsSection(false, true)}
                    {renderMoreActionsSection(false, true)}
                  </div>
                </div>
              )}

            </div>

          </div>
        </DialogContent>
      </Dialog>
      {open ? renderScopeDialog() : null}
    </>
  )
}
