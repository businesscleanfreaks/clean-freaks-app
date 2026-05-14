"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { mutate as globalMutate } from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/utils"
import { Plus, Search, DollarSign, CheckCircle2, Users, ChevronLeft, ChevronRight, CalendarDays, ArrowRight, Archive, RotateCcw, Trash2, Edit2 } from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { PaymentBreakdownModal } from "@/components/subcontractors/payment-breakdown-modal"
import { CleanerListRow, getCorrectOwedAmount } from "@/components/subcontractors/cleaner-list-row"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { format } from "date-fns"
import { logger } from "@/lib/logger"
import { showError, showSuccess } from "@/lib/toast"
import { EmptyState } from "@/components/ui/empty-state"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import type { CleanerData } from "@/types"

interface SubcontractorsPageWrapperProps {
  subcontractors: CleanerData[]
  onDataChange: () => void
}

function getSummaryText(sub: CleanerData): string {
  const groups = getPaymentGroups(sub)
  const flatRateCount = groups.filter(g => g.type === 'FLAT_RATE').length
  const totalJobs = groups.filter(g => g.type === 'PER_CLEAN').reduce((sum, g) => sum + (g.jobCount || 0), 0)
  const parts: string[] = []
  if (flatRateCount > 0) parts.push(`${flatRateCount} month${flatRateCount !== 1 ? 's' : ''}`)
  if (totalJobs > 0) parts.push(`${totalJobs} clean${totalJobs !== 1 ? 's' : ''}`)
  return parts.join(' · ') || 'No jobs'
}

interface PaymentGroup {
  id: string
  type: 'FLAT_RATE' | 'PER_CLEAN'
  clientName: string
  amount: number
  jobIds: string[]
  jobCount?: number
}

function getPaymentGroups(sub: CleanerData): PaymentGroup[] {
  const groups: PaymentGroup[] = []
  const jobsByClient = new Map<string, CleanerData['jobs']>()

  ;(sub.jobs || []).forEach(job => {
    if (!job.location?.client) return
    const clientId = job.location.client.id
    if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, [])
    jobsByClient.get(clientId)!.push(job)
  })

  const allPerCleanJobs: CleanerData['jobs'] = []
  const perCleanClientNames: string[] = []

  jobsByClient.forEach((jobs) => {
    const client = jobs[0].location.client
    const payType = (client.cleanerPayType || 'PER_CLEAN') as 'FLAT_RATE' | 'PER_CLEAN'

    if (payType === 'FLAT_RATE') {
      const jobsByMonth = new Map<string, CleanerData['jobs']>()
      jobs.forEach(job => {
        const monthKey = format(new Date(job.date), 'yyyy-MM')
        if (!jobsByMonth.has(monthKey)) jobsByMonth.set(monthKey, [])
        jobsByMonth.get(monthKey)!.push(job)
      })
      jobsByMonth.forEach((monthJobs, monthKey) => {
        groups.push({
          id: `${client.id}-${monthKey}`,
          type: 'FLAT_RATE',
          clientName: client.name,
          amount: monthJobs[0].subcontractorRate,
          jobIds: monthJobs.map(j => j.id),
        })
      })
    } else {
      allPerCleanJobs.push(...jobs)
      if (!perCleanClientNames.includes(client.name)) perCleanClientNames.push(client.name)
    }
  })

  if (allPerCleanJobs.length > 0) {
    const perCleanByMonth = new Map<string, CleanerData['jobs']>()
    allPerCleanJobs.forEach(job => {
      const monthKey = format(new Date(job.date), 'yyyy-MM')
      if (!perCleanByMonth.has(monthKey)) perCleanByMonth.set(monthKey, [])
      perCleanByMonth.get(monthKey)!.push(job)
    })
    perCleanByMonth.forEach((monthJobs, monthKey) => {
      groups.push({
        id: `perclean-${monthKey}`,
        type: 'PER_CLEAN',
        clientName: perCleanClientNames.join(', '),
        amount: monthJobs.reduce((sum, j) => sum + j.subcontractorRate, 0),
        jobIds: monthJobs.map(j => j.id),
        jobCount: monthJobs.length,
      })
    })
  }

  return groups
}

export function WorkersPageWrapper({ subcontractors, onDataChange }: SubcontractorsPageWrapperProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [payingSubcontractor, setPayingSubcontractor] = useState<CleanerData | null>(null)
  const [datePaid, setDatePaid] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Period selector state — controls which month's jobs are visible in stats
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const periodLabel = useMemo(() => {
    const [y, m] = period.split('-')
    const date = new Date(parseInt(y), parseInt(m) - 1, 1)
    return format(date, 'MMMM yyyy')
  }, [period])

  const shiftPeriod = (delta: number) => {
    setPeriod(prev => {
      const [y, m] = prev.split('-').map(Number)
      const d = new Date(y, m - 1 + delta, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
  }


  // Batch Pay state
  const [batchPayMode, setBatchPayMode] = useState(false)
  const [batchSelectedSubs, setBatchSelectedSubs] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Edit Cleaner state
  const [editingCleaner, setEditingCleaner] = useState<CleanerData | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const openEditCleaner = (sub: CleanerData) => {
    setEditForm({
      name: sub.name || '',
      phone: sub.phone || '',
      email: sub.email || '',
      notes: sub.notes || '',
    })
    setEditingCleaner(sub)
  }

  const handleSaveEdit = async () => {
    if (!editingCleaner || !editForm.name.trim()) return
    setIsSavingEdit(true)
    try {
      const res = await fetch(`/api/subcontractors/${editingCleaner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error('Failed to update')
      showSuccess(`${editForm.name} updated`)
      setEditingCleaner(null)
      onDataChange()
    } catch {
      showError('Failed to update cleaner')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleArchiveCleaner = async (sub: CleanerData) => {
    if (!confirm(`Archive ${sub.name}? They will be hidden from the active list but all history will be preserved.`)) return
    try {
      const res = await fetch(`/api/subcontractors/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      if (!res.ok) throw new Error('Failed to archive')
      showSuccess(`${sub.name} archived`)
      onDataChange()
    } catch {
      showError('Failed to archive cleaner')
    }
  }

  const { totalOwed, subcontractorsWithBalance, paidUpSubcontractors, archivedSubcontractors } = useMemo(() => {
    let total = 0
    const withBalance: CleanerData[] = []
    const paidUp: CleanerData[] = []
    const archived: CleanerData[] = []

    subcontractors.forEach(sub => {
      if (sub.isActive === false) {
        archived.push(sub)
        return
      }
      const owed = getCorrectOwedAmount(sub)
      if (owed > 0) {
        withBalance.push(sub)
        total += owed
      } else {
        paidUp.push(sub)
      }
    })

    withBalance.sort((a, b) => getCorrectOwedAmount(b) - getCorrectOwedAmount(a))
    return { totalOwed: total, subcontractorsWithBalance: withBalance, paidUpSubcontractors: paidUp, archivedSubcontractors: archived }
  }, [subcontractors])

  const filteredSubcontractors = useMemo(() => {
    const allSubs = [...subcontractorsWithBalance, ...paidUpSubcontractors]
    if (!searchQuery) return allSubs
    const query = searchQuery.toLowerCase()
    return allSubs.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.email?.toLowerCase().includes(query) ||
      s.phone?.includes(query)
    )
  }, [subcontractorsWithBalance, paidUpSubcontractors, searchQuery])

  const owedFiltered = filteredSubcontractors.filter(s => getCorrectOwedAmount(s) > 0)
  const paidFiltered = filteredSubcontractors.filter(s => getCorrectOwedAmount(s) === 0)

  // Batch Pay
  const startBatchPay = () => {
    setBatchPayMode(true)
    setBatchSelectedSubs(new Set(subcontractorsWithBalance.map(s => s.id)))
    setDatePaid(format(new Date(), 'yyyy-MM-dd'))
    setPaymentNotes('')
  }

  const closeBatchPay = () => {
    setBatchPayMode(false)
    setBatchSelectedSubs(new Set())
  }

  const toggleBatchSub = (subId: string) => {
    setBatchSelectedSubs(prev => {
      const next = new Set(prev)
      if (next.has(subId)) next.delete(subId)
      else next.add(subId)
      return next
    })
  }

  const batchTotal = useMemo(() => {
    return subcontractorsWithBalance
      .filter(s => batchSelectedSubs.has(s.id))
      .reduce((sum, s) => sum + getCorrectOwedAmount(s), 0)
  }, [batchSelectedSubs, subcontractorsWithBalance])

  const handleBatchPayment = async () => {
    if (batchSelectedSubs.size === 0) {
      showError('Please select at least one cleaner')
      return
    }

    setIsSubmitting(true)
    try {
      for (const subId of batchSelectedSubs) {
        const sub = subcontractorsWithBalance.find(s => s.id === subId)
        if (!sub) continue

        const groups = getPaymentGroups(sub)
        const allJobIds = groups.flatMap(g => g.jobIds)
        if (allJobIds.length === 0) continue

        const response = await fetch(`/api/subcontractors/${subId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobIds: allJobIds,
            datePaid,
            notes: paymentNotes || null,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(`Failed for ${sub.name}: ${errorData.error}`)
        }
      }

      showSuccess(`Recorded ${batchSelectedSubs.size} payment${batchSelectedSubs.size !== 1 ? 's' : ''} totaling ${formatCurrency(batchTotal)}!`)
      closeBatchPay()
      onDataChange()
      // Invalidate dashboard stats so payout totals update
      globalMutate('/api/dashboard-stats')
    } catch (error) {
      logger.error('Error recording batch payments:', error)
      showError(error instanceof Error ? error.message : 'Failed to record payments')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Cleaners</h1>
          <div className="flex items-center gap-2">
            {subcontractorsWithBalance.length > 1 && (
              <Button
                onClick={startBatchPay}
                className="bg-teal-600 hover:bg-teal-700 text-white h-9 px-3 sm:px-4 text-sm rounded-lg"
              >
                <DollarSign className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Pay All</span>
              </Button>
            )}
            <Link href="/subcontractors/new">
              <Button variant="outline" className="h-9 px-3 sm:px-4 text-sm rounded-lg">
                <Plus className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Add Cleaner</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* Cleaner cards — quick view of contact + assigned clients */}
        {filteredSubcontractors.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Directory</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredSubcontractors.map((sub) => {
                const { hex } = getCleanerColorInfo(sub.name)
                const initials = sub.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
                const clientNames = new Map<string, string>()
                ;(sub.jobs || []).forEach((job) => {
                  const c = job.location?.client
                  if (c?.id && c.name) clientNames.set(c.id, c.name)
                })
                const clients = Array.from(clientNames.values()).slice(0, 8)
                return (
                  <Link
                    key={sub.id}
                    href={`/subcontractors/${sub.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:border-teal-300 hover:shadow-md transition-all no-underline text-inherit"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                        style={{ backgroundColor: hex }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">{sub.name}</p>
                        {sub.phone && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{sub.phone}</p>
                        )}
                        {sub.email && (
                          <p className="text-xs text-gray-500 truncate">{sub.email}</p>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Clients</p>
                    {clients.length === 0 ? (
                      <p className="text-xs text-gray-400">No client-linked jobs in current data</p>
                    ) : (
                      <ul className="text-xs text-gray-700 space-y-0.5">
                        {clients.map((name) => (
                          <li key={name} className="truncate border-l-2 border-teal-200 pl-2">{name}</li>
                        ))}
                      </ul>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Period Selector */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            onClick={() => shiftPeriod(-1)}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 min-w-[160px] justify-center">
            <CalendarDays className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-semibold text-gray-700">{periodLabel}</span>
          </div>
          <button
            onClick={() => shiftPeriod(1)}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Summary Strip */}
        {subcontractors.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-5">
            <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 flex flex-col justify-center">
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Outstanding</span>
              <span className="text-xl sm:text-2xl font-bold text-gray-900 leading-none truncate">{formatCurrency(totalOwed)}</span>
            </div>
            <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 flex flex-col justify-center">
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Unpaid</span>
              <span className="text-xl sm:text-2xl font-bold text-gray-900 leading-none">{subcontractorsWithBalance.length}</span>
            </div>
            <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 flex flex-col justify-center">
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Paid Up</span>
              <span className="text-xl sm:text-2xl font-bold text-gray-900 leading-none">{paidUpSubcontractors.length}</span>
            </div>
          </div>
        )}

        {/* Search */}
        {subcontractors.length > 0 && (
          <div className="mb-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cleaners..."
                className="pl-10 h-10 bg-white text-sm rounded-lg"
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {subcontractors.length === 0 && (
          <EmptyState
            icon={Users}
            title="No cleaners yet"
            description="Add your first cleaner to start tracking payments and assignments."
            actionLabel="Add Cleaner"
            actionHref="/subcontractors/new"
            helpTooltip="empty-subcontractors"
          />
        )}

        {/* Owed Money Section */}
        {owedFiltered.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2 px-1">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Unpaid</h2>
              <span className="text-xs font-medium text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">
                {owedFiltered.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {owedFiltered.map(sub => (
                <CleanerListRow
                  key={sub.id}
                  sub={sub}
                  owed={getCorrectOwedAmount(sub)}
                  onPay={setPayingSubcontractor}
                  onEdit={openEditCleaner}
                  onArchive={handleArchiveCleaner}
                />
              ))}
            </div>
          </div>
        )}

        {/* All Paid Up Section */}
        {paidFiltered.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">All Paid Up</h2>
              <span className="text-xs font-medium text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">
                {paidFiltered.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {paidFiltered.map(sub => (
                <CleanerListRow
                  key={sub.id}
                  sub={sub}
                  owed={0}
                  onPay={setPayingSubcontractor}
                  onEdit={openEditCleaner}
                  onArchive={handleArchiveCleaner}
                />
              ))}
            </div>
          </div>
        )}

        {/* Archived Section */}
        {archivedSubcontractors.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Archive className="w-3.5 h-3.5 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Archived</h2>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                {archivedSubcontractors.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden opacity-60">
              {archivedSubcontractors.map(sub => {
                const hasHistory = (sub.jobs?.length || 0) > 0 || (sub.payments?.length || 0) > 0
                return (
                <div key={sub.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                    style={{ backgroundColor: getCleanerColorInfo(sub.name).hex, filter: 'grayscale(50%)' }}
                  >
                    {sub.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-500 truncate text-[15px]">{sub.name}</span>
                    <p className="text-sm text-gray-400">
                      {hasHistory ? 'Archived · Has job/payment history' : 'Archived · No history'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-sm gap-1.5"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/subcontractors/${sub.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: true }),
                          })
                          if (!res.ok) throw new Error('Failed to restore')
                          showSuccess(`${sub.name} restored`)
                          onDataChange()
                        } catch {
                          showError('Failed to restore cleaner')
                        }
                      }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </Button>
                    {!hasHistory && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-sm gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setConfirmDeleteId(sub.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}

        {/* Confirm Delete Dialog */}
        <Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-500" />
                Delete permanently?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600">
              This will permanently remove <strong>{archivedSubcontractors.find(s => s.id === confirmDeleteId)?.name}</strong>. This cannot be undone.
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={isDeleting}
                onClick={async () => {
                  if (!confirmDeleteId) return
                  setIsDeleting(true)
                  try {
                    const res = await fetch(`/api/subcontractors/${confirmDeleteId}`, { method: 'DELETE' })
                    if (res.status === 409) {
                      showError('Cannot delete: this cleaner has job/payment history. Use Archive instead.')
                      setConfirmDeleteId(null)
                      return
                    }
                    if (!res.ok) throw new Error('Failed to delete')
                    showSuccess('Cleaner permanently deleted')
                    setConfirmDeleteId(null)
                    onDataChange()
                  } catch {
                    showError('Failed to delete cleaner')
                  } finally {
                    setIsDeleting(false)
                  }
                }}
              >
                {isDeleting ? 'Deleting…' : 'Delete Permanently'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* BATCH PAY MODAL */}
      <Dialog open={batchPayMode} onOpenChange={(open) => !open && closeBatchPay()}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              Pay All Cleaners
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable cleaner list */}
          <div className="flex-1 min-h-0 overflow-y-auto py-2">
            <p className="text-gray-500 text-sm mb-3">
              Select which cleaners you&apos;re paying today.
            </p>

            <div className="space-y-1.5">
              {subcontractorsWithBalance.map(sub => {
                const isSelected = batchSelectedSubs.has(sub.id)
                const owed = getCorrectOwedAmount(sub)
                const { hex } = getCleanerColorInfo(sub.name)
                const initials = sub.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

                return (
                  <label
                    key={sub.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      isSelected ? 'border-teal-400 bg-teal-50/50' : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleBatchSub(sub.id)}
                      className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                    />
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
                      style={{ backgroundColor: hex }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{sub.name}</p>
                      <p className="text-xs text-gray-400">{getSummaryText(sub)}</p>
                    </div>
                    <p className={`font-bold text-sm ${isSelected ? 'text-teal-700' : 'text-gray-900'}`}>
                      {formatCurrency(owed)}
                    </p>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Fixed footer — always visible */}
          <div className="flex-shrink-0 space-y-3 pt-3 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="batchDatePaid" className="text-xs text-gray-500 font-medium">
                  Payment Date
                </Label>
                <Input
                  id="batchDatePaid"
                  type="date"
                  value={datePaid}
                  onChange={(e) => setDatePaid(e.target.value)}
                  className="mt-1 h-9 text-sm rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="batchNotes" className="text-xs text-gray-500 font-medium">
                  Notes <span className="text-gray-300">(optional)</span>
                </Label>
                <Input
                  id="batchNotes"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Venmo, Zelle..."
                  className="mt-1 h-9 text-sm rounded-lg"
                />
              </div>
            </div>

            <div className="rounded-xl p-3 bg-teal-50 border-l-[3px] border-l-teal-600">
              <div className="flex items-center justify-between">
                <span className="font-medium text-teal-700 text-sm">Total</span>
                <span className="text-xl font-bold text-gray-900">{formatCurrency(batchTotal)}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {batchSelectedSubs.size} cleaner{batchSelectedSubs.size !== 1 ? 's' : ''} selected
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-shrink-0">
            <Button
              variant="outline"
              onClick={closeBatchPay}
              disabled={isSubmitting}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBatchPayment}
              disabled={isSubmitting || batchSelectedSubs.size === 0}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {isSubmitting ? (
                <>Recording... <ActionSpinner size={16} color="white" className="ml-1.5" /></>
              ) : `Pay ${formatCurrency(batchTotal)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QUICK PAY MODAL */}
      <PaymentBreakdownModal
        subcontractor={payingSubcontractor}
        jobs={payingSubcontractor?.jobs || []}
        open={!!payingSubcontractor}
        onOpenChange={(open) => !open && setPayingSubcontractor(null)}
        onPaymentComplete={() => { setPayingSubcontractor(null); onDataChange(); globalMutate('/api/dashboard-stats') }}
      />

      {/* EDIT CLEANER DIALOG */}
      <Dialog open={!!editingCleaner} onOpenChange={(open) => !open && setEditingCleaner(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
                <Edit2 className="w-4 h-4 text-teal-700" />
              </div>
              Edit Cleaner
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-gray-500 font-medium">Name *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Cleaner name"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500 font-medium">Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500 font-medium">Email</Label>
                <Input
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="cleaner@email.com"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500 font-medium">Notes</Label>
              <Input
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Optional notes"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingCleaner(null)} disabled={isSavingEdit} className="flex-1 rounded-lg">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isSavingEdit || !editForm.name.trim()}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {isSavingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
