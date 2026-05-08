"use client"

import { useState, useMemo } from "react"
import { formatCurrency } from "@/lib/utils"
import {
  FileText,
  CheckCircle2,
  Clock,
  ChevronRight,
  RotateCcw,
  Zap,
  Search,
  AlertCircle,
  CheckCheck,
  X,
  Download,
  Info,
} from "lucide-react"
import Link from "next/link"
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns"
import { QuickInvoiceModal } from "./quick-invoice-modal"
import { CandidateCard, type InvoiceCandidate } from "./candidate-card"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"

function getJobSummary(entry: ClientEntry): string {
  const parts: string[] = []
  if (entry.completedJobs > 0 && entry.scheduledJobs > 0) {
    parts.push(`${entry.completedJobs} done, ${entry.scheduledJobs} upcoming`)
  } else {
    parts.push(`${entry.jobs.length} job${entry.jobs.length !== 1 ? 's' : ''}`)
  }
  return parts.join(' · ')
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
  candidateStats?: { readyCount: number; attentionCount: number; readyTotal: number } | null
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
  const [activeTab, setActiveTab] = useState<'ready' | 'drafts' | 'waiting' | 'paid'>('ready')
  const [searchQuery, setSearchQuery] = useState('')
  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientEntry | null>(null)
  const [selectedClientIndex, setSelectedClientIndex] = useState(0)
  const [batchMode, setBatchMode] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [markingInvoiced, setMarkingInvoiced] = useState(false)
  const [uninvoicingId, setUninvoicingId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMonth, setExportMonth] = useState('all')

  const handleBulkExport = async () => {
    setIsExporting(true)
    try {
      const statusMap: Record<string, string> = { drafts: 'DRAFT', waiting: 'SENT', paid: 'PAID' }
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

  const monthOptions = useMemo(() => {
    const options = [{ value: 'all', label: 'All' }]
    for (let i = 0; i < 6; i++) {
      const d = subMonths(new Date(), i)
      options.push({
        value: format(startOfMonth(d), 'yyyy-MM'),
        label: format(d, 'MMM yyyy'),
      })
    }
    return options
  }, [])

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
      if (activeTab === 'drafts') return i.status === 'DRAFT'
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
    const idx = monthFilteredClients.findIndex(c => c.client.id === entry.client.id)
    setSelectedClient(fullEntry)
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

  const handleBatchInvoice = () => {
    if (monthFilteredClients.length === 0) return
    // Pass the full (all-months) entry so modal can switch months
    const firstFiltered = monthFilteredClients[0]
    const fullEntry = allReadyClients.find(c => c.client.id === firstFiltered.client.id) || firstFiltered
    setSelectedClient(fullEntry)
    setSelectedClientIndex(0)
    setBatchMode(true)
    setQuickInvoiceOpen(true)
  }

  const handleReturnToReady = async (invoiceId: string, invoiceNumber: string, clientName: string) => {
    const confirmed = await confirm({
      title: "Return to Ready?",
      description: `Return this draft invoice to ready-to-bill?\n\nInvoice: ${invoiceNumber}\nClient: ${clientName}\n\nJobs will return to the ready-to-bill list.`,
      confirmText: "Return to Ready",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) return

    setUninvoicingId(invoiceId)
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to return invoice to ready')
        setUninvoicingId(null)
        return
      }

      const { showSuccess } = await import('@/lib/toast')
      showSuccess('Jobs returned to ready-to-bill list')
      onDataChange()
    } catch (error) {
      const { logger } = await import('@/lib/logger')
      logger.error('Error returning invoice to ready:', error)
      const { showError } = await import('@/lib/toast')
      showError('Failed to return invoice to ready. Please try again.')
    } finally {
      setUninvoicingId(null)
    }
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
    ? candidateStats.readyCount + candidateStats.attentionCount
    : filteredReadyCount
  const reviewQueueTotal = candidateStats
    ? candidateStats.readyTotal
    : filteredTotalReadyToBill

  // Separate candidates by status for rendering
  const readyCandidates = candidates.filter(c => c.status === 'READY')
  const attentionCandidates = candidates.filter(c => c.status === 'NEEDS_ATTENTION')
  const existingCandidates = candidates.filter(c => c.status === 'DRAFT_EXISTS' || c.status === 'SENT' || c.status === 'PAID')

  const handleCandidateReview = (candidate: InvoiceCandidate) => {
    // Find matching client in the legacy data to open QuickInvoice modal
    const matchingClient = allReadyClients.find(c => c.client.id === candidate.clientId)
    if (matchingClient) {
      handleQuickInvoice(matchingClient)
    }
  }

  const tabs = [
    { key: 'ready' as const,   label: 'Review Queue',   count: reviewQueueCount },
    { key: 'drafts' as const,  label: 'Drafts',  count: draftsCount       },
    { key: 'waiting' as const, label: 'Sent', count: waitingCount      },
    { key: 'paid' as const,    label: 'Paid',    count: paidCount         },
  ]

  return (
    <div className="w-full px-4 sm:px-6 py-6" style={{ maxWidth: '940px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#111111', lineHeight: '1.2', marginBottom: '4px' }}>
          Invoices
        </h1>
        <p style={{ fontSize: '14px', color: '#888888' }}>
          Manage and send invoices to your clients
        </p>
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

        {/* Month pills are rendered below the search bar */}

        {activeTab === 'ready' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectionMode ? (
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
                {filteredReadyCount > 1 && (
                  <button
                    onClick={handleBatchInvoice}
                    className="flex items-center gap-1.5"
                    style={{
                      padding: '8px 14px',
                      fontSize: '13px', fontWeight: 600,
                      color: 'white',
                      backgroundColor: '#00A896',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#008F7E' }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#00A896' }}
                  >
                    <Zap style={{ width: '14px', height: '14px' }} />
                    Batch All
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

      {/* Month filter for non-ready tabs */}
      {activeTab !== 'ready' && (
        <div
          className="flex items-center gap-1.5"
          style={{ marginBottom: '12px', overflowX: 'auto', paddingBottom: '2px' }}
        >
          {monthOptions.map(opt => {
            const isActive = exportMonth === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setExportMonth(opt.value)}
                style={{
                  padding: '6px 14px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#00A896' : '#555555',
                  backgroundColor: isActive ? 'rgba(0,168,150,0.12)' : '#F5F5F5',
                  border: isActive ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 120ms',
                  flexShrink: 0,
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Month Pills */}
      {activeTab === 'ready' && onDisplayMonthChange && (
        <div
          className="flex items-center gap-1.5"
          style={{ marginBottom: '12px', overflowX: 'auto', paddingBottom: '2px' }}
        >
          {monthOptions.map(opt => {
            const isActive = (displayMonth || 'all') === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onDisplayMonthChange(opt.value)}
                style={{
                  padding: '6px 14px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#00A896' : '#555555',
                  backgroundColor: isActive ? 'rgba(0,168,150,0.12)' : '#F5F5F5',
                  border: isActive ? '1px solid rgba(0,168,150,0.3)' : '1px solid transparent',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 120ms',
                  flexShrink: 0,
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Ready Tab: Summary */}
      {activeTab === 'ready' && reviewQueueTotal > 0 && (
        <div
          className="flex items-center justify-between"
          style={{ padding: '0 4px', marginBottom: '12px' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#111111' }}>
              {formatCurrency(reviewQueueTotal)}
            </span>
            <span style={{ fontSize: '13px', color: '#00A896', fontWeight: 500 }}>to invoice</span>
            <span style={{ color: '#DDDDDD', fontSize: '13px' }}>·</span>
            <span style={{ fontSize: '13px', color: '#888888' }}>
              {reviewQueueCount} client{reviewQueueCount !== 1 ? 's' : ''}
            </span>
            {candidateStats && candidateStats.attentionCount > 0 && (
              <>
                <span style={{ color: '#DDDDDD', fontSize: '13px' }}>·</span>
                <span style={{
                  fontSize: '12px', fontWeight: 600, color: '#92400E',
                  backgroundColor: '#FEF3C7', padding: '2px 8px', borderRadius: '10px',
                }}>
                  {candidateStats.attentionCount} need attention
                </span>
              </>
            )}
            {displayMonth && displayMonth !== 'all' && (
              <>
                <span style={{ color: '#DDDDDD', fontSize: '13px' }}>·</span>
                <span style={{ fontSize: '13px', color: '#888888' }}>
                  {monthOptions.find(o => o.value === displayMonth)?.label}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Older uninvoiced work alert */}
      {activeTab === 'ready' && olderUninvoiced && olderUninvoiced.count > 0 && onDisplayMonthChange && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 14px', marginBottom: '12px',
            backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px',
          }}
        >
          <Info style={{ width: '16px', height: '16px', color: '#EA580C', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', color: '#9A3412', flex: 1 }}>
            Older uninvoiced work exists:{' '}
            {olderUninvoiced.months.map((m, i) => {
              const [y, mo] = m.split('-').map(Number)
              const label = format(new Date(y, mo - 1), 'MMM yyyy')
              return (
                <button
                  key={m}
                  onClick={() => onDisplayMonthChange(m)}
                  style={{
                    color: '#EA580C', fontWeight: 600, background: 'none',
                    border: 'none', cursor: 'pointer', textDecoration: 'underline',
                    padding: 0, fontSize: '13px',
                  }}
                >
                  {label}{i < olderUninvoiced.months.length - 1 ? ', ' : ''}
                </button>
              )
            })}
          </span>
        </div>
      )}

      {/* ───── READY TAB: Review Queue ───── */}
      {activeTab === 'ready' && (
        <>
          {/* Candidate-based Review Queue (when candidates are loaded) */}
          {candidates.length > 0 && !candidatesLoading ? (
            <div className="space-y-4">
              {/* Needs Attention section */}
              {attentionCandidates.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
                    <h3 style={{ fontSize: '12px', fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Needs Attention
                    </h3>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, color: '#92400E',
                      backgroundColor: '#FEF3C7', padding: '1px 6px', borderRadius: '8px',
                    }}>
                      {attentionCandidates.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {attentionCandidates.map(c => (
                      <CandidateCard key={c.clientId} candidate={c} onReview={handleCandidateReview} />
                    ))}
                  </div>
                </div>
              )}

              {/* Ready to Review section */}
              {readyCandidates.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#00A896' }} />
                    <h3 style={{ fontSize: '12px', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Ready to Review
                    </h3>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, color: '#047857',
                      backgroundColor: '#D1FAE5', padding: '1px 6px', borderRadius: '8px',
                    }}>
                      {readyCandidates.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {readyCandidates.map(c => (
                      <CandidateCard key={c.clientId} candidate={c} onReview={handleCandidateReview} />
                    ))}
                  </div>
                </div>
              )}

              {/* Already invoiced section */}
              {existingCandidates.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#9CA3AF' }} />
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
                  <div className="space-y-2">
                    {existingCandidates.map(c => (
                      <CandidateCard key={c.clientId} candidate={c} onReview={handleCandidateReview} />
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
                    No uninvoiced clients remaining{displayMonth && displayMonth !== 'all' ? ` for ${monthOptions.find(o => o.value === displayMonth)?.label}` : ''}.
                  </p>
                  {draftsCount > 0 && (
                    <p style={{ fontSize: '13px', color: '#00A896', marginTop: '8px', fontWeight: 500 }}>
                      {draftsCount} draft invoice{draftsCount !== 1 ? 's' : ''} ready to send →
                    </p>
                  )}
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
                  <p style={{ fontSize: '14px', color: '#888888' }}>No uninvoiced clients remaining{displayMonth && displayMonth !== 'all' ? ` for ${monthOptions.find(o => o.value === displayMonth)?.label}` : ''}.</p>
                  {draftsCount > 0 && (
                    <p style={{ fontSize: '13px', color: '#00A896', marginTop: '8px', fontWeight: 500 }}>
                      {draftsCount} draft invoice{draftsCount !== 1 ? 's' : ''} ready to send →
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
                            <span>{entry.billingType === 'FLAT_RATE' ? 'Flat rate' : 'Per clean'}</span>
                            <span style={{ color: '#DDDDDD' }}>·</span>
                            <span>{jobSummary}</span>
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

      {/* ───── DRAFTS / WAITING / PAID TABS ───── */}
      {activeTab !== 'ready' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #EEEEEE', borderRadius: '12px', overflow: 'hidden' }}>
          {filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              {activeTab === 'drafts' && (
                <>
                  <FileText style={{ width: '40px', height: '40px', color: '#DDDDDD', marginBottom: '12px' }} />
                  <p style={{ fontSize: '16px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>
                    {searchQuery ? 'No results' : 'No draft invoices'}
                  </p>
                  <p style={{ fontSize: '14px', color: '#888888' }}>
                    {searchQuery ? `No drafts match "${searchQuery}"` : 'Create invoices from the Ready tab'}
                  </p>
                </>
              )}
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
                  gridTemplateColumns: activeTab === 'drafts'
                    ? 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) auto 28px'
                    : 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) 28px',
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
                {activeTab === 'drafts' && <div></div>}
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
                      gridTemplateColumns: activeTab === 'drafts'
                        ? 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) auto 28px'
                        : 'minmax(70px, auto) 1fr minmax(60px, auto) minmax(80px, auto) 28px',
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
                      {activeTab !== 'drafts' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC' }} />
                        </div>
                      )}
                    </Link>
                    {activeTab === 'drafts' && (
                      <div
                        className="flex items-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleReturnToReady(invoice.id, invoice.invoiceNumber, invoice.client?.name || 'Unknown')}
                          disabled={uninvoicingId === invoice.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '5px 10px',
                            fontSize: '12px', fontWeight: 500,
                            color: '#F59E0B',
                            backgroundColor: 'transparent',
                            border: '1px solid #F59E0B',
                            borderRadius: '6px',
                            cursor: uninvoicingId === invoice.id ? 'not-allowed' : 'pointer',
                            opacity: uninvoicingId === invoice.id ? 0.5 : 1,
                            whiteSpace: 'nowrap' as const,
                            transition: 'background-color 150ms',
                          }}
                        >
                          {uninvoicingId === invoice.id ? (
                            <>
                              <Clock style={{ width: '12px', height: '12px' }} className="animate-spin" />
                              Returning...
                            </>
                          ) : (
                            <>
                              <RotateCcw style={{ width: '12px', height: '12px' }} />
                              Return
                            </>
                          )}
                        </button>
                      </div>
                    )}
                    {activeTab === 'drafts' && (
                      <Link href={`/invoices/${invoice.id}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <ChevronRight style={{ width: '16px', height: '16px', color: '#CCCCCC' }} />
                      </Link>
                    )}
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
