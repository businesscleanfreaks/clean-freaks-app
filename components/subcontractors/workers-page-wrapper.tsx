"use client"

import { useState, useMemo, useCallback, useRef } from "react"
import Link from "next/link"
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
import { Plus, Search, DollarSign, CheckCircle2, Users } from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { PaymentBreakdownModal } from "@/components/subcontractors/payment-breakdown-modal"
import { CleanerListRow, getCorrectOwedAmount } from "@/components/subcontractors/cleaner-list-row"
import { SubcontractorDetail } from "@/components/subcontractors/subcontractor-detail"
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
          amount: monthJobs[0].subcontractorRate,
          jobIds: monthJobs.map(j => j.id),
        })
      })
    } else {
      allPerCleanJobs.push(...jobs)
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

  // Inline expansion state
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null)
  const [expandedSubData, setExpandedSubData] = useState<CleanerData | null>(null)
  const [expandedSubLoading, setExpandedSubLoading] = useState(false)

  // Cache previously loaded subcontractor data for instant re-expansion
  const subDetailCache = useRef<Map<string, CleanerData>>(new Map())

  const handleToggleExpand = useCallback(async (subId: string) => {
    if (expandedSubId === subId) {
      // Collapse
      setExpandedSubId(null)
      setExpandedSubData(null)
      return
    }

    // Expand: use cache for instant display, then refresh in background
    setExpandedSubId(subId)
    const cached = subDetailCache.current.get(subId)
    if (cached) {
      setExpandedSubData(cached)
      setExpandedSubLoading(false)
      // Background refresh
      fetch(`/api/subcontractors/${subId}`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          subDetailCache.current.set(subId, data)
          setExpandedSubData(data)
        })
        .catch(() => {})
      return
    }

    // First load: show spinner
    setExpandedSubData(null)
    setExpandedSubLoading(true)
    try {
      const res = await fetch(`/api/subcontractors/${subId}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      subDetailCache.current.set(subId, data)
      setExpandedSubData(data)
    } catch {
      showError('Failed to load cleaner details')
      setExpandedSubId(null)
    } finally {
      setExpandedSubLoading(false)
    }
  }, [expandedSubId])

  const handleExpandedDataChange = useCallback(() => {
    // Refresh both the list and the expanded detail
    onDataChange()
    if (expandedSubId) {
      fetch(`/api/subcontractors/${expandedSubId}`)
        .then(res => res.json())
        .then(data => {
          subDetailCache.current.set(expandedSubId, data)
          setExpandedSubData(data)
        })
        .catch(() => {})
    }
  }, [expandedSubId, onDataChange])

  // Batch Pay state
  const [batchPayMode, setBatchPayMode] = useState(false)
  const [batchSelectedSubs, setBatchSelectedSubs] = useState<Set<string>>(new Set())

  const { totalOwed, subcontractorsWithBalance, paidUpSubcontractors } = useMemo(() => {
    let total = 0
    const withBalance: CleanerData[] = []
    const paidUp: CleanerData[] = []

    subcontractors.forEach(sub => {
      const owed = getCorrectOwedAmount(sub)
      if (owed > 0) {
        withBalance.push(sub)
        total += owed
      } else {
        paidUp.push(sub)
      }
    })

    withBalance.sort((a, b) => getCorrectOwedAmount(b) - getCorrectOwedAmount(a))
    return { totalOwed: total, subcontractorsWithBalance: withBalance, paidUpSubcontractors: paidUp }
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-2">
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

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        {/* Stat banner */}
        {totalOwed > 0 && (
          <div className="bg-white rounded-xl px-4 py-3 flex items-center justify-between mb-4 border border-gray-200 border-l-4 border-l-teal-600">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-teal-600 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Owed</p>
                <p className="text-2xl font-bold text-gray-900" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCurrency(totalOwed)}</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">{subcontractorsWithBalance.length} waiting</p>
          </div>
        )}

        {totalOwed === 0 && subcontractors.length > 0 && (
          <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-3 mb-4 border border-gray-200 border-l-4 border-l-teal-600">
            <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
            <div>
              <p className="font-semibold text-gray-900">All caught up!</p>
              <p className="text-sm text-gray-400">Everyone has been paid</p>
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
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Owed Money</h2>
              <span className="text-xs font-medium text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">
                {owedFiltered.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {owedFiltered.map(sub => (
                <div key={sub.id}>
                  <CleanerListRow
                    sub={sub}
                    owed={getCorrectOwedAmount(sub)}
                    onPay={setPayingSubcontractor}
                    onToggleExpand={handleToggleExpand}
                    isExpanded={expandedSubId === sub.id}
                  />
                  {expandedSubId === sub.id && (
                    <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                      {expandedSubLoading ? (
                        <div className="space-y-3">
                          <SkeletonPulse className="h-10 w-full" rounded="lg" />
                          <SkeletonPulse className="h-32 w-full" rounded="xl" />
                        </div>
                      ) : expandedSubData ? (
                        <>
                          <Link
                            href={`/subcontractors/${sub.id}`}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 mb-3 transition-colors"
                          >
                            View Full Profile →
                          </Link>
                          <SubcontractorDetail subcontractor={expandedSubData} onDataChange={handleExpandedDataChange} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
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
                <div key={sub.id}>
                  <CleanerListRow
                    sub={sub}
                    owed={0}
                    onPay={setPayingSubcontractor}
                    onToggleExpand={handleToggleExpand}
                    isExpanded={expandedSubId === sub.id}
                  />
                  {expandedSubId === sub.id && (
                    <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                      {expandedSubLoading ? (
                        <div className="space-y-3">
                          <SkeletonPulse className="h-10 w-full" rounded="lg" />
                          <SkeletonPulse className="h-32 w-full" rounded="xl" />
                        </div>
                      ) : expandedSubData ? (
                        <>
                          <Link
                            href={`/subcontractors/${sub.id}`}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 mb-3 transition-colors"
                          >
                            View Full Profile →
                          </Link>
                          <SubcontractorDetail subcontractor={expandedSubData} onDataChange={handleExpandedDataChange} />
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BATCH PAY MODAL */}
      <Dialog open={batchPayMode} onOpenChange={(open) => !open && closeBatchPay()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              Pay All Cleaners
            </DialogTitle>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <p className="text-gray-500 text-sm">
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

            <div className="border-t border-gray-200" />

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

          <DialogFooter className="gap-2">
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
        onPaymentComplete={() => { setPayingSubcontractor(null); onDataChange() }}
      />
    </div>
  )
}
