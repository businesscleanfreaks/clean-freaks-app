"use client"

import { useState, useMemo } from "react"
import { formatCurrency } from "@/lib/utils"
import {
  CheckCircle2,
  Clock,
  ChevronRight,
  Zap,
  Search,
  AlertCircle,
  CheckCheck,
  X,
  Download,
  RotateCcw,
} from "lucide-react"
import Link from "next/link"
import { addMonths, format, startOfMonth, endOfMonth } from "date-fns"
import { QuickInvoiceModal } from "./quick-invoice-modal"
import { CandidateCard, type InvoiceCandidate } from "./candidate-card"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"

function getJobSummary(entry: ClientEntry): string {
  return entry.invoiceFrequency || `${entry.jobs.length} clean${entry.jobs.length === 1 ? '' : 's'}`
}

interface ReadyToBillJob {
  id: string
  date: string | Date
  clientRate: number
  scheduleId: string | null
  status: string
  location: {
    name: string
  }
  addOnServices?: Array<{
    id: string
    description: string
    clientRate: number
  }>
  schedule?: {
    defaultClientRate?: number | null
    recurringAddOnServices?: Array<{
      id: string
      description: string
      clientRate: number
    }>
  } | null
}

interface InvoiceListItem {
  id: string
  invoiceNumber: string
  clientId: string
  dateCreated: string | Date
  dateDue: string | Date | null
  totalAmount: number
  status: string
  client?: {
    id: string
    name: string
  } | null
  lineItems?: Array<{
    id: string
    amount: number
  }>
}

interface ClientEntry {
  client: {
    id: string
    name: string
    billingType: string
    invoiceFrequency?: string
    invoicingEmail?: string
    invoicingCcEmail?: string | null
    communicationEmail?: string
  }
  jobs: ReadyToBillJob[]
  totalAmount: number
  billingType: string
  invoiceFrequency: string
  jobsThisMonth: number
  completedJobs: number
  scheduledJobs: number
}

// Calculate the total amount for a client's jobs in a specific month
function calculateMonthTotal(entry: ClientEntry, month: string): number {
  const monthJobs = entry.jobs.filter(j => format(new Date(j.date), 'yyyy-MM') === month)
  if (monthJobs.length === 0) return 0

  if (entry.billingType === 'FLAT_RATE') {
    const scheduleRates = new Map<string, number>()
    const scheduleAddOns = new Map<string, number>()
    let oneOffTotal = 0

    monthJobs.forEach(job => {
      if (job.scheduleId) {
        if (!scheduleRates.has(job.scheduleId)) {
          scheduleRates.set(job.scheduleId, job.schedule?.defaultClientRate ?? job.clientRate)
          const addOnTotal = (job.schedule?.recurringAddOnServices || []).reduce((sum, a) => sum + a.clientRate, 0)
          scheduleAddOns.set(job.scheduleId, addOnTotal)
        }
      } else {
        oneOffTotal += job.clientRate
      }
      ;(job.addOnServices || []).forEach(a => { oneOffTotal += a.clientRate })
    })

    return Array.from(scheduleRates.values()).reduce((s, r) => s + r, 0)
      + Array.from(scheduleAddOns.values()).reduce((s, r) => s + r, 0)
      + oneOffTotal
  }

  // PER_CLEAN
  return monthJobs.reduce((sum, job) => {
    const addOns = (job.addOnServices || []).reduce((s, a) => s + a.clientRate, 0)
    return sum + job.clientRate + addOns
  }, 0)
}

interface InvoicesPageClientProps {
  flatRateClients: ClientEntry[]
  perCleanClients: ClientEntry[]
  totalReadyToBill: number
  draftsCount: number
  waitingCount: number
  paidCount: number
  readyCount: number
  invoices: InvoiceListItem[]
  onDataChange: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  displayMonth?: string
  onDisplayMonthChange?: (month: string) => void
  candidates?: InvoiceCandidate[]
  candidateStats?: { readyCount: number; attentionCount: number; draftCount?: number; readyTotal: number } | null
  candidatesLoading?: boolean
  olderUninvoiced?: { count: number; months: string[] } | null
}

export function InvoicesPageClient({
  flatRateClients,
  perCleanClients,
  totalReadyToBill,
  draftsCount,
  waitingCount,
  paidCount,
  readyCount,
  invoices,
  onDataChange,
  hasMore,
  loadingMore,
  onLoadMore,
  displayMonth,
  onDisplayMonthChange,
  candidates = [],
  candidateStats,
  candidatesLoading,
  olderUninvoiced,
}: InvoicesPageClientProps) {
  const [activeTab, setActiveTab] = useState<'ready' | 'waiting' | 'paid'>('ready')
  const [searchQuery, setSearchQuery] = useState('')
  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientEntry | null>(null)
  const [selectedClientIndex, setSelectedClientIndex] = useState(0)
  const [batchMode, setBatchMode] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [markingInvoiced, setMarkingInvoiced] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMonth, setExportMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [candidateSelectionMode, setCandidateSelectionMode] = useState(false)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set())
  const [selectedExistingCandidateIds, setSelectedExistingCandidateIds] = useState<Set<string>>(new Set())
  const [returningToReview, setReturningToReview] = useState(false)

  const handleBulkExport = async () => {
    setIsExporting(true)
    try {
      const statusMap: Record<string, string> = { waiting: 'SENT', paid: 'PAID' }
      const statusParam = statusMap[activeTab] || 'all'

      // Determine date range from month filter
      const monthValue = activeTab === 'ready' ? (displayMonth || 'all') : exportMonth
      let dateParams = ''
      if (monthValue && monthValue !== 'all') {
        const monthDate = new Date(monthValue + '-01')
        const start = format(startOfMonth(monthDate), 'yyyy-MM-dd')
        const end = format(endOfMonth(monthDate), 'yyyy-MM-dd')
        dateParams = `&start=${start}&end=${end}`
      }

      const res = await fetch(`/api/invoices/bulk-export?status=${statusParam}${dateParams}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const monthLabel = monthValue !== 'all' ? `_${monthValue}` : ''
      a.download = `Invoices_${statusParam}${monthLabel}_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      const { showError } = await import('@/lib/toast')
      showError('Failed to export invoices')
    } finally {
      setIsExporting(false)
    }
  }

  // All clients from API (unfiltered)
  const allReadyClients = useMemo(
    () => [...flatRateClients, ...perCleanClients],
    [flatRateClients, perCleanClients]
  )

  // Filter clients by displayMonth and recalculate amounts
  const monthFilteredClients = useMemo(() => {
    if (!displayMonth || displayMonth === 'all') {
      return allReadyClients
    }
    return allReadyClients
      .map(entry => {
        const monthJobs = entry.jobs.filter(j => format(new Date(j.date), 'yyyy-MM') === displayMonth)
        if (monthJobs.length === 0) return null
        return {
          ...entry,
          jobs: monthJobs,
          totalAmount: calculateMonthTotal(entry, displayMonth),
          completedJobs: monthJobs.filter(j => j.status === 'COMPLETED').length,
          scheduledJobs: monthJobs.filter(j => j.status !== 'COMPLETED').length,
        }
      })
      .filter((e): e is ClientEntry => e !== null)
  }, [allReadyClients, displayMonth])

  const filteredReadyCount = monthFilteredClients.length
  const filteredTotalReadyToBill = useMemo(() => {
    return monthFilteredClients.reduce((sum, e) => sum + e.totalAmount, 0)
  }, [monthFilteredClients])

  // Apply search on top of month-filtered clients
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return monthFilteredClients
    const q = searchQuery.toLowerCase()
    return monthFilteredClients.filter(entry =>
      entry.client.name.toLowerCase().includes(q)
    )
  }, [monthFilteredClients, searchQuery])

  const filteredInvoices = useMemo(() => {
    let inv = invoices.filter((i) => {
      if (activeTab === 'waiting') return i.status === 'SENT'
      if (activeTab === 'paid') return i.status === 'PAID'
      return false
    })
    // Apply month filter on non-ready tabs
    if (exportMonth && exportMonth !== 'all') {
      inv = inv.filter((i) => {
        const invoiceMonth = format(new Date(i.dateCreated), 'yyyy-MM')
        return invoiceMonth === exportMonth
      })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      inv = inv.filter((i) =>
        i.client?.name?.toLowerCase().includes(q) ||
        i.invoiceNumber?.toLowerCase().includes(q)
      )
    }
    return inv
  }, [invoices, activeTab, searchQuery, exportMonth])

  const handleQuickInvoice = (entry: ClientEntry) => {
    // Pass ALL jobs for this client (from unfiltered list) so modal can switch months
    const fullEntry = allReadyClients.find(c => c.client.id === entry.client.id) || entry
    const isScopedCandidate =
      entry.jobs.length !== fullEntry.jobs.length ||
      entry.client.name !== fullEntry.client.name
    const entryForModal = isScopedCandidate ? entry : fullEntry
    const idx = monthFilteredClients.findIndex(c => c.client.id === entry.client.id)
    setSelectedClient(entryForModal)
    setSelectedClientIndex(idx >= 0 ? idx : 0)
    setQuickInvoiceOpen(true)
  }

  const handleNextClient = () => {
    const nextIndex = selectedClientIndex + 1
    if (nextIndex < monthFilteredClients.length) {
      const nextFiltered = monthFilteredClients[nextIndex]
      const fullEntry = allReadyClients.find(c => c.client.id === nextFiltered.client.id) || nextFiltered
      setSelectedClient(fullEntry)
      setSelectedClientIndex(nextIndex)
    }
  }

  const handlePreviousClient = () => {
    const prevIndex = selectedClientIndex - 1
    if (prevIndex >= 0) {
      const prevFiltered = monthFilteredClients[prevIndex]
      const fullEntry = allReadyClients.find(c => c.client.id === prevFiltered.client.id) || prevFiltered
      setSelectedClient(fullEntry)
      setSelectedClientIndex(prevIndex)
    }
  }

  const handleQuickInvoiceSuccess = () => {
    onDataChange()
  }

  const handleMarkAsInvoiced = async () => {
    if (selectedJobIds.size === 0) return

    const confirmed = await confirm({
      title: "Mark Jobs as Invoiced?",
      description: `Mark ${selectedJobIds.size} selected job(s) as already invoiced? This will remove them from the ready-to-bill list.`,
      confirmText: "Mark as Invoiced",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    setMarkingInvoiced(true)
    try {
      const response = await fetch('/api/jobs/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobIds: Array.from(selectedJobIds),
          invoiced: true,
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to mark jobs as invoiced')
        setMarkingInvoiced(false)
        return
      }

      const { showSuccess } = await import('@/lib/toast')
      showSuccess(`${selectedJobIds.size} job(s) marked as invoiced`)
      setSelectedJobIds(new Set())
      setSelectionMode(false)
      onDataChange()
    } catch (error) {
      const { showError } = await import('@/lib/toast')
      showError('Failed to mark jobs as invoiced. Please try again.')
    } finally {
      setMarkingInvoiced(false)
    }
  }

  const toggleAllJobsForClient = (entry: ClientEntry) => {
    const clientJobIds = new Set(entry.jobs.map((job) => job.id))
    const allSelected = Array.from(clientJobIds).every(id => selectedJobIds.has(id))

    setSelectedJobIds(prev => {
      const newSet = new Set(prev)
      if (allSelected) {
        clientJobIds.forEach(id => newSet.delete(id))
      } else {
        clientJobIds.forEach(id => newSet.add(id))
      }
      return newSet
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedJobIds(new Set())
  }

  const selectedJobCount = selectedJobIds.size

  // Use candidate counts when available, fallback to legacy counts
  const reviewQueueCount = candidateStats
    ? candidateStats.readyCount + candidateStats.attentionCount + (candidateStats.draftCount || 0)
    : filteredReadyCount
  const reviewQueueTotal = candidateStats
    ? candidateStats.readyTotal
    : filteredTotalReadyToBill

  // Separate candidates by status for rendering
  const readyCandidates = candidates.filter(c => c.status === 'READY')
  const attentionCandidates = candidates.filter(c => c.status === 'NEEDS_ATTENTION')
  const existingCandidates = candidates.filter(c => c.status === 'DRAFT_EXISTS' || c.status === 'SENT' || c.status === 'PAID')
  const resettableExistingCandidates = useMemo(
    () => existingCandidates.filter(c => c.existingInvoiceStatus === 'DRAFT' || c.existingInvoiceStatus === 'MARKED_INVOICED'),
    [existingCandidates]
  )

  // Split actionable candidates (READY + NEEDS_ATTENTION) by billing type
  const actionableCandidates = useMemo(() => [...readyCandidates, ...attentionCandidates], [readyCandidates, attentionCandidates])
  const flatRateCandidates = useMemo(() => actionableCandidates.filter(c => c.billingType === 'FLAT_RATE'), [actionableCandidates])
  const perCleanCandidates = useMemo(() => actionableCandidates.filter(c => c.billingType !== 'FLAT_RATE'), [actionableCandidates])
  const cleanFlatRateCandidates = useMemo(
    () => flatRateCandidates.filter(c => c.status === 'READY' && c.exceptions.length === 0),
    [flatRateCandidates]
  )
  const flaggedFlatRateCandidates = useMemo(
    () => flatRateCandidates.filter(c => c.status !== 'READY' || c.exceptions.length > 0),
    [flatRateCandidates]
  )

  const toggleCandidateSelection = (clientId: string) => {
    setSelectedCandidateIds(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) {
        next.delete(clientId)
      } else {
        next.add(clientId)
      }
      return next
    })
  }

  const selectAllCandidates = () => {
    setSelectedCandidateIds(new Set(actionableCandidates.map(c => c.candidateId)))
  }

  const selectCleanFlatRateCandidates = () => {
    setCandidateSelectionMode(true)
    setSelectedCandidateIds(new Set(cleanFlatRateCandidates.map(c => c.candidateId)))
  }

  const clearCandidateSelection = () => {
    setSelectedCandidateIds(new Set())
  }

  const toggleExistingCandidateSelection = (candidateId: string) => {
    setSelectedExistingCandidateIds(prev => {
      const next = new Set(prev)
      if (next.has(candidateId)) {
        next.delete(candidateId)
      } else {
        next.add(candidateId)
      }
      return next
    })
  }

  const toggleAllResettableExisting = () => {
    const resettableIds = resettableExistingCandidates.map(c => c.candidateId)
    const allSelected = resettableIds.length > 0 && resettableIds.every(id => selectedExistingCandidateIds.has(id))
    setSelectedExistingCandidateIds(allSelected ? new Set() : new Set(resettableIds))
  }

  const handleReturnSelectedToReview = async () => {
    const selected = existingCandidates.filter(c => selectedExistingCandidateIds.has(c.candidateId))
    if (selected.length === 0) return

    const confirmed = await confirm({
      title: 'Return selected to Review?',
      description: `This will delete draft invoices or undo manual "already invoiced" marks for ${selected.length} item${selected.length === 1 ? '' : 's'}. Sent and paid invoices stay protected.`,
      confirmText: 'Return to Review',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    setReturningToReview(true)
    try {
      const response = await fetch('/api/invoices/bulk-return-to-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selected.map(candidate => ({
            invoiceId: candidate.existingInvoiceStatus === 'DRAFT' ? candidate.existingInvoiceId : undefined,
            jobIds: candidate.existingInvoiceStatus === 'MARKED_INVOICED' ? candidate.jobIds : [],
          })),
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to return selected items to Review')
        return
      }

      const result = await response.json().catch(() => ({}))
      const { showSuccess, showWarning } = await import('@/lib/toast')
      showSuccess(result.message || 'Selected items returned to Review')
      if (result.skippedInvoices?.length) {
        showWarning(`${result.skippedInvoices.length} sent/paid invoice${result.skippedInvoices.length === 1 ? '' : 's'} were left alone.`)
      }
      setSelectedExistingCandidateIds(new Set())
      onDataChange()
    } catch {
      const { showError } = await import('@/lib/toast')
      showError('Failed to return selected items to Review. Please try again.')
    } finally {
      setReturningToReview(false)
    }
  }

  const exitCandidateSelectionMode = () => {
    setCandidateSelectionMode(false)
    setSelectedCandidateIds(new Set())
    setSelectedExistingCandidateIds(new Set())
  }

  const handleBatchReviewSelected = () => {
    // Start batch mode with the first selected candidate
    const selectedList = actionableCandidates.filter(c => selectedCandidateIds.has(c.candidateId))
    if (selectedList.length === 0) return
    const firstCandidate = selectedList[0]
    const matchingClient = allReadyClients.find(c => c.client.id === firstCandidate.clientId)
    if (matchingClient) {
      const idx = monthFilteredClients.findIndex(c => c.client.id === firstCandidate.clientId)
      setSelectedClient(matchingClient)
      setSelectedClientIndex(idx >= 0 ? idx : 0)
      setBatchMode(true)
      setQuickInvoiceOpen(true)
    }
  }

  const handleCandidateReview = (candidate: InvoiceCandidate) => {
    // Find matching client in the legacy data to open QuickInvoice modal
    const matchingClient = allReadyClients.find(c => c.client.id === candidate.clientId)
    if (matchingClient) {
      const candidateJobIds = new Set(candidate.jobIds || [])
      const candidateScheduleIds = new Set(
        candidate.lineItems.map(item => item.scheduleId).filter(Boolean) as string[]
      )
      const scopedJobs = matchingClient.jobs.filter(job =>
        candidateJobIds.has(job.id) ||
        (job.scheduleId ? candidateScheduleIds.has(job.scheduleId) : false)
      )
      handleQuickInvoice({
        ...matchingClient,
        client: {
          ...matchingClient.client,
          name: candidate.clientName,
        },
        jobs: scopedJobs.length > 0 ? scopedJobs : matchingClient.jobs,
      })
    }
  }

  const tabs = [
    { key: 'ready' as const,   label: 'Not Sent', count: reviewQueueCount },
    { key: 'waiting' as const, label: 'Sent',     count: waitingCount     },
    { key: 'paid' as const,    label: 'Paid',     count: paidCount        },
  ]

  const activeMonth = activeTab === 'ready' ? (displayMonth || format(new Date(), 'yyyy-MM')) : exportMonth
  const activeMonthLabel = activeMonth === 'all'
    ? 'All'
    : format(new Date(`${activeMonth}-01T00:00:00`), 'MMM yyyy')
  const shiftActiveMonth = (delta: number) => {
    const base = activeMonth === 'all' ? new Date() : new Date(`${activeMonth}-01T00:00:00`)
    const next = format(addMonths(base, delta), 'yyyy-MM')
    if (activeTab === 'ready') {
      onDisplayMonthChange?.(next)
    } else {
      setExportMonth(next)
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6" style={{ maxWidth: '1080px', margin: '0 auto' }}>
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4" style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#111111', lineHeight: '1.2' }}>
          Invoices
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftActiveMonth(-1)}
              aria-label="Previous month"
              style={{
                width: '30px', height: '30px', borderRadius: '7px',
                border: '1px solid #E5E7EB', backgroundColor: 'white',
                color: '#64748B', fontSize: '17px', cursor: 'pointer',
              }}
            >
              ‹
            </button>
            <div style={{
              minWidth: '128px', height: '30px', borderRadius: '7px',
              border: '1px solid #E5E7EB', backgroundColor: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 700, color: '#111827',
            }}>
              {activeMonthLabel}
            </div>
            <button
              onClick={() => shiftActiveMonth(1)}
              aria-label="Next month"
              style={{
                width: '30px', height: '30px', borderRadius: '7px',
                border: '1px solid #E5E7EB', backgroundColor: 'white',
                color: '#64748B', fontSize: '17px', cursor: 'pointer',
              }}
            >
              ›
            </button>
          </div>
          {activeTab === 'ready' && !candidatesLoading && (
            <div style={{ textAlign: 'right', minWidth: '120px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#94A3B8', textTransform: 'uppercase' }}>
                To invoice
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(reviewQueueTotal)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center" style={{ borderBottom: '1px solid #EEEEEE', marginBottom: '16px' }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearchQuery('') }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 16px',
                marginBottom: '-1px',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #00A896' : '2px solid transparent',
                color: isActive ? '#111111' : '#888888',
                fontWeight: isActive ? 600 : 400,
                fontSize: '14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color 150ms',
              }}
            >
              {tab.label}
              <span style={{
                fontSize: '11px', fontWeight: 600,
                padding: '2px 6px', borderRadius: '10px',
                backgroundColor: isActive ? 'rgba(0,168,150,0.15)' : '#F5F5F5',
                color: isActive ? '#00A896' : '#888888',
              }}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search + Actions Bar */}
      <div className="flex items-center gap-3" style={{ marginBottom: '12px' }}>
        <div className="flex-1 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ width: '16px', height: '16px', color: '#BBBBBB' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'ready' ? 'Search clients...' : 'Search invoices...'}
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              fontSize: '14px',
              color: '#111111',
              backgroundColor: '#F7F7F7',
              border: '1px solid transparent',
              borderRadius: '10px',
              outline: 'none',
              transition: 'border-color 150ms, background-color 150ms',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#00A896'; e.currentTarget.style.backgroundColor = '#FFFFFF' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.backgroundColor = '#F7F7F7' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: '#BBBBBB', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
            >
              <X style={{ width: '14px', height: '14px' }} />
            </button>
          )}
        </div>

        {activeTab === 'ready' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {candidates.length > 0 && !candidatesLoading ? (
              selectedCandidateIds.size > 0 ? (
                <>
                  <button
                    onClick={clearCandidateSelection}
                    style={{
                      padding: '8px 12px',
                      fontSize: '13px', fontWeight: 500,
                      color: '#64748B',
                      backgroundColor: 'transparent',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                      cursor: 'pointer',
                    }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleBatchReviewSelected}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px',
                      fontSize: '13px', fontWeight: 600,
                      color: 'white',
                      backgroundColor: '#00A896',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                    }}
                  >
                    <Zap style={{ width: '14px', height: '14px' }} />
                    Review {selectedCandidateIds.size}
                  </button>
                </>
              ) : null
            ) : selectionMode ? (
              <>
                {selectedJobCount > 0 && (
                  <button
                    onClick={handleMarkAsInvoiced}
                    disabled={markingInvoiced}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px',
                      fontSize: '13px', fontWeight: 600,
                      color: 'white',
                      backgroundColor: '#F59E0B',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: markingInvoiced ? 'not-allowed' : 'pointer',
                      opacity: markingInvoiced ? 0.5 : 1,
                      transition: 'background-color 150ms',
                    }}
                  >
                    <CheckCheck style={{ width: '14px', height: '14px' }} />
                    {markingInvoiced ? 'Marking...' : `Mark ${selectedJobCount} Invoiced`}
                  </button>
                )}
                <button
                  onClick={exitSelectionMode}
                  style={{
                    padding: '8px 14px',
                    fontSize: '13px', fontWeight: 500,
                    color: '#00A896',
                    backgroundColor: 'transparent',
                    border: '1px solid #00A896',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {filteredReadyCount > 0 && (
                  <button
                    onClick={() => setSelectionMode(true)}
                    style={{
                      padding: '8px 14px',
                      fontSize: '13px', fontWeight: 500,
                      color: '#888888',
                      backgroundColor: 'transparent',
                      border: '1px solid #DDDDDD',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#BBBBBB' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDDDDD' }}
                  >
                    Select
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {activeTab !== 'ready' && (
          <button
            onClick={handleBulkExport}
            disabled={isExporting}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px',
              fontSize: '13px', fontWeight: 600,
              color: '#00A896',
              backgroundColor: 'transparent',
              border: '1px solid #00A896',
              borderRadius: '8px',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.5 : 1,
              transition: 'background-color 150ms',
              flexShrink: 0,
            }}
          >
            <Download style={{ width: '14px', height: '14px' }} />
            {isExporting ? 'Exporting...' : 'Download CSV'}
          </button>
        )}
      </div>

      {/* Ready Tab: Summary */}
      {activeTab === 'ready' && candidatesLoading && (
        <div
          className="flex items-center justify-between"
          style={{ padding: '0 4px', marginBottom: '12px' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: '18px', fontWeight: 600, color: '#64748B' }}>
              Loading invoices...
            </span>
          </div>
        </div>
      )}

      {/* READY TAB: Review Queue */}
      {activeTab === 'ready' && (
        <>
          {/* Candidate-based Review Queue (when candidates are loaded) */}
          {candidates.length > 0 && !candidatesLoading ? (
            <div className="space-y-4">
              {/* Two-column kanban for Flat Rate + Per Clean (stacks to one column on narrow screens) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              {/* ── Flat Rate Section ── */}
              {flatRateCandidates.length > 0 && (
                <div>
                  <div className="mb-2 px-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div style={{
                        fontSize: '12px', fontWeight: 800,
                        color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        Flat Rate
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280' }}>
                        {flatRateCandidates.length} client{flatRateCandidates.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ color: '#CBD5E1', fontSize: '12px' }}>·</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#4F46E5' }}>
                        {formatCurrency(flatRateCandidates.reduce((s, c) => s + c.total, 0))}
                      </span>
                      {cleanFlatRateCandidates.length > 0 && (
                        <button
                          onClick={selectCleanFlatRateCandidates}
                          style={{
                            marginLeft: 'auto',
                            padding: '5px 10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#4F46E5',
                            backgroundColor: 'white',
                            border: '1px solid #C7D2FE',
                            borderRadius: '8px',
                            cursor: 'pointer',
                          }}
                        >
                          Select all unchanged
                        </button>
                      )}
                    </div>
                    <p style={{ marginTop: '4px', fontSize: '12px', color: '#64748B' }}>
                      Same every month unless something changed
                    </p>
                  </div>
                  <div style={{ backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
                    {[...flaggedFlatRateCandidates, ...cleanFlatRateCandidates].map(c => (
                      <CandidateCard
                        key={c.candidateId}
                        candidate={c}
                        onReview={handleCandidateReview}
                        selectable={true}
                        selected={selectedCandidateIds.has(c.candidateId)}
                        onToggleSelect={toggleCandidateSelection}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Per Clean Section ── */}
              {perCleanCandidates.length > 0 && (
                <div>
                  <div className="mb-2 px-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div style={{
                        fontSize: '12px', fontWeight: 800,
                        color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        Per Clean
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280' }}>
                        {perCleanCandidates.length} client{perCleanCandidates.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ color: '#CBD5E1', fontSize: '12px' }}>·</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#15803D' }}>
                        {formatCurrency(perCleanCandidates.reduce((s, c) => s + c.total, 0))}
                      </span>
                    </div>
                    <p style={{ marginTop: '4px', fontSize: '12px', color: '#64748B' }}>
                      Amount varies - verify before sending
                    </p>
                  </div>
                  <div style={{ backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
                    {perCleanCandidates.map(c => (
                      <CandidateCard
                        key={c.candidateId}
                        candidate={c}
                        onReview={handleCandidateReview}
                        selectable={true}
                        selected={selectedCandidateIds.has(c.candidateId)}
                        onToggleSelect={toggleCandidateSelection}
                      />
                    ))}
                  </div>
                </div>
              )}
              </div>{/* /grid */}

              {/* ── Already Invoiced Section ── */}
              {existingCandidates.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <h3 style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Already Invoiced
                      </h3>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, color: '#6B7280',
                        backgroundColor: '#F3F4F6', padding: '1px 6px', borderRadius: '8px',
                      }}>
                        {existingCandidates.length}
                      </span>
                    </div>
                    {resettableExistingCandidates.length > 0 && (
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={toggleAllResettableExisting}
                          disabled={returningToReview}
                          style={{
                            padding: '5px 10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#64748B',
                            backgroundColor: 'white',
                            border: '1px solid #E5E7EB',
                            borderRadius: '8px',
                            cursor: returningToReview ? 'not-allowed' : 'pointer',
                            opacity: returningToReview ? 0.6 : 1,
                          }}
                        >
                          {resettableExistingCandidates.every(c => selectedExistingCandidateIds.has(c.candidateId)) ? 'Clear resettable' : 'Select resettable'}
                        </button>
                        {selectedExistingCandidateIds.size > 0 && (
                          <button
                            onClick={handleReturnSelectedToReview}
                            disabled={returningToReview}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 10px',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: 'white',
                              backgroundColor: '#0F766E',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: returningToReview ? 'not-allowed' : 'pointer',
                              opacity: returningToReview ? 0.7 : 1,
                            }}
                          >
                            <RotateCcw style={{ width: '13px', height: '13px' }} />
                            {returningToReview ? 'Returning...' : `Return ${selectedExistingCandidateIds.size} to Review`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
                    {existingCandidates.map(c => (
                      <CandidateCard
                        key={c.existingInvoiceId || c.candidateId}
                        candidate={c}
                        onReview={handleCandidateReview}
                        selectable={c.existingInvoiceStatus === 'DRAFT' || c.existingInvoiceStatus === 'MARKED_INVOICED'}
                        canSelectNonActionable
                        selected={selectedExistingCandidateIds.has(c.candidateId)}
                        onToggleSelect={toggleExistingCandidateSelection}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state when all are invoiced */}
              {readyCandidates.length === 0 && attentionCandidates.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px' }}
                >
                  <CheckCircle2 style={{ width: '40px', height: '40px', color: '#00A896', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>All invoiced!</p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>
                    No uninvoiced clients remaining{displayMonth && displayMonth !== 'all' ? ` for ${activeMonthLabel}` : ''}.
                  </p>
                  {draftsCount > 0 && (
                    <p style={{ fontSize: '13px', color: '#00A896', marginTop: '8px', fontWeight: 500 }}>
                      {draftsCount} draft invoice{draftsCount !== 1 ? 's' : ''} in Review
                    </p>
                  )}
                </div>
              )}

              {/* ── Sticky Batch Selection Bar ── */}
              {(candidateSelectionMode || selectedCandidateIds.size > 0) && (
                <div
                  style={{
                    position: 'sticky',
                    bottom: '0',
                    zIndex: 20,
                    margin: '0 -16px',
                    padding: '12px 20px',
                    backgroundColor: 'rgba(255,255,255,0.97)',
                    borderTop: '1px solid #E5E7EB',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    animation: 'slideUp 200ms ease-out',
                  }}
                >
                  <style>{`@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#111111' }}>
                      {selectedCandidateIds.size} selected
                    </span>
                    <span style={{ color: '#DDDDDD' }}>·</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#00A896' }}>
                      {formatCurrency(actionableCandidates.filter(c => selectedCandidateIds.has(c.candidateId)).reduce((s, c) => s + c.total, 0))}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedCandidateIds.size === actionableCandidates.length) {
                        clearCandidateSelection()
                      } else {
                        selectAllCandidates()
                      }
                    }}
                    style={{
                      padding: '7px 14px', fontSize: '13px', fontWeight: 500,
                      color: '#555555', backgroundColor: '#F5F5F5',
                      border: '1px solid #E5E7EB', borderRadius: '8px',
                      cursor: 'pointer', transition: 'background-color 120ms',
                    }}
                  >
                    {selectedCandidateIds.size === actionableCandidates.length ? 'Clear All' : 'Select All'}
                  </button>
                  {cleanFlatRateCandidates.length > 0 && (
                    <button
                      onClick={selectCleanFlatRateCandidates}
                      style={{
                        padding: '7px 14px', fontSize: '13px', fontWeight: 500,
                        color: '#4F46E5', backgroundColor: '#EEF2FF',
                        border: '1px solid #C7D2FE', borderRadius: '8px',
                        cursor: 'pointer', transition: 'background-color 120ms',
                      }}
                    >
                      Select unchanged
                    </button>
                  )}
                  <button
                    onClick={exitCandidateSelectionMode}
                    style={{
                      padding: '7px 14px', fontSize: '13px', fontWeight: 500,
                      color: '#555555', backgroundColor: '#F5F5F5',
                      border: '1px solid #E5E7EB', borderRadius: '8px',
                      cursor: 'pointer', transition: 'background-color 120ms',
                    }}
                  >
                    Done
                  </button>
                  <button
                    onClick={handleBatchReviewSelected}
                    disabled={selectedCandidateIds.size === 0}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 18px', fontSize: '13px', fontWeight: 600,
                      color: 'white', backgroundColor: '#00A896',
                      border: 'none', borderRadius: '8px',
                      cursor: selectedCandidateIds.size === 0 ? 'not-allowed' : 'pointer',
                      opacity: selectedCandidateIds.size === 0 ? 0.5 : 1,
                      transition: 'background-color 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#008F7E' }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#00A896' }}
                  >
                    <Zap style={{ width: '14px', height: '14px' }} />
                    Review Selected
                  </button>
                </div>
              )}
            </div>
          ) : candidatesLoading ? (
            /* Loading skeleton for candidates */
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  style={{
                    height: '64px', borderRadius: '12px',
                    backgroundColor: '#F9FAFB', border: '1px solid #F3F4F6',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              ))}
            </div>
          ) : (
            /* Fallback: legacy client list when candidates aren't available */
            <>
              {filteredReadyCount === 0 && !searchQuery ? (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px' }}
                >
                  <CheckCircle2 style={{ width: '40px', height: '40px', color: '#00A896', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>All invoiced!</p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>No uninvoiced clients remaining{displayMonth && displayMonth !== 'all' ? ` for ${activeMonthLabel}` : ''}.</p>
                  {draftsCount > 0 && (
                    <p style={{ fontSize: '13px', color: '#00A896', marginTop: '8px', fontWeight: 500 }}>
                      {draftsCount} draft invoice{draftsCount !== 1 ? 's' : ''} in Review
                    </p>
                  )}
                </div>
              ) : filteredClients.length === 0 && searchQuery ? (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px' }}
                >
                  <Search style={{ width: '40px', height: '40px', color: '#DDDDDD', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>No results</p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>No clients match &ldquo;{searchQuery}&rdquo;</p>
                </div>
              ) : (
                <div style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px', overflow: 'hidden' }}>
                  {filteredClients.map((entry, idx) => {
                    const hasEmail = !!entry.client.invoicingEmail || !!entry.client.communicationEmail
                    const isLast = idx === filteredClients.length - 1
                    const jobSummary = getJobSummary(entry)

                    const clientJobIds = entry.jobs.map((job) => job.id)
                    const allSelected = selectionMode && clientJobIds.length > 0 && clientJobIds.every((id: string) => selectedJobIds.has(id))
                    const someSelected = selectionMode && clientJobIds.some((id: string) => selectedJobIds.has(id))

                    return (
                      <div
                        key={entry.client.id}
                        onClick={() => {
                          if (selectionMode) {
                            toggleAllJobsForClient(entry)
                          } else {
                            handleQuickInvoice(entry)
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '14px 16px',
                          cursor: 'pointer',
                          borderBottom: isLast ? 'none' : '1px solid #F3F3F3',
                          transition: 'background-color 80ms',
                          backgroundColor: allSelected ? 'rgba(0,168,150,0.04)' : 'white',
                        }}
                        onMouseEnter={e => { if (!allSelected) e.currentTarget.style.backgroundColor = '#FAFAFA' }}
                        onMouseLeave={e => { if (!allSelected) e.currentTarget.style.backgroundColor = allSelected ? 'rgba(0,168,150,0.04)' : 'white' }}
                      >
                        {selectionMode && (
                          <div
                            style={{
                              width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0,
                              border: allSelected ? '2px solid #00A896' : someSelected ? '2px solid #00A896' : '2px solid #DDDDDD',
                              backgroundColor: allSelected ? '#00A896' : someSelected ? 'rgba(0,168,150,0.15)' : 'white',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 120ms',
                            }}
                          >
                            {allSelected && <span style={{ color: 'white', fontSize: '12px', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                            {someSelected && !allSelected && <span style={{ color: '#00A896', fontSize: '10px', lineHeight: 1, fontWeight: 700 }}>–</span>}
                          </div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{
                              fontSize: '15px', fontWeight: 600, color: '#111111',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {entry.client.name}
                            </span>
                            {!hasEmail && (
                              <span title="No email on file" style={{ flexShrink: 0, display: 'flex' }}>
                                <AlertCircle style={{ width: '14px', height: '14px', color: '#F59E0B' }} />
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#777777', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              padding: 0, borderRadius: 0,
                              fontSize: '12px', fontWeight: 500,
                              backgroundColor: 'transparent',
                              color: '#777777',
                            }}>
                              {jobSummary}
                            </span>
                            {!hasEmail && <span style={{ color: '#DDDDDD' }}>·</span>}
                            {!hasEmail && <span style={{ color: '#92400E', fontWeight: 600 }}>Email needed</span>}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontSize: '15px', fontWeight: 700, color: '#111111' }}>
                            {formatCurrency(entry.totalAmount)}
                          </span>
                        </div>

                        {!selectionMode && (
                          <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC', flexShrink: 0 }} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
      {/* Sent / Paid tabs */}
      {activeTab !== 'ready' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px', overflow: 'hidden' }}>
          {filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              {activeTab === 'waiting' && (
                <>
                  <Clock style={{ width: '40px', height: '40px', color: '#DDDDDD', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>
                    {searchQuery ? 'No results' : 'No pending payments'}
                  </p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>
                    {searchQuery ? `No invoices match "${searchQuery}"` : 'All invoices have been paid!'}
                  </p>
                </>
              )}
              {activeTab === 'paid' && (
                <>
                  <CheckCircle2 style={{ width: '40px', height: '40px', color: '#DDDDDD', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>
                    {searchQuery ? 'No results' : 'No paid invoices yet'}
                  </p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>
                    {searchQuery ? `No invoices match "${searchQuery}"` : 'Paid invoices will appear here'}
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Table Header */}
              <div
                className="hidden sm:grid gap-4 items-center"
                style={{
                  gridTemplateColumns: 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) 28px',
                  padding: '8px 16px',
                  backgroundColor: '#FAFAFA',
                  borderBottom: '1px solid #EEEEEE',
                  fontSize: '11px', fontWeight: 600, color: '#999999',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.5px',
                }}
              >
                <div>Invoice</div>
                <div>Client</div>
                <div style={{ textAlign: 'right' }}>Date</div>
                <div style={{ textAlign: 'right' }}>Amount</div>
                <div></div>
              </div>

              {/* Invoice Rows */}
              {filteredInvoices.map((invoice, idx) => {
                const isLast = idx === filteredInvoices.length - 1 && !hasMore
                return (
                  <div
                    key={invoice.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) 28px',
                      gap: '16px',
                      alignItems: 'center',
                      padding: '10px 16px',
                      borderBottom: isLast ? 'none' : '1px solid #F3F3F3',
                      transition: 'background-color 80ms',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#FAFAFA' }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white' }}
                  >
                    <Link href={`/invoices/${invoice.id}`} className="contents group">
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111111' }}>
                          #{invoice.invoiceNumber}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: '14px', color: '#555555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {invoice.client?.name}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '12px', color: '#999999' }}>
                          {format(new Date(invoice.dateCreated), "MMM d")}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#111111' }}>
                          {formatCurrency(invoice.totalAmount)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC' }} />
                      </div>
                    </Link>
                  </div>
                )
              })}

              {/* Load More Button */}
              {hasMore && onLoadMore && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderTop: '1px solid #F3F3F3',
                    textAlign: 'center',
                  }}
                >
                  <button
                    onClick={onLoadMore}
                    disabled={loadingMore}
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: loadingMore ? '#BBBBBB' : '#00A896',
                      background: 'none',
                      border: 'none',
                      cursor: loadingMore ? 'not-allowed' : 'pointer',
                      padding: '4px 12px',
                    }}
                  >
                    {loadingMore ? 'Loading...' : 'Load more invoices'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Invoice Modal (single + batch mode) */}
      {selectedClient && (
        <QuickInvoiceModal
          key={selectedClient.client.id}
          open={quickInvoiceOpen}
          onOpenChange={(open) => {
            setQuickInvoiceOpen(open)
            if (!open) setBatchMode(false)
          }}
          client={{
            id: selectedClient.client.id,
            name: selectedClient.client.name,
            billingType: selectedClient.billingType,
            invoicingEmail: selectedClient.client.invoicingEmail || null,
            invoicingCcEmail: selectedClient.client.invoicingCcEmail || null,
            communicationEmail: selectedClient.client.communicationEmail || null,
          }}
          jobs={selectedClient.jobs}
          initialMonth={displayMonth}
          onSuccess={handleQuickInvoiceSuccess}
          onNext={selectedClientIndex < monthFilteredClients.length - 1 ? handleNextClient : undefined}
          onPrevious={selectedClientIndex > 0 ? handlePreviousClient : undefined}
          currentIndex={selectedClientIndex}
          totalCount={monthFilteredClients.length}
          batchMode={batchMode}
        />
      )}
      <ConfirmDialog />
    </div>
  )
}
