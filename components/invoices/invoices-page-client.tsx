"use client"

import { useState, useMemo, useEffect } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { addMonths, format, startOfMonth, endOfMonth } from "date-fns"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import { QuickInvoiceModal } from "./quick-invoice-modal"
import {
  CandidateCard,
  money0,
  MO,
  TEAL,
  sDot,
  type InvoiceCandidate,
  type InvoiceUiStatus,
} from "./candidate-card"

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

// ── Display helpers (adapt server candidates → prototype's card model) ──
type DisplayType = 'Flat Rate' | 'Per Clean' | 'One-Time'

interface DisplayCandidate {
  candidate: InvoiceCandidate
  uiStatus: InvoiceUiStatus
  displayType: DisplayType
  freqLabel: string
  billingLabel: string
  email?: string
}

// Client.invoiceFrequency enum → the prototype's "Invoiced" cadence labels
const CADENCE_LABEL: Record<string, string> = {
  AFTER_EACH_CLEAN: 'After Clean',
  BI_WEEKLY: 'Weekly',
  END_OF_MONTH: 'Monthly',
  CUSTOM: 'Custom',
}

const STATUS_ORDER: Record<InvoiceUiStatus, number> = { 'Not Sent': 0, Sent: 1, Paid: 2 }

function deriveUiStatus(status: InvoiceCandidate['status']): InvoiceUiStatus {
  if (status === 'SENT') return 'Sent'
  if (status === 'PAID') return 'Paid'
  return 'Not Sent' // READY, NEEDS_ATTENTION, DRAFT_EXISTS
}

function deriveDisplayType(c: InvoiceCandidate): DisplayType {
  if (c.billingType === 'FLAT_RATE') return 'Flat Rate'
  // Per-clean family: distinguish one-off work (no recurring schedule) from recurring per-clean.
  if (c.lineItems.length > 0) {
    const anyScheduled = c.lineItems.some(li => !!li.scheduleId)
    return anyScheduled ? 'Per Clean' : 'One-Time'
  }
  // Existing-invoice rows carry no line items — fall back to Per Clean to avoid
  // mis-bucketing recurring clients into the One-Time column.
  return 'Per Clean'
}

function deriveFreqLabel(c: InvoiceCandidate, displayType: DisplayType): string {
  const s = (c.scheduleSummary || '').trim()
  if (s && s !== 'No active schedule') return s
  if (displayType === 'One-Time') return 'One-time'
  return '—'
}

export function InvoicesPageClient({
  flatRateClients,
  perCleanClients,
  onDataChange,
  displayMonth,
  onDisplayMonthChange,
  candidates = [],
  candidatesLoading,
}: InvoicesPageClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState<'All' | InvoiceUiStatus>('All')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [confirmSend, setConfirmSend] = useState<'sel' | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [markingSent, setMarkingSent] = useState(false)
  // Portal target — the floating bar renders into document.body so it isn't
  // trapped by the page's transformed `.animate-in` wrapper (which would pin a
  // position:fixed element to the content bottom instead of the viewport).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const [isExporting, setIsExporting] = useState(false)

  // Invoice review modal (the detail/edit/send surface — reuses the tested flow)
  const [selectedClient, setSelectedClient] = useState<ClientEntry | null>(null)
  const [selectedClientIndex, setSelectedClientIndex] = useState(0)
  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  // Batch-send queue: the selected candidates, walked in order by the modal's ‹ ›
  const [batchQueue, setBatchQueue] = useState<InvoiceCandidate[]>([])
  const [batchPos, setBatchPos] = useState(0)

  // Ordered list of clients with billable jobs (for the review modal + navigation)
  const navClients = useMemo(
    () => [...flatRateClients, ...perCleanClients].sort((a, b) => a.client.name.localeCompare(b.client.name)),
    [flatRateClients, perCleanClients]
  )

  // clientId → invoice cadence + email (candidates don't carry these directly)
  const clientInfo = useMemo(() => {
    const m = new Map<string, { freq?: string; email?: string }>()
    ;[...flatRateClients, ...perCleanClients].forEach(e => {
      m.set(e.client.id, {
        freq: e.invoiceFrequency,
        email: e.client.invoicingEmail || e.client.communicationEmail || undefined,
      })
    })
    return m
  }, [flatRateClients, perCleanClients])

  const displayCandidates = useMemo<DisplayCandidate[]>(() => {
    return candidates.map(c => {
      const uiStatus = deriveUiStatus(c.status)
      const displayType = deriveDisplayType(c)
      const freqLabel = deriveFreqLabel(c, displayType)
      const info = clientInfo.get(c.clientId)
      const billingLabel = displayType === 'One-Time'
        ? 'After Clean'
        : (info?.freq ? (CADENCE_LABEL[info.freq] || 'Monthly') : 'Monthly')
      return { candidate: c, uiStatus, displayType, freqLabel, billingLabel, email: info?.email }
    })
  }, [candidates, clientInfo])

  // Three-stat totals (computed across all candidates, regardless of filter)
  const stats = useMemo(() => {
    let notSent = 0, sent = 0, paid = 0
    displayCandidates.forEach(d => {
      if (d.uiStatus === 'Sent') sent += d.candidate.total
      else if (d.uiStatus === 'Paid') paid += d.candidate.total
      else notSent += d.candidate.total
    })
    return { notSent, sent, paid }
  }, [displayCandidates])

  // Status-filter + search, split into the three columns
  const { flatList, perList, otList } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = (d: DisplayCandidate) =>
      (fStatus === 'All' || d.uiStatus === fStatus) &&
      (!q || d.candidate.clientName.toLowerCase().includes(q))
    const sortFn = (a: DisplayCandidate, b: DisplayCandidate) =>
      STATUS_ORDER[a.uiStatus] - STATUS_ORDER[b.uiStatus] ||
      a.candidate.clientName.localeCompare(b.candidate.clientName)
    const visible = displayCandidates.filter(matches)
    return {
      flatList: visible.filter(d => d.displayType === 'Flat Rate').sort(sortFn),
      perList: visible.filter(d => d.displayType === 'Per Clean').sort(sortFn),
      otList: visible.filter(d => d.displayType === 'One-Time').sort(sortFn),
    }
  }, [displayCandidates, fStatus, search])

  const selectedList = useMemo(
    () => displayCandidates.filter(d => sel.has(d.candidate.candidateId)),
    [displayCandidates, sel]
  )
  const selTotal = selectedList.reduce((s, d) => s + d.candidate.total, 0)

  // ── Selection ──
  const toggleSelect = (id: string) => setSel(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const selectColumn = (list: DisplayCandidate[]) => {
    const ids = list.filter(d => d.uiStatus === 'Not Sent').map(d => d.candidate.candidateId)
    if (ids.length === 0) return
    setSel(prev => {
      const n = new Set(prev)
      const allSelected = ids.every(id => n.has(id))
      if (allSelected) ids.forEach(id => n.delete(id))
      else ids.forEach(id => n.add(id))
      return n
    })
  }

  // ── Review modal ──
  const openReviewModal = (candidate: InvoiceCandidate, batch: boolean) => {
    const matchingClient = navClients.find(c => c.client.id === candidate.clientId)
    if (!matchingClient) {
      showError('Unable to open this client for review.')
      return
    }
    const candidateJobIds = new Set(candidate.jobIds || [])
    const candidateScheduleIds = new Set(
      candidate.lineItems.map(item => item.scheduleId).filter(Boolean) as string[]
    )
    const scopedJobs = matchingClient.jobs.filter(job =>
      candidateJobIds.has(job.id) ||
      (job.scheduleId ? candidateScheduleIds.has(job.scheduleId) : false)
    )
    const entryForModal: ClientEntry = {
      ...matchingClient,
      client: { ...matchingClient.client, name: candidate.clientName },
      jobs: scopedJobs.length > 0 ? scopedJobs : matchingClient.jobs,
    }
    const idx = navClients.findIndex(c => c.client.id === candidate.clientId)
    setSelectedClient(entryForModal)
    setSelectedClientIndex(idx >= 0 ? idx : 0)
    setBatchMode(batch)
    setActiveCandidateId(candidate.candidateId)
    setQuickInvoiceOpen(true)
  }

  const openDetail = (candidate: InvoiceCandidate) => {
    // Existing invoices (draft / sent / paid) have their own detail page.
    if (candidate.existingInvoiceId) {
      router.push(`/invoices/${candidate.existingInvoiceId}`)
      return
    }
    openReviewModal(candidate, false)
  }

  const handleNextClient = () => {
    // Batch send: advance through the selected queue (candidate-scoped), not all clients.
    if (batchMode) {
      const next = batchPos + 1
      if (next < batchQueue.length) {
        setBatchPos(next)
        openReviewModal(batchQueue[next], true)
      }
      return
    }
    const next = selectedClientIndex + 1
    if (next < navClients.length) {
      setSelectedClient(navClients[next])
      setSelectedClientIndex(next)
    }
  }

  const handlePreviousClient = () => {
    if (batchMode) {
      const prev = batchPos - 1
      if (prev >= 0) {
        setBatchPos(prev)
        openReviewModal(batchQueue[prev], true)
      }
      return
    }
    const prev = selectedClientIndex - 1
    if (prev >= 0) {
      setSelectedClient(navClients[prev])
      setSelectedClientIndex(prev)
    }
  }

  // ── Send (confirmation gate → tested review/send modal) ──
  // Builds a queue from the current selection and opens the modal on the first
  // item in batch mode; the modal's ‹ › then walks only the selected invoices.
  const executeSend = () => {
    setConfirmSend(null)
    const queue = selectedList.map(d => d.candidate)
    if (queue.length === 0) return
    setBatchQueue(queue)
    setBatchPos(0)
    openReviewModal(queue[0], true)
  }

  // ── Ensure an invoice record exists for a candidate ──
  // Used by "Mark Sent" / "Mark Paid" so invoices handled outside the app can be
  // recorded. Reuses the exact creation path the Send flow uses:
  // POST /api/invoices (previewOnly → VOID) then finalize (→ DRAFT + marks jobs invoiced).
  const ensureInvoiceId = async (candidate: InvoiceCandidate): Promise<string | null> => {
    if (candidate.existingInvoiceId) return candidate.existingInvoiceId
    if (!candidate.jobIds || candidate.jobIds.length === 0) {
      showError(`${candidate.clientName}: open and send this one manually (no billable cleans to record).`)
      return null
    }
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: candidate.clientId,
        jobIds: candidate.jobIds,
        previewOnly: true,
        showPaymentOptions: true,
        lineItems: candidate.lineItems.map(li => ({
          description: li.description,
          amount: li.quantity * li.price,
          jobId: li.jobId || null,
          addOnServiceId: li.sourceType === 'ADD_ON' ? (li.sourceId || null) : null,
          serviceDate: new Date().toISOString(),
        })),
      }),
    })
    if (res.status === 409) {
      // An invoice already exists for these jobs/period — use it.
      const body = await res.json().catch(() => null)
      const existingId = body?.existingInvoice?.id
      if (existingId) return existingId
    }
    if (!res.ok) {
      await showApiError(res, `Failed to create invoice for ${candidate.clientName}`)
      return null
    }
    const inv = await res.json()
    await fetch(`/api/invoices/${inv.id}/finalize`, { method: 'POST' })
    return inv.id as string
  }

  // ── Mark paid (creates the invoice first if it was handled outside the app) ──
  const markCandidatePaid = async (candidate: InvoiceCandidate) => {
    try {
      const invoiceId = await ensureInvoiceId(candidate)
      if (!invoiceId) return
      const res = await fetch(`/api/invoices/${invoiceId}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: 'MANUAL', paymentNotes: 'Marked as paid from review queue' }),
      })
      if (!res.ok) {
        await showApiError(res, 'Failed to mark invoice as paid')
        return
      }
      showSuccess('Invoice marked as paid')
      onDataChange()
    } catch {
      showError('Failed to mark invoice as paid')
    }
  }

  const markSelectedPaid = async () => {
    if (selectedList.length === 0) return
    setMarkingPaid(true)
    try {
      const results = await Promise.allSettled(
        selectedList.map(async d => {
          const invoiceId = await ensureInvoiceId(d.candidate)
          if (!invoiceId) throw new Error('no-invoice')
          const res = await fetch(`/api/invoices/${invoiceId}/mark-paid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentMethod: 'MANUAL', paymentNotes: 'Marked as paid from review queue' }),
          })
          if (!res.ok) throw new Error('failed')
        })
      )
      const ok = results.filter(r => r.status === 'fulfilled').length
      if (ok > 0) {
        showSuccess(`${ok} invoice${ok > 1 ? 's' : ''} marked as paid`)
      } else {
        showError('Failed to mark invoices as paid')
      }
      setSel(new Set())
      onDataChange()
    } finally {
      setMarkingPaid(false)
    }
  }

  // ── Mark sent (records invoices sent to clients outside the app) ──
  const markSelectedSent = async () => {
    // Only act on Not-Sent selections (Sent/Paid are already handled).
    const targets = selectedList.filter(d => d.uiStatus === 'Not Sent')
    if (targets.length === 0) return
    setMarkingSent(true)
    try {
      const results = await Promise.allSettled(
        targets.map(async d => {
          const invoiceId = await ensureInvoiceId(d.candidate)
          if (!invoiceId) throw new Error('no-invoice')
          const res = await fetch(`/api/invoices/${invoiceId}/mark-sent`, { method: 'POST' })
          if (!res.ok) throw new Error('failed')
        })
      )
      const ok = results.filter(r => r.status === 'fulfilled').length
      if (ok > 0) {
        showSuccess(`${ok} invoice${ok > 1 ? 's' : ''} marked as sent`)
      } else {
        showError('Failed to mark invoices as sent')
      }
      setSel(new Set())
      onDataChange()
    } finally {
      setMarkingSent(false)
    }
  }

  // ── CSV export (month-scoped) ──
  const handleBulkExport = async () => {
    setIsExporting(true)
    try {
      const statusParam = fStatus === 'Sent' ? 'SENT' : fStatus === 'Paid' ? 'PAID' : 'all'
      const base = displayMonth && displayMonth !== 'all' ? displayMonth : format(new Date(), 'yyyy-MM')
      const monthDate = new Date(`${base}-01T00:00:00`)
      const start = format(startOfMonth(monthDate), 'yyyy-MM-dd')
      const end = format(endOfMonth(monthDate), 'yyyy-MM-dd')
      const res = await fetch(`/api/invoices/bulk-export?status=${statusParam}&start=${start}&end=${end}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Invoices_${statusParam}_${base}_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      showError('Failed to export invoices')
    } finally {
      setIsExporting(false)
    }
  }

  // ── Month picker ──
  const baseMonth = displayMonth && displayMonth !== 'all' ? displayMonth : format(new Date(), 'yyyy-MM')
  const monthLabel = format(new Date(`${baseMonth}-01T00:00:00`), 'MMMM yyyy')
  const shiftMonth = (delta: number) =>
    onDisplayMonthChange?.(format(addMonths(new Date(`${baseMonth}-01T00:00:00`), delta), 'yyyy-MM'))

  // ── Column renderer ──
  const renderColumn = (title: DisplayType, list: DisplayCandidate[]) => {
    const total = list.reduce((s, d) => s + d.candidate.total, 0)
    const nsIds = list.filter(d => d.uiStatus === 'Not Sent').map(d => d.candidate.candidateId)
    const allChecked = nsIds.length > 0 && nsIds.every(id => sel.has(id))
    const isOneTime = title === 'One-Time'
    return (
      <div key={title} style={{ flex: isOneTime ? '0 0 auto' : 1, minWidth: isOneTime ? 200 : 0 }}>
        {/* Column header bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 10px', background: '#fff', borderRadius: 6, border: '1px solid #E2E8F0' }}>
          {nsIds.length > 0 && (
            <button
              type="button"
              aria-label={`Select all ${title} invoices`}
              onClick={() => selectColumn(list)}
              style={{ all: 'unset', width: 14, height: 14, borderRadius: 3, border: allChecked ? 'none' : '1.5px solid #D0D5DD', background: allChecked ? TEAL : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              {allChecked && (
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                  <path d="M2.5 6L5 8.5 9.5 3.5" />
                </svg>
              )}
            </button>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{title}</span>
          <span style={{ fontSize: 10, color: '#94A3B8', background: '#F1F5F9', padding: '0 6px', borderRadius: 8 }}>{list.length}</span>
          <span style={{ fontSize: 11, fontFamily: MO, fontWeight: 600, color: '#64748B', marginLeft: 'auto' }}>{money0(total)}</span>
        </div>
        {/* Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {list.length > 0 ? (
            list.map(d => (
              <CandidateCard
                key={d.candidate.candidateId}
                candidate={d.candidate}
                uiStatus={d.uiStatus}
                freqLabel={d.freqLabel}
                billingLabel={d.billingLabel}
                selected={sel.has(d.candidate.candidateId)}
                selectable
                active={activeCandidateId === d.candidate.candidateId}
                onOpen={openDetail}
                onToggleSelect={toggleSelect}
                onMarkPaid={markCandidatePaid}
              />
            ))
          ) : (
            <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 11, color: '#CBD5E1', background: '#fff', borderRadius: 6, border: '1px dashed #E2E8F0' }}>
              No invoices
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: "'Outfit',-apple-system,sans-serif", background: '#F1F5F9', minHeight: '100vh', padding: '20px 28px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');@keyframes ti{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}@keyframes fadeIn{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}`}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* ── Header: title + month picker + three-stat totals ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Invoices</h1>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E8F0', borderRadius: 7, padding: '3px 10px', marginTop: 4, background: '#fff' }}>
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" style={{ all: 'unset', fontSize: 14, lineHeight: 1, color: '#94A3B8', cursor: 'pointer', padding: '0 2px' }}>‹</button>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', minWidth: 86, textAlign: 'center' }}>{monthLabel}</span>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" style={{ all: 'unset', fontSize: 14, lineHeight: 1, color: '#94A3B8', cursor: 'pointer', padding: '0 2px' }}>›</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {([['Not Sent', stats.notSent, '#D97706'], ['Sent', stats.sent, '#2563EB'], ['Paid', stats.paid, '#16A34A']] as const).map(([label, amount, color]) => (
              <div key={label} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 8, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MO, color }}>{money0(amount)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Filter row: pill tabs + search + selection/export ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 2, background: '#fff', borderRadius: 6, padding: 2, border: '1px solid #E2E8F0' }}>
              {(['All', 'Not Sent', 'Sent', 'Paid'] as const).map(s => {
                const isActive = fStatus === s
                let bg = 'transparent'
                let color = '#94A3B8'
                let boxShadow = 'none'
                if (isActive) {
                  if (s === 'All') { bg = '#0F172A'; color = '#fff' }
                  else { color = sDot[s]; boxShadow = `inset 0 -2px 0 ${sDot[s]}` }
                }
                return (
                  <button key={s} type="button" onClick={() => setFStatus(s)} style={{ all: 'unset', padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: bg, color, boxShadow }}>
                    {s}
                  </button>
                )
              })}
            </div>
            <div style={{ position: 'relative' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}>
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients..."
                style={{ width: 170, padding: '5px 8px 5px 26px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, outline: 'none', color: '#0F172A', background: '#fff' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {sel.size > 0 && (
              <button type="button" onClick={() => setSel(new Set())} style={{ all: 'unset', fontSize: 10, color: '#94A3B8', cursor: 'pointer' }}>
                {sel.size} selected · Clear
              </button>
            )}
            <button
              type="button"
              onClick={handleBulkExport}
              disabled={isExporting}
              style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#64748B', cursor: isExporting ? 'default' : 'pointer', opacity: isExporting ? 0.5 : 1 }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10" />
              </svg>
              {isExporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* ── Three columns ── */}
        {candidatesLoading ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: i === 2 ? '0 0 auto' : 1, minWidth: i === 2 ? 200 : 0 }}>
                <div style={{ height: 33, marginBottom: 8, borderRadius: 6, background: '#fff', border: '1px solid #E2E8F0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[0, 1, 2].map(j => (
                    <div key={j} style={{ height: 52, borderRadius: 6, background: '#fff', border: '1px solid #E2E8F0', opacity: 0.7 }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {renderColumn('Flat Rate', flatList)}
            {renderColumn('Per Clean', perList)}
            {renderColumn('One-Time', otList)}
          </div>
        )}
      </div>

      {/* ── Floating action bar ── */}
      {/* Portaled to <body> so the position:fixed bar is anchored to the viewport,
          not the transformed `.animate-in` page wrapper (which previously pushed it
          to the bottom of the content, requiring a scroll to see it). */}
      {mounted && sel.size > 0 && !confirmSend && createPortal(
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, background: '#0F172A', padding: '10px 20px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 1000, animation: 'ti 0.15s ease', maxWidth: 'calc(100vw - 32px)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{sel.size} invoice{sel.size > 1 ? 's' : ''} selected</span>
          <span style={{ fontSize: 14, fontFamily: MO, fontWeight: 700, color: TEAL }}>{formatCurrency(selTotal)}</span>
          <div style={{ width: 1, height: 20, background: '#334155' }} />
          <button type="button" onClick={() => setConfirmSend('sel')} style={{ all: 'unset', padding: '6px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: TEAL, color: '#fff', cursor: 'pointer' }}>
            Send {sel.size}
          </button>
          <button type="button" title="Record as sent without emailing — for invoices you sent outside the app" onClick={markSelectedSent} disabled={markingSent || markingPaid} style={{ all: 'unset', padding: '6px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: '#2563EB', color: '#fff', cursor: markingSent ? 'default' : 'pointer', opacity: markingSent ? 0.6 : 1 }}>
            {markingSent ? 'Marking…' : 'Mark Sent'}
          </button>
          <button type="button" onClick={markSelectedPaid} disabled={markingPaid || markingSent} style={{ all: 'unset', padding: '6px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: '#16A34A', color: '#fff', cursor: markingPaid ? 'default' : 'pointer', opacity: markingPaid ? 0.6 : 1 }}>
            {markingPaid ? 'Marking…' : 'Mark Paid'}
          </button>
          <button type="button" onClick={() => setSel(new Set())} style={{ all: 'unset', fontSize: 12, color: '#94A3B8', cursor: 'pointer', padding: '4px 8px' }}>
            Clear
          </button>
        </div>,
        document.body
      )}

      {/* ── Send confirmation overlay ── */}
      {confirmSend && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={() => setConfirmSend(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 420, width: '90%', boxShadow: '0 16px 48px rgba(0,0,0,0.15)', animation: 'fadeIn 0.12s ease' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
              Send {sel.size} invoice{sel.size > 1 ? 's' : ''}?
            </div>
            <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.5, marginBottom: 6 }}>
              <span>
                You&rsquo;re about to review and send <strong>{sel.size} invoice{sel.size > 1 ? 's' : ''}</strong> totaling{' '}
                <strong style={{ fontFamily: MO }}>{formatCurrency(selTotal)}</strong> to:
              </span>
              <div style={{ marginTop: 8, maxHeight: 120, overflowY: 'auto', padding: '6px 10px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                {selectedList.map(d => (
                  <div key={d.candidate.candidateId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px solid #F1F5F9' }}>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.candidate.clientName}</span>
                    <span style={{ color: d.candidate.hasEmail ? '#94A3B8' : '#DC2626', fontSize: 11, flexShrink: 0 }}>
                      {d.email || (d.candidate.hasEmail ? '' : 'no email')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#D97706', background: '#FFFBEB', padding: '6px 10px', borderRadius: 6, marginTop: 10, marginBottom: 14 }}>
              ⚠️ This action will send real emails to real clients. Please double check before confirming.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmSend(null)} style={{ all: 'unset', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#64748B', cursor: 'pointer', border: '1px solid #E2E8F0' }}>
                Cancel
              </button>
              <button type="button" onClick={executeSend} style={{ all: 'unset', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: TEAL, color: '#fff', cursor: 'pointer' }}>
                Review &amp; Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Review / send modal (single + batch) ── */}
      {selectedClient && (
        <QuickInvoiceModal
          key={selectedClient.client.id}
          open={quickInvoiceOpen}
          onOpenChange={(open) => {
            setQuickInvoiceOpen(open)
            if (!open) {
              // Closing after a batch run (or cancelling one) clears the selection.
              if (batchMode) setSel(new Set())
              setBatchMode(false)
              setActiveCandidateId(null)
            }
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
          onSuccess={onDataChange}
          onNext={
            batchMode
              ? (batchPos < batchQueue.length - 1 ? handleNextClient : undefined)
              : (selectedClientIndex < navClients.length - 1 ? handleNextClient : undefined)
          }
          onPrevious={
            batchMode
              ? (batchPos > 0 ? handlePreviousClient : undefined)
              : (selectedClientIndex > 0 ? handlePreviousClient : undefined)
          }
          currentIndex={batchMode ? batchPos : selectedClientIndex}
          totalCount={batchMode ? batchQueue.length : navClients.length}
          batchMode={batchMode}
        />
      )}
    </div>
  )
}
