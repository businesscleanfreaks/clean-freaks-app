"use client"

import useSWR, { mutate as globalMutate } from "swr"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { formatCurrency } from "@/lib/utils"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { ArrowLeft, Phone, Mail, CreditCard, Users, Settings, Clock, Building2, MapPin, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CheckCircle2, DollarSign, History, RotateCcw, Search } from "lucide-react"
import { PaymentBreakdownModal } from "@/components/subcontractors/payment-breakdown-modal"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { differenceInDays, format } from "date-fns"
import { showError, showSuccess, showApiError } from "@/lib/toast"
import { CADENCE_LABELS, CADENCE_DESCRIPTIONS } from "@/lib/payment-cadence"
import type { CleanerData, CleanerJob } from "@/types"
import { formatFrequency } from "@/lib/frequency-utils"
import { useConfirm } from "@/hooks/use-confirm"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error("Failed to fetch")
  return res.json()
})

function getStatusInfo(sub: CleanerData, owed: number) {
  if (owed === 0) return { label: "Paid Up", dotColor: "#0d9488" }
  const lastPayment = sub.payments?.[0]
  if (!lastPayment) return { label: "Never Paid", dotColor: "#9ca3af" }
  const daysSince = differenceInDays(new Date(), new Date(lastPayment.datePaid))
  if (daysSince > 30) return { label: "Overdue", dotColor: "#E53935" }
  if (daysSince > 14) return { label: "Due Soon", dotColor: "#f59e0b" }
  return { label: "Recent", dotColor: "#0d9488" }
}

function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <SkeletonPulse className="h-5 w-24 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center gap-4 mb-6">
              <SkeletonPulse className="w-14 h-14" rounded="full" />
              <div>
                <SkeletonPulse className="h-6 w-40 mb-1" />
                <SkeletonPulse className="h-4 w-28" />
              </div>
            </div>
            <SkeletonPulse className="h-32 w-full" rounded="xl" />
            <SkeletonPulse className="h-40 w-full" rounded="xl" />
          </div>
          <div className="lg:col-span-9 space-y-4">
            <SkeletonPulse className="h-10 w-48 mx-auto mb-4" rounded="lg" />
            <SkeletonPulse className="h-64 w-full" rounded="xl" />
          </div>
        </div>
      </div>
    </div>
  )
}

interface ClientGroup {
  clientId: string
  clientName: string
  payType: 'FLAT_RATE' | 'PER_CLEAN'
  jobs: CleanerJob[]
  monthlyAmount?: number
  totalAmount: number
  month?: string
}

interface CleanerDetailClientProps {
  id: string
}

export function CleanerDetailClient({ id }: CleanerDetailClientProps) {
  const router = useRouter()
  const { confirm, ConfirmDialog } = useConfirm()
  
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const { data: sub, error, isLoading, mutate } = useSWR<CleanerData>(
    `/api/subcontractors/${id}?period=${period}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  )

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [cadenceDialogOpen, setCadenceDialogOpen] = useState(false)
  const [cadenceForm, setCadenceForm] = useState({
    paymentCadence: 'IMMEDIATE',
    paymentCadenceNotes: '',
    excludeClientIds: '',
  })
  const [savingCadence, setSavingCadence] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({})
  const [markingPaidJobId, setMarkingPaidJobId] = useState<string | null>(null)
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null)

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

  const clientGroups = useMemo(() => {
    if (!sub?.periodJobs) return []
    
    const groups: ClientGroup[] = []
    const jobsByClient = new Map<string, CleanerJob[]>()

    sub.periodJobs.forEach(job => {
      if (!job.location?.client) return
      const clientId = job.location.client.id
      if (!jobsByClient.has(clientId)) jobsByClient.set(clientId, [])
      jobsByClient.get(clientId)!.push(job)
    })

    jobsByClient.forEach((jobs, clientId) => {
      const firstJob = jobs[0]
      const client = firstJob.location.client
      const payType = (client.cleanerPayType || 'PER_CLEAN') as 'FLAT_RATE' | 'PER_CLEAN'

      if (payType === 'FLAT_RATE') {
        const monthlyRate = firstJob.subcontractorRate
        const jobsByMonth = new Map<string, CleanerJob[]>()
        jobs.forEach(job => {
          const monthKey = format(new Date(job.date), 'yyyy-MM')
          if (!jobsByMonth.has(monthKey)) jobsByMonth.set(monthKey, [])
          jobsByMonth.get(monthKey)!.push(job)
        })
        jobsByMonth.forEach((monthJobs, monthKey) => {
          const monthDisplay = format(new Date(monthJobs[0].date), 'MMMM yyyy')
          groups.push({
            clientId: `${clientId}-${monthKey}`,
            clientName: client.name,
            payType: 'FLAT_RATE',
            jobs: monthJobs,
            monthlyAmount: monthlyRate,
            totalAmount: monthlyRate,
            month: monthDisplay,
          })
        })
      } else {
        const totalAmount = jobs.reduce((sum, job) => sum + job.subcontractorRate, 0)
        groups.push({
          clientId,
          clientName: client.name,
          payType: 'PER_CLEAN',
          jobs: jobs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
          totalAmount,
        })
      }
    })

    // Sort unpaid/partially unpaid groups first, then fully paid
    return groups.sort((a, b) => {
      const aUnpaid = a.jobs.some(j => !j.subcontractorPaid)
      const bUnpaid = b.jobs.some(j => !j.subcontractorPaid)
      if (aUnpaid && !bUnpaid) return -1
      if (!aUnpaid && bUnpaid) return 1
      return b.totalAmount - a.totalAmount
    })
  }, [sub?.periodJobs])

  const filteredClientGroups = useMemo(() => {
    if (!searchQuery.trim()) return clientGroups;
    const q = searchQuery.toLowerCase().trim();
    return clientGroups.filter(g => g.clientName.toLowerCase().includes(q));
  }, [clientGroups, searchQuery]);



  const handleMarkPaid = async (jobIds: string[], loadingId: string) => {
    if (!sub) return
    
    setMarkingPaidJobId(loadingId)
    try {
      const response = await fetch(`/api/subcontractors/${sub.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobIds,
          datePaid: format(new Date(), 'yyyy-MM-dd'),
          notes: null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to mark paid')
      }

      showSuccess('Job marked as paid')
      mutate()
      globalMutate('/api/subcontractors/data')
      globalMutate('/api/dashboard-stats')
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to record payment')
    } finally {
      setMarkingPaidJobId(null)
    }
  }

  const handleVoidPayment = async (paymentId: string) => {
    if (!sub) return
    const confirmed = await confirm({
      title: "Void Payment?",
      description: "Are you sure you want to undo this payment? The jobs will be marked as unpaid again.",
      confirmText: "Void Payment",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return

    setVoidingPaymentId(paymentId)
    try {
      const response = await fetch(`/api/subcontractors/${sub.id}/payments/${paymentId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to undo payment')
        return
      }
      showSuccess('Payment undone - jobs marked as unpaid')
      mutate()
      globalMutate('/api/subcontractors/data')
      globalMutate('/api/dashboard-stats')
    } catch {
      showError('Failed to undo payment. Please try again.')
    } finally {
      setVoidingPaymentId(null)
    }
  }

  if (isLoading) return <DetailSkeleton />

  if (error || !sub) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load cleaner</p>
          <button onClick={() => router.back()} className="text-teal-600 hover:underline">
            Go back
          </button>
        </div>
      </div>
    )
  }

  const { hex } = getCleanerColorInfo(sub.name)
  const initials = sub.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
  const status = getStatusInfo(sub, sub.owedAmount)
  const lastPayment = sub.payments?.[0]
  
  const periodTotalOwed = clientGroups.reduce((sum, group) => {
    if (group.payType === 'FLAT_RATE') {
      const hasUnpaid = group.jobs.some(j => !j.subcontractorPaid)
      return sum + (hasUnpaid ? (group.monthlyAmount || 0) : 0)
    } else {
      return sum + group.jobs.filter(j => !j.subcontractorPaid).reduce((s, j) => s + j.subcontractorRate, 0)
    }
  }, 0)

  return (
    <div className="min-h-screen bg-gray-50 [overflow-anchor:none]">
      {/* 
        Single-column layout, max-w-[1400px], wide but readable
      */}
      <div className="w-full max-w-[1280px] xl:max-w-[1400px] mx-auto px-5 py-6">
        
        {/* Back nav */}
        <button
          onClick={() => router.push("/subcontractors")}
          className="flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 mb-6 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          Cleaners Queue
        </button>

        {/* 1. Pay Strip */}
        <div className="bg-white rounded-t-xl border border-gray-200 border-b-0 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
          <div className="flex items-start md:items-center gap-5">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-sm"
              style={{ backgroundColor: hex }}
            >
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{sub.name}</h1>
                <span className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.dotColor }} />
                  <span className="text-xs font-semibold text-gray-700">{status.label}</span>
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                {sub.phone && (
                  <a href={`tel:${sub.phone}`} className="flex items-center gap-1.5 hover:text-teal-600 transition-colors">
                    <Phone className="w-4 h-4" /> {sub.phone}
                  </a>
                )}
                {sub.email && (
                  <a href={`mailto:${sub.email}`} className="flex items-center gap-1.5 hover:text-teal-600 transition-colors">
                    <Mail className="w-4 h-4" /> {sub.email}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Owed Balance</p>
              <p className="text-3xl font-bold text-gray-900 leading-none">{formatCurrency(sub.owedAmount)}</p>
            </div>
            {sub.owedAmount > 0 && (
              <Button
                onClick={() => setPayModalOpen(true)}
                className="bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl h-12 px-6 shadow-sm"
              >
                <DollarSign className="w-5 h-5 mr-2" /> Pay Balance
              </Button>
            )}
          </div>
        </div>

        {/* 2. Meta Bar */}
        <div className="bg-gray-50 border border-gray-200 rounded-b-xl flex flex-wrap items-center gap-px overflow-hidden shadow-sm mb-8">
          <div className="flex-1 bg-white px-6 py-4 min-w-[200px]">
            <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Accounts
            </p>
            <p className="text-sm font-semibold text-gray-900">{sub.accounts?.length || 0} active</p>
          </div>
          
          <div className="flex-1 bg-white px-6 py-4 min-w-[200px]">
            <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Period
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{periodLabel}</p>
              <div className="flex items-center gap-1 border border-gray-200 rounded bg-gray-50">
                <button onClick={() => shiftPeriod(-1)} className="p-1 hover:bg-gray-100 rounded-l">
                  <ChevronLeft className="w-3.5 h-3.5 text-gray-600" />
                </button>
                <button onClick={() => shiftPeriod(1)} className="p-1 hover:bg-gray-100 rounded-r border-l border-gray-200">
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex-1 bg-white px-6 py-4 min-w-[200px]">
            <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Last Paid
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {lastPayment ? format(new Date(lastPayment.datePaid), 'MMM d, yyyy') : 'None'}
            </p>
          </div>

          <button
            onClick={() => {
              setCadenceForm({
                paymentCadence: sub.paymentCadence || 'IMMEDIATE',
                paymentCadenceNotes: sub.paymentCadenceNotes || '',
                excludeClientIds: sub.excludeClientIds || '[]',
              })
              setCadenceDialogOpen(true)
            }}
            className="flex-1 bg-white px-6 py-4 min-w-[200px] text-left hover:bg-teal-50/30 transition-colors group"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Timing
                </p>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-teal-700 transition-colors">
                  {CADENCE_LABELS[sub.paymentCadence || 'IMMEDIATE'] || 'Immediate'}
                </p>
              </div>
              <Settings className="w-4 h-4 text-gray-400 group-hover:text-teal-600 transition-colors mt-0.5" />
            </div>
          </button>
        </div>

        {/* 3. Ledger & Search */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col [overflow-anchor:none]">
          <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                Pay Ledger
                <span className="text-sm font-medium text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-md">
                  {sub.periodJobs?.length || 0} jobs
                </span>
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">Manage jobs and record payments for {periodLabel}</p>
            </div>
            
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white"
              />
            </div>
          </div>
          
          <div className="p-5">
            {!sub.periodJobs || sub.periodJobs.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                  <CalendarDays className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">No jobs this period</h3>
                <p className="text-gray-500 text-sm">Use the arrows above to view a different month.</p>
              </div>
            ) : filteredClientGroups.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">No accounts match your search</h3>
                <p className="text-gray-500 text-sm">Try a different name.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredClientGroups.map(group => {
                  const hasUnpaid = group.jobs.some(j => !j.subcontractorPaid)
                  const isExpanded = manuallyToggled[group.clientId] !== undefined 
                    ? manuallyToggled[group.clientId] 
                    : hasUnpaid;

                  return (
                    <div
                      key={group.clientId}
                      className={`border rounded-xl overflow-hidden transition-colors ${hasUnpaid ? 'border-teal-200 bg-white shadow-sm' : 'border-gray-200 bg-gray-50/30'}`}
                    >
                      <button
                        onClick={() => setManuallyToggled(prev => ({ ...prev, [group.clientId]: !isExpanded }))}
                        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group/trigger"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${hasUnpaid ? 'bg-teal-100 text-teal-700' : 'bg-gray-200 text-gray-500'}`}>
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div className="text-left">
                            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                              {group.clientName}
                              {!hasUnpaid && <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />}
                            </h3>
                            <p className="text-xs text-gray-500">
                              {group.payType === 'FLAT_RATE' ? 'Flat Rate Monthly' : `${group.jobs.length} cleans`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`font-bold ${hasUnpaid ? 'text-gray-900' : 'text-gray-500'}`}>
                            {formatCurrency(group.payType === 'FLAT_RATE' ? (group.monthlyAmount || 0) : group.totalAmount)}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="border-t border-gray-100 divide-y divide-gray-50 bg-white">
                          {group.payType === 'FLAT_RATE' ? (
                            <div className="flex items-center justify-between p-3 pl-14 hover:bg-gray-50/50 transition-colors">
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {group.month}
                                </p>
                                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                                  <span>{group.jobs.length} cleans included</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="font-semibold text-sm text-gray-900 tabular-nums">
                                  {formatCurrency(group.monthlyAmount || 0)}
                                </span>
                                {!hasUnpaid ? (
                                  <div className="w-24 text-right">
                                    <p className="text-xs font-semibold text-teal-700 flex items-center justify-end gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                                    </p>
                                    <p className="text-[10px] text-gray-400">{group.jobs[0]?.paidDate ? format(new Date(group.jobs[0].paidDate), 'MMM d, yyyy') : 'Recorded'}</p>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const unpaidIds = group.jobs.filter(j => !j.subcontractorPaid).map(j => j.id)
                                      handleMarkPaid(unpaidIds, group.clientId)
                                    }}
                                    disabled={markingPaidJobId === group.clientId}
                                    className="h-7 px-3 text-xs text-teal-700 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:text-teal-800 w-24"
                                  >
                                    {markingPaidJobId === group.clientId ? 'Saving...' : 'Mark Paid'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ) : (
                            group.jobs.map(job => (
                              <div key={job.id} className="flex items-center justify-between p-3 pl-14 hover:bg-gray-50/50 transition-colors">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {format(new Date(job.date), 'EEE, MMM d')}
                                  </p>
                                  <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                                    <span>{job.scheduleId ? 'Recurring' : 'One-off'}</span>
                                    {job.location.name && (
                                      <>
                                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                                        <span className="truncate max-w-[200px]">{job.location.name}</span>
                                      </>
                                    )}
                                  </p>
                                </div>
                                
                                <div className="flex items-center gap-4">
                                  <span className="font-semibold text-sm text-gray-900 tabular-nums">
                                    {formatCurrency(job.subcontractorRate)}
                                  </span>
                                  
                                  {job.subcontractorPaid ? (
                                    <div className="w-24 text-right">
                                      <p className="text-xs font-semibold text-teal-700 flex items-center justify-end gap-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                                      </p>
                                      <p className="text-[10px] text-gray-400">{job.paidDate ? format(new Date(job.paidDate), 'MMM d, yyyy') : 'Recorded'}</p>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleMarkPaid([job.id], job.id)}
                                      disabled={markingPaidJobId === job.id}
                                      className="h-7 px-3 text-xs text-teal-700 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:text-teal-800 w-24"
                                    >
                                      {markingPaidJobId === job.id ? 'Saving...' : 'Mark Paid'}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Payment Breakdown Modal */}
      <PaymentBreakdownModal
        subcontractor={sub}
        jobs={sub.jobs || []}
        open={payModalOpen}
        onOpenChange={setPayModalOpen}
        onPaymentComplete={() => {
          setPayModalOpen(false)
          mutate()
          globalMutate('/api/subcontractors/data')
          globalMutate('/api/dashboard-stats')
        }}
      />

      {/* Cadence Settings Dialog */}
      <Dialog open={cadenceDialogOpen} onOpenChange={setCadenceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-700" />
              </div>
              Payment Timing
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-gray-500 font-medium">Cadence</Label>
              <select
                value={cadenceForm.paymentCadence}
                onChange={(e) => setCadenceForm({ ...cadenceForm, paymentCadence: e.target.value })}
                className="mt-1 w-full h-10 px-3 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {Object.entries(CADENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                {CADENCE_DESCRIPTIONS[cadenceForm.paymentCadence] || ''}
              </p>
            </div>

            <div>
              <Label className="text-xs text-gray-500 font-medium">
                Notes <span className="text-gray-300">(optional)</span>
              </Label>
              <Textarea
                value={cadenceForm.paymentCadenceNotes}
                onChange={(e) => setCadenceForm({ ...cadenceForm, paymentCadenceNotes: e.target.value })}
                placeholder="e.g., Pay residential when client pays. Commercial monthly."
                className="mt-1 text-sm rounded-lg min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCadenceDialogOpen(false)}
              disabled={savingCadence}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setSavingCadence(true)
                try {
                  const res = await fetch(`/api/subcontractors/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      paymentCadence: cadenceForm.paymentCadence,
                      paymentCadenceNotes: cadenceForm.paymentCadenceNotes || null,
                      excludeClientIds: cadenceForm.excludeClientIds || null,
                    }),
                  })
                  if (!res.ok) throw new Error('Failed to save')
                  showSuccess('Payment timing updated')
                  setCadenceDialogOpen(false)
                  mutate()
                } catch {
                  showError('Failed to save payment timing')
                } finally {
                  setSavingCadence(false)
                }
              }}
              disabled={savingCadence}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {savingCadence ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <ConfirmDialog />
    </div>
  )
}
