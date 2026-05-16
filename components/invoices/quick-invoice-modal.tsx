"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"
import { 
  FileText, 
  Send, 
  Save, 
  Pencil, 
  Check, 
  X,
  TestTube,
  Trash2,
  Eye,
  RefreshCw,
  AlertTriangle,
  Mail,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Calendar,
  SkipForward,
  CheckCircle,
  MapPin,
} from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Checkbox } from "@/components/ui/checkbox"
import { format } from "date-fns"
import { useQuickInvoice, type QuickInvoiceClient, type QuickInvoiceJob } from "./use-quick-invoice"

interface QuickInvoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: QuickInvoiceClient
  jobs: QuickInvoiceJob[]
  initialMonth?: string
  onSuccess?: () => void
  onNext?: () => void
  onPrevious?: () => void
  currentIndex?: number
  totalCount?: number
  batchMode?: boolean
}

export function QuickInvoiceModal(props: QuickInvoiceModalProps) {
  const {
    open,
    onOpenChange,
    client,
    jobs,
    onNext,
    onPrevious,
    currentIndex,
    totalCount,
    batchMode,
    // State
    isCreating, isSendingTest, isGeneratingPreview,
    previewPdfUrl,
    netTerms, setNetTerms,
    dateDue, setDateDue,
    notes, setNotes,
    lineItems,
    progress, progressStep,
    emailCc, setEmailCc,
    recipientPool,
    selectedRecipients,
    manualEmailInput, setManualEmailInput,
    toggleRecipient,
    addManualRecipient,
    emailSubject, setEmailSubject,
    emailMessage, setEmailMessage,
    showPaymentOptions, setShowPaymentOptions,
    showSendConfirmation, setShowSendConfirmation,
    toggleSection, isSectionExpanded,
    selectedJobIds,
    expandedLocations,
    activeMonthPillRef,
    activeMonth, setActiveMonth,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    showCustomDates, setShowCustomDates,
    // Computed
    availableMonths, filteredJobs,
    flatRateData, recurringLocationGroups, perCleanLocationGroups,
    totalAmount, netTermsOptions,
    // Handlers
    handleMonthSelect, handleCustomDates, clearDateFilter,
    toggleJob, toggleAllJobs,
    toggleLocationExpand, toggleLocationJobs,
    handleNetTermsChange,
    startEditing, saveEdit, updateLineItem, removeLineItem, addLineItem,
    handleCreateInvoice,
    handleSendToClient, handleConfirmSendToClient,
    handleGeneratePreview,
    handleBatchApprove, handleBatchSkip,
  } = useQuickInvoice(props)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="sm:max-w-6xl w-full h-full sm:w-[95vw] sm:h-[90vh] sm:rounded-lg sm:p-0 sm:gap-0 p-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative px-6 py-4 border-b bg-gradient-to-r from-teal-50 to-white">
          <div className="pr-10">
            {batchMode && totalCount && (
              <p className="text-xs font-medium text-teal-600 mb-1">
                Batch — {(currentIndex ?? 0) + 1} of {totalCount}
              </p>
            )}
            <h2 className="text-xl font-bold text-slate-800">
              {client.name}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {client.billingType === 'FLAT_RATE'
                ? `Flat Rate \u2022 ${formatCurrency(flatRateData?.monthlyRate ?? 0)}/mo`
                : `Per Clean \u2022 ${jobs.length} job${jobs.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            aria-label="Close"
          >
            <X style={{ width: '16px', height: '16px', color: '#6B7280' }} />
          </button>

          {/* Client Navigation */}
          {totalCount != null && totalCount > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-teal-100">
              <div className="min-w-[80px]">
                {onPrevious ? (
                  <button
                    onClick={onPrevious}
                    className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                ) : null}
              </div>
              <span className="text-xs font-medium text-slate-400">
                {(currentIndex ?? 0) + 1} of {totalCount} clients
              </span>
              <div className="min-w-[80px] flex justify-end">
                {onNext ? (
                  <button
                    onClick={onNext}
                    className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Main Content - Side by Side (desktop) / Stacked (mobile) */}
        <div className="flex-1 overflow-y-auto md:overflow-hidden md:flex md:flex-row">
          {/* Left: Settings & Line Items */}
          <div className="md:w-[40%] md:border-r md:overflow-y-auto p-4 md:p-6 space-y-4 bg-white">

            {client.billingType === 'FLAT_RATE' && flatRateData ? (
              /* ── Monthly Invoice card (flat-rate clients) ── */
              <div className="border rounded-lg overflow-hidden">
                {/* Card header */}
                <div className="px-3 py-2.5 bg-slate-50">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">Monthly Invoice</span>
                  </div>
                </div>

                <div className="border-t">
                  {/* Month pills + Custom date range */}
                  <div className="px-3 py-2.5 bg-slate-50/50 border-b space-y-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                      {availableMonths.map(month => {
                        const [y, m] = month.split('-').map(Number)
                        const label = format(new Date(y, m - 1), 'MMM yyyy')
                        const isActive = activeMonth === month
                        return (
                          <button
                            key={month}
                            ref={isActive ? activeMonthPillRef : undefined}
                            onClick={() => handleMonthSelect(month)}
                            style={{
                              padding: '4px 12px',
                              fontSize: '12px',
                              fontWeight: isActive ? 600 : 500,
                              color: isActive ? '#00A896' : '#555555',
                              backgroundColor: isActive ? 'rgba(0,168,150,0.12)' : '#F0F0F0',
                              border: isActive ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                              borderRadius: '14px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                              transition: 'all 120ms',
                            }}
                          >
                            {label}
                          </button>
                        )
                      })}
                      {/* Custom date range pill */}
                      <button
                        onClick={handleCustomDates}
                        style={{
                          padding: '4px 12px',
                          fontSize: '12px',
                          fontWeight: activeMonth === 'custom' ? 600 : 500,
                          color: activeMonth === 'custom' ? '#00A896' : '#555555',
                          backgroundColor: activeMonth === 'custom' ? 'rgba(0,168,150,0.12)' : '#F0F0F0',
                          border: activeMonth === 'custom' ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                          borderRadius: '14px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          transition: 'all 120ms',
                        }}
                      >
                        Custom
                      </button>
                    </div>

                    {/* Custom date range inputs */}
                    {showCustomDates && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => {
                              setDateFrom(e.target.value)
                              setActiveMonth('custom')
                              setShowCustomDates(true)
                            }}
                            className="w-full px-2 py-1.5 text-sm border rounded bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                        <span className="text-xs text-slate-400">to</span>
                        <div className="flex-1">
                          <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => {
                              setDateTo(e.target.value)
                              setActiveMonth('custom')
                              setShowCustomDates(true)
                            }}
                            className="w-full px-2 py-1.5 text-sm border rounded bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Monthly Rate hero */}
                  <div className="px-4 py-4 bg-white border-b">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-600">Monthly Rate</span>
                      <span className="text-lg font-bold text-slate-800">
                        {formatCurrency(flatRateData.monthlyRate)}
                      </span>
                    </div>
                  </div>

                  {/* Cleans included (grouped by location, collapsible) */}
                  {flatRateData.recurringJobs.length > 0 && (
                    <div className="px-4 py-3 bg-white">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        Cleans included
                      </p>
                      <div className="space-y-1">
                        {recurringLocationGroups.map(group => {
                          const isExpanded = expandedLocations.has(group.locationName)
                          const allCompleted = group.completedCount === group.jobs.length
                          return (
                            <div key={group.locationName}>
                              <button
                                onClick={() => toggleLocationExpand(group.locationName)}
                                className="w-full flex items-center gap-2 py-1.5 hover:bg-slate-50 rounded transition-colors"
                              >
                                <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                                <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span className="text-sm font-medium text-slate-700 flex-1 text-left truncate">
                                  {group.locationName}
                                </span>
                                <span className="text-xs text-slate-400 whitespace-nowrap">
                                  {group.jobs.length} clean{group.jobs.length !== 1 ? 's' : ''}
                                </span>
                                <CheckCircle className={`w-3.5 h-3.5 flex-shrink-0 ${allCompleted ? 'text-teal-500' : 'text-slate-300'}`} />
                              </button>
                              {isExpanded && (
                                <div className="ml-5 pl-3 border-l border-slate-100 space-y-0.5 pb-1">
                                  {group.jobs.map(job => {
                                    const jobDate = new Date(job.date)
                                    const isCompleted = job.status === 'COMPLETED'
                                    return (
                                      <div key={job.id} className="flex items-center gap-2 py-0.5">
                                        <CheckCircle
                                          className={`w-3.5 h-3.5 flex-shrink-0 ${
                                            isCompleted ? 'text-teal-500' : 'text-slate-300'
                                          }`}
                                        />
                                        <span className={`text-xs ${isCompleted ? 'text-slate-600' : 'text-slate-400'}`}>
                                          {format(jobDate, 'EEE, MMM d')}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        {flatRateData.completedCount} of {flatRateData.totalCount} clean{flatRateData.totalCount !== 1 ? 's' : ''} completed
                      </p>
                    </div>
                  )}

                  {flatRateData.recurringJobs.length === 0 && (
                    <div className="px-4 py-6 bg-white">
                      <p className="text-sm text-slate-400 text-center">
                        No cleans found for this month
                      </p>
                    </div>
                  )}

                  {/* One-off extras (interactive checkboxes, only shown if they exist) */}
                  {flatRateData.oneOffJobs.length > 0 && (
                    <div className="px-4 py-3 bg-white border-t border-dashed border-slate-200">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        One-off extras
                      </p>
                      <div className="space-y-1.5">
                        {flatRateData.oneOffJobs.map(job => {
                          const jobDate = new Date(job.date)
                          const isSelected = selectedJobIds.has(job.id)
                          return (
                            <label
                              key={job.id}
                              className="flex items-center gap-2.5 py-1 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleJob(job.id)}
                                className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                              />
                              <span className="flex-1 text-sm text-slate-700">
                                {job.location.name} &middot; {format(jobDate, 'EEE, MMM d')}
                              </span>
                              <span className="text-sm font-medium text-slate-600">
                                {formatCurrency(job.clientRate)}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── Job Picker (per-clean clients) ── */
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('jobs')}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">Jobs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {selectedJobIds.size} of {filteredJobs.length} selected
                      {selectedJobIds.size > 0 && ` \u2014 ${formatCurrency(
                        filteredJobs.filter(j => selectedJobIds.has(j.id)).reduce((sum, j) => sum + j.clientRate, 0)
                      )}`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isSectionExpanded('jobs') ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isSectionExpanded('jobs') && (
                  <div className="border-t">
                    {/* Month pills */}
                    <div className="px-3 py-2.5 bg-slate-50/50 border-b space-y-2">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        {/* "All" pill */}
                        <button
                          onClick={() => handleMonthSelect('all')}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            fontWeight: activeMonth === 'all' ? 600 : 500,
                            color: activeMonth === 'all' ? '#00A896' : '#555555',
                            backgroundColor: activeMonth === 'all' ? 'rgba(0,168,150,0.12)' : '#F0F0F0',
                            border: activeMonth === 'all' ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                            borderRadius: '14px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            transition: 'all 120ms',
                          }}
                        >
                          All
                        </button>
                        {/* Month pills derived from available jobs */}
                        {availableMonths.map(month => {
                          const [y, m] = month.split('-').map(Number)
                          const label = format(new Date(y, m - 1), 'MMM yyyy')
                          const isActive = activeMonth === month
                          return (
                            <button
                              key={month}
                              ref={isActive ? activeMonthPillRef : undefined}
                              onClick={() => handleMonthSelect(month)}
                              style={{
                                padding: '4px 12px',
                                fontSize: '12px',
                                fontWeight: isActive ? 600 : 500,
                                color: isActive ? '#00A896' : '#555555',
                                backgroundColor: isActive ? 'rgba(0,168,150,0.12)' : '#F0F0F0',
                                border: isActive ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                                borderRadius: '14px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                transition: 'all 120ms',
                              }}
                            >
                              {label}
                            </button>
                          )
                        })}
                        {/* Custom pill */}
                        <button
                          onClick={handleCustomDates}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            fontWeight: activeMonth === 'custom' ? 600 : 500,
                            color: activeMonth === 'custom' ? '#00A896' : '#555555',
                            backgroundColor: activeMonth === 'custom' ? 'rgba(0,168,150,0.12)' : '#F0F0F0',
                            border: activeMonth === 'custom' ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                            borderRadius: '14px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            transition: 'all 120ms',
                          }}
                        >
                          Custom
                        </button>
                      </div>

                      {/* Date range display / inputs */}
                      {(showCustomDates || (dateFrom && dateTo && activeMonth !== 'all')) && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <input
                              type="date"
                              value={dateFrom}
                              onChange={(e) => {
                                setDateFrom(e.target.value)
                                setActiveMonth('custom')
                                setShowCustomDates(true)
                              }}
                              className="w-full px-2 py-1.5 text-sm border rounded bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                          <span className="text-xs text-slate-400">to</span>
                          <div className="flex-1">
                            <input
                              type="date"
                              value={dateTo}
                              onChange={(e) => {
                                setDateTo(e.target.value)
                                setActiveMonth('custom')
                                setShowCustomDates(true)
                              }}
                              className="w-full px-2 py-1.5 text-sm border rounded bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Select all / count */}
                    <div className="px-3 py-2 flex items-center justify-between bg-white border-b">
                      <button
                        onClick={toggleAllJobs}
                        className="text-xs font-medium text-teal-600 hover:text-teal-700"
                      >
                        {selectedJobIds.size === filteredJobs.length && filteredJobs.length > 0 ? 'Deselect all' : 'Select all'}
                      </button>
                      <span className="text-xs text-slate-400">
                        {selectedJobIds.size} selected
                      </span>
                    </div>

                    {/* Job list (grouped by location) */}
                    <div className="divide-y divide-slate-100">
                      {filteredJobs.length === 0 && (
                        <p className="px-3 py-4 text-sm text-slate-400 text-center">
                          No jobs match the selected dates
                        </p>
                      )}
                      {perCleanLocationGroups.map(group => {
                        const isExpanded = expandedLocations.has(group.locationName)
                        const allSelected = group.selectedCount === group.jobs.length
                        const noneSelected = group.selectedCount === 0
                        return (
                          <div key={group.locationName}>
                            {/* Location header row */}
                            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors">
                              <input
                                type="checkbox"
                                checked={allSelected && group.jobs.length > 0}
                                ref={(el) => {
                                  if (el) el.indeterminate = !allSelected && !noneSelected
                                }}
                                onChange={() => toggleLocationJobs(group.locationName)}
                                className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500 cursor-pointer"
                              />
                              <button
                                onClick={() => toggleLocationExpand(group.locationName)}
                                className="flex items-center gap-1.5 flex-1 min-w-0"
                              >
                                <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                                <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span className="text-sm font-medium text-slate-700 truncate text-left">
                                  {group.locationName}
                                </span>
                              </button>
                              <span className="text-xs text-slate-400 whitespace-nowrap">
                                {group.selectedCount} of {group.jobs.length}
                              </span>
                              <span className="text-sm font-medium text-slate-600 whitespace-nowrap">
                                {formatCurrency(group.selectedAmount)}
                              </span>
                            </div>
                            {/* Expanded individual jobs */}
                            {isExpanded && (
                              <div className="bg-white">
                                {group.jobs.map(job => {
                                  const jobDate = new Date(job.date)
                                  const isSelected = selectedJobIds.has(job.id)
                                  return (
                                    <label
                                      key={job.id}
                                      className={`flex items-center gap-3 pl-10 pr-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-white' : 'bg-slate-50/30'} hover:bg-teal-50/30`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleJob(job.id)}
                                        className="w-3.5 h-3.5 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                                      />
                                      <span className="flex-1 text-xs text-slate-600">
                                        {format(jobDate, 'EEE, MMM d, yyyy')}
                                      </span>
                                      <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                                        {formatCurrency(job.clientRate)}
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Line Items (always visible — the star) ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-slate-700">Line Items</Label>
              </div>
              
              <div className="space-y-2">
                {lineItems.map((item) => {
                  const linkedJob = item.jobId ? jobs.find(j => j.id === item.jobId) : null
                  const jobDates = client.billingType === 'FLAT_RATE' && linkedJob?.scheduleId
                    ? jobs.filter(j => j.scheduleId === linkedJob.scheduleId && selectedJobIds.has(j.id) && j.status !== 'CANCELLED')
                    : null

                  return (
                    <div
                      key={item.id}
                      className="border rounded-lg px-4 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      {item.isEditing ? (
                        <div className="space-y-2">
                          <Input
                            value={item.description}
                            onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                            placeholder="Description"
                            className="text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-500">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              value={item.amount}
                              onChange={(e) => updateLineItem(item.id, 'amount', parseFloat(e.target.value) || 0)}
                              className="text-sm w-32"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => saveEdit(item.id)}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {item.description}
                            </p>
                            {item.serviceDate && !jobDates && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                {format(new Date(item.serviceDate), 'MMM d, yyyy')}
                              </p>
                            )}
                            {jobDates && jobDates.length > 0 && (
                              <p className="text-xs text-slate-400 mt-1">
                                {jobDates.map(j => format(new Date(j.date), 'MMM d')).join(' · ')}
                                {' '}({jobDates.length} clean{jobDates.length !== 1 ? 's' : ''})
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">
                              {formatCurrency(item.amount)}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEditing(item.id)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeLineItem(item.id)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                onClick={addLineItem}
                className="flex items-center gap-1 pt-1 text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add line item
              </button>

              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-sm font-semibold text-slate-700">Total</span>
                <span className="text-lg font-semibold text-slate-800">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>

            {/* ── Payment Terms (collapsible) ── */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('payment')}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">Payment Terms</span>
                <div className="flex items-center gap-2">
                  {!isSectionExpanded('payment') && (
                    <span className="text-xs text-slate-400">
                      {netTermsOptions.find(o => o.value === netTerms)?.label || 'Net 7'}
                      {dateDue && ` · Due ${format(new Date(dateDue + 'T12:00:00'), 'MMM d')}`}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isSectionExpanded('payment') ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {isSectionExpanded('payment') && (
                <div className="px-3 py-3 space-y-3 border-t bg-white">
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={netTerms} onValueChange={handleNetTermsChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {netTermsOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={dateDue}
                      onChange={(e) => {
                        setDateDue(e.target.value)
                        setNetTerms('custom')
                      }}
                    />
                  </div>
                  {dateDue && (
                    <p className="text-xs text-slate-500">
                      Due: {new Date(dateDue + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Notes (collapsible) ── */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('notes')}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-700">Notes</span>
                <div className="flex items-center gap-2">
                  {!isSectionExpanded('notes') && (
                    <span className="text-xs text-slate-400">
                      {notes ? notes.slice(0, 30) + (notes.length > 30 ? '...' : '') : 'None'}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isSectionExpanded('notes') ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {isSectionExpanded('notes') && (
                <div className="px-3 py-3 border-t bg-white">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes for this invoice..."
                    rows={3}
                    className="text-sm"
                  />
                </div>
              )}
            </div>

            {/* ── Email Settings (collapsible) ── */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('email')}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-700">Email</span>
                </div>
                <div className="flex items-center gap-2">
                  {!isSectionExpanded('email') && (
                    <span className="text-xs text-slate-400 truncate max-w-[180px]">
                      {selectedRecipients.length > 0 ? selectedRecipients.join(', ') : 'No recipient'}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isSectionExpanded('email') ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {isSectionExpanded('email') && (
                <div className="px-3 py-3 space-y-3 border-t bg-white">
                  <div>
                    <Label className="text-xs text-slate-600">To * <span className="text-slate-400 font-normal">(select one or more)</span></Label>
                    <div className="mt-2 space-y-2 max-h-44 overflow-y-auto border rounded-md p-2 bg-slate-50/60">
                      {recipientPool.length === 0 ? (
                        <p className="text-xs text-slate-500 py-1">No saved addresses on file. Add an address below.</p>
                      ) : (
                        recipientPool.map((email) => (
                          <label key={email} className="flex items-center gap-2.5 text-sm cursor-pointer py-0.5">
                            <Checkbox
                              checked={selectedRecipients.some((r) => r.toLowerCase() === email.toLowerCase())}
                              onCheckedChange={() => toggleRecipient(email)}
                              className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                            />
                            <span className="truncate text-slate-800">{email}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1">
                      <Label htmlFor="manualEmailTo" className="text-xs text-slate-600">Add email</Label>
                      <Input
                        id="manualEmailTo"
                        type="email"
                        value={manualEmailInput}
                        onChange={(e) => setManualEmailInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManualRecipient() } }}
                        placeholder="billing@example.com"
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" size="sm" className="h-9" onClick={addManualRecipient}>
                        Add
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="emailCc" className="text-xs text-slate-600">CC (Optional)</Label>
                    <Input
                      id="emailCc"
                      type="email"
                      value={emailCc}
                      onChange={(e) => setEmailCc(e.target.value)}
                      placeholder="cc@example.com"
                      className="mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="emailSubject" className="text-xs text-slate-600">Subject *</Label>
                    <Input
                      id="emailSubject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Invoice from Clean Freaks"
                      className="mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="emailMessage" className="text-xs text-slate-600">Message *</Label>
                    <Textarea
                      id="emailMessage"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      placeholder="Add a custom message..."
                      rows={3}
                      className="mt-1 text-sm"
                    />
                  </div>
                  <div className="flex items-start gap-3 pt-2 border-t">
                    <input
                      type="checkbox"
                      id="showPaymentOptions"
                      checked={showPaymentOptions}
                      onChange={(e) => setShowPaymentOptions(e.target.checked)}
                      className="mt-1 w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                    />
                    <div className="flex-1">
                      <Label htmlFor="showPaymentOptions" className="text-xs font-semibold text-slate-700 cursor-pointer">
                        Include Pay Now Button
                      </Label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        When enabled, clients can pay online. When disabled, they&apos;ll only see the invoice.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview (hidden on mobile until generated) */}
          <div className="hidden md:flex md:w-[60%] bg-slate-100 flex-col border-t md:border-t-0">
            <div className="p-3 border-b bg-white flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">Invoice Preview</h3>
                <p className="text-xs text-slate-500">
                  {previewPdfUrl ? 'Live preview' : 'Generate preview to see invoice'}
                </p>
              </div>
              <Button
                onClick={() => handleGeneratePreview()}
                disabled={isGeneratingPreview || lineItems.length === 0}
                className="bg-teal-600 hover:bg-teal-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                size="sm"
              >
                {isGeneratingPreview ? (
                  <>
                    <ActionSpinner size={16} color="white" className="mr-2" />
                    Generating...
                  </>
                ) : previewPdfUrl ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh Preview
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Generate Preview
                  </>
                )}
              </Button>
            </div>
            <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
              {isGeneratingPreview ? (
                <div className="text-center">
                  <ActionSpinner size={48} color="#0d9488" className="mx-auto mb-4" />
                  <p className="text-slate-600 font-medium">Generating preview...</p>
                  <p className="text-sm text-slate-500 mt-2">This usually takes 2-3 seconds</p>
                </div>
              ) : previewPdfUrl ? (
                <div className="w-full h-full bg-white shadow-xl rounded-lg overflow-hidden">
                  <iframe
                    src={`${previewPdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                    className="w-full h-full border-0"
                    title="Invoice Preview"
                  />
                </div>
              ) : (
                <div className="text-center max-w-md">
                  <div className="rounded-xl p-8" style={{ backgroundColor: '#F9F9F9', border: '1px solid #E5E5E5' }}>
                    <Eye className="h-12 w-12 mx-auto mb-4" style={{ color: '#CCCCCC' }} />
                    <p className="font-semibold text-base mb-2" style={{ color: '#444444' }}>Ready to Preview</p>
                    <p className="text-sm" style={{ color: '#888888' }}>
                      Click &ldquo;Generate Preview&rdquo; above to see your invoice PDF
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Preview Button */}
        <div className="md:hidden px-4 py-3 border-t bg-slate-50">
          <Button
            onClick={() => handleGeneratePreview()}
            disabled={isGeneratingPreview || lineItems.length === 0}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold"
            size="sm"
          >
            {isGeneratingPreview ? (
              <>
                <ActionSpinner size={16} color="white" className="mr-2" />
                Generating...
              </>
            ) : previewPdfUrl ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Preview
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Generate Preview
              </>
            )}
          </Button>
          {previewPdfUrl && (
            <div className="mt-3 bg-white rounded-lg shadow-sm overflow-hidden" style={{ height: '400px' }}>
              <iframe
                src={`${previewPdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                className="w-full h-full border-0"
                title="Invoice Preview"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 md:px-6 py-3 md:py-4 border-t space-y-3" style={{ backgroundColor: '#FFFFFF', borderColor: '#F0F0F0' }}>
          {(isCreating || isSendingTest) && progress > 0 && (
            <div className="px-2">
              <ProgressBar 
                value={progress} 
                showLabel 
                label={progressStep || 'Processing...'}
                className="mb-2"
              />
            </div>
          )}
          {batchMode ? (
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
                Cancel
              </Button>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={handleBatchSkip}
                  disabled={isCreating}
                  className="text-slate-500"
                >
                  <SkipForward className="h-4 w-4 mr-1.5" />
                  Skip
                </Button>
                <Button
                  onClick={handleBatchApprove}
                  disabled={isCreating || lineItems.length === 0}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {isCreating ? (
                    <ActionSpinner size={16} color="white" className="mr-2" />
                  ) : (
                    <Check className="h-4 w-4 mr-1.5" />
                  )}
                  {onNext ? 'Save Draft & Next' : 'Save Draft & Finish'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating || isSendingTest} className="order-last sm:order-first">
                Cancel
              </Button>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <Button
                  variant="outline"
                  onClick={() => handleCreateInvoice(false)}
                  disabled={isCreating || isSendingTest || lineItems.length === 0}
                >
                  {isCreating ? <ActionSpinner size={16} className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save as Draft
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleCreateInvoice(true)}
                  disabled={isCreating || isSendingTest || lineItems.length === 0}
                >
                  {isSendingTest ? <ActionSpinner size={16} className="mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                  Send Test Email
                </Button>
                <Button
                  onClick={handleSendToClient}
                  disabled={isCreating || isSendingTest || lineItems.length === 0}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {isCreating ? <ActionSpinner size={16} color="white" className="mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Send to Client
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Send Confirmation Modal */}
        {showSendConfirmation && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 p-8">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-6 h-6 text-yellow-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    ⚠️ Send Invoice to Client?
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-1 gap-4">
                      <span className="text-gray-600 flex-shrink-0">To:</span>
                      <span className="font-semibold text-gray-900 text-right break-all">{selectedRecipients.join(', ')}</span>
                    </div>
                    {emailCc && (
                      <div className="flex justify-between py-1">
                        <span className="text-gray-600">CC:</span>
                        <span className="font-semibold text-gray-900">{emailCc}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">Subject:</span>
                      <span className="font-semibold text-gray-900">{emailSubject}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">Client:</span>
                      <span className="font-semibold text-gray-900">{client.name}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">Amount:</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(totalAmount)}</span>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-red-50 border-2 border-red-300 rounded-lg">
                    <p className="text-sm text-red-800 font-semibold mb-2">
                      ⚠️ REAL CLIENT EMAIL MODE
                    </p>
                    <p className="text-xs text-red-700">
                      Requires ALLOW_REAL_CLIENT_EMAILS=true environment variable. If not set, email will go to TEST_EMAIL instead.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowSendConfirmation(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSendConfirmation(false)
                    handleCreateInvoice(true)
                  }}
                  className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                >
                  <TestTube className="w-4 h-4 mr-2" />
                  Send Test First
                </Button>
                <Button
                  onClick={handleConfirmSendToClient}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Yes, Send Now
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
