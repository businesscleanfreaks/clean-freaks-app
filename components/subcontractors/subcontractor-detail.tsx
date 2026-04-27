"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
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
import { formatCurrency } from "@/lib/utils"
import {
  DollarSign, Calendar, CheckCircle2,
  ChevronDown, ChevronUp, MapPin,
  FileText, Check, Minus, History,
  RotateCcw, Download,
} from "lucide-react"
import { format } from "date-fns"
import { showError, showSuccess, showApiError } from "@/lib/toast"
import { useConfirm } from "@/hooks/use-confirm"
import { logger } from "@/lib/logger"
import type { CleanerData, CleanerJob } from "@/types"

interface ClientGroup {
  clientId: string
  clientName: string
  payType: 'FLAT_RATE' | 'PER_CLEAN'
  jobs: CleanerJob[]
  monthlyAmount?: number
  totalAmount: number
  month?: string
}

interface SubcontractorDetailProps {
  subcontractor: CleanerData
  onDataChange?: () => void
}

export function SubcontractorDetail({ subcontractor, onDataChange }: SubcontractorDetailProps) {
  const router = useRouter()
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [datePaid, setDatePaid] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [paymentNotes, setPaymentNotes] = useState('')
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [showHistory, setShowHistory] = useState(false)
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  const handleDownloadStatement = async () => {
    setIsDownloading(true)
    try {
      const res = await fetch(`/api/subcontractors/${subcontractor.id}/statement`)
      if (!res.ok) throw new Error('Failed to download')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Statement_${subcontractor.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      showSuccess('Statement downloaded')
    } catch {
      showError('Failed to download statement')
    } finally {
      setIsDownloading(false)
    }
  }

  const clientGroups = useMemo(() => {
    const groups: ClientGroup[] = []
    const jobsByClient = new Map<string, CleanerJob[]>()

    ;(subcontractor.jobs || []).forEach(job => {
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

    return groups.sort((a, b) => b.totalAmount - a.totalAmount)
  }, [subcontractor.jobs])

  const jobs = subcontractor.jobs || []
  const flatRateGroups = useMemo(() => clientGroups.filter(g => g.payType === 'FLAT_RATE'), [clientGroups])
  const perCleanGroups = useMemo(() => clientGroups.filter(g => g.payType === 'PER_CLEAN'), [clientGroups])
  const correctTotalOwed = useMemo(() => clientGroups.reduce((sum, g) => sum + g.totalAmount, 0), [clientGroups])

  useEffect(() => {
    setSelectedJobIds(new Set(jobs.map(j => j.id)))
  }, [jobs])

  const { selectedTotal, selectedCount } = useMemo(() => {
    let total = 0
    let count = 0
    clientGroups.forEach(group => {
      if (group.payType === 'FLAT_RATE') {
        const anySelected = group.jobs.some(j => selectedJobIds.has(j.id))
        if (anySelected) { total += group.monthlyAmount || 0; count += 1 }
      } else {
        group.jobs.forEach(job => {
          if (selectedJobIds.has(job.id)) { total += job.subcontractorRate; count += 1 }
        })
      }
    })
    return { selectedTotal: total, selectedCount: count }
  }, [selectedJobIds, clientGroups])

  const toggleClientJobs = (clientId: string, selected: boolean) => {
    const group = clientGroups.find(g => g.clientId === clientId)
    if (!group) return
    const newSelected = new Set(selectedJobIds)
    group.jobs.forEach(job => { selected ? newSelected.add(job.id) : newSelected.delete(job.id) })
    setSelectedJobIds(newSelected)
  }

  const isClientFullySelected = (clientId: string) => {
    const group = clientGroups.find(g => g.clientId === clientId)
    return group ? group.jobs.every(j => selectedJobIds.has(j.id)) : false
  }

  const isClientPartiallySelected = (clientId: string) => {
    const group = clientGroups.find(g => g.clientId === clientId)
    if (!group) return false
    const selectedCount = group.jobs.filter(j => selectedJobIds.has(j.id)).length
    return selectedCount > 0 && selectedCount < group.jobs.length
  }

  const toggleJob = (jobId: string) => {
    const newSelected = new Set(selectedJobIds)
    newSelected.has(jobId) ? newSelected.delete(jobId) : newSelected.add(jobId)
    setSelectedJobIds(newSelected)
  }

  const selectAll = () => setSelectedJobIds(new Set((subcontractor.jobs || []).map(j => j.id)))
  const deselectAll = () => setSelectedJobIds(new Set())

  const toggleClientExpanded = (clientId: string) => {
    const newExpanded = new Set(expandedClients)
    newExpanded.has(clientId) ? newExpanded.delete(clientId) : newExpanded.add(clientId)
    setExpandedClients(newExpanded)
  }

  const handleRecordPayment = async (jobIds?: string[]) => {
    const idsToSubmit = jobIds || Array.from(selectedJobIds)
    if (idsToSubmit.length === 0) {
      showError('Please select at least one item to pay for')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/subcontractors/${subcontractor.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobIds: idsToSubmit,
          datePaid,
          notes: paymentNotes || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to record payment')
      }

      showSuccess(`Payment of ${formatCurrency(selectedTotal)} recorded!`)
      setShowPaymentDialog(false)
      setPaymentNotes('')
      onDataChange?.()
    } catch (error) {
      logger.error('Error recording payment:', error)
      showError('Failed to record payment. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVoidPayment = async (paymentId: string) => {
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
      const response = await fetch(`/api/subcontractors/${subcontractor.id}/payments/${paymentId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to undo payment')
        setVoidingPaymentId(null)
        return
      }
      showSuccess('Payment undone - jobs marked as unpaid')
      onDataChange?.()
    } catch {
      showError('Failed to undo payment. Please try again.')
    } finally {
      setVoidingPaymentId(null)
    }
  }

  const hasUnpaidJobs = (subcontractor.jobs || []).length > 0

  return (
    <div className="space-y-4">
      {/* Tab toggle: Statement / History */}
      <div className="flex gap-2 items-center justify-between">
        <div className="flex gap-2">
          <Button
            variant={!showHistory ? 'default' : 'outline'}
            onClick={() => setShowHistory(false)}
            size="sm"
            className={`rounded-lg ${!showHistory ? 'bg-teal-600 hover:bg-teal-700 text-white' : ''}`}
          >
            <FileText className="w-4 h-4 mr-1.5" />
            Statement
          </Button>
          <Button
            variant={showHistory ? 'default' : 'outline'}
            onClick={() => setShowHistory(true)}
            size="sm"
            className={`rounded-lg ${showHistory ? 'bg-teal-600 hover:bg-teal-700 text-white' : ''}`}
          >
            <History className="w-4 h-4 mr-1.5" />
            History ({subcontractor.payments?.length || 0})
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadStatement}
          disabled={isDownloading}
          className="rounded-lg text-xs"
        >
          <Download className="w-3.5 h-3.5 mr-1" />
          {isDownloading ? 'Downloading...' : 'Download CSV'}
        </Button>
      </div>

      {showHistory ? (
        /* PAYMENT HISTORY */
        <div className="space-y-3">
          {!subcontractor.payments || subcontractor.payments.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
              <History className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="font-semibold text-gray-700 mb-1">No payment history</h3>
              <p className="text-gray-400 text-sm">Payments you record will appear here.</p>
            </div>
          ) : (
            subcontractor.payments.map(payment => (
              <div key={payment.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        {format(new Date(payment.datePaid), 'MMMM d, yyyy')}
                      </p>
                      <p className="text-xs text-gray-400">
                        {payment.lineItems.length} job{payment.lineItems.length !== 1 ? 's' : ''}
                        {payment.notes && <span> · {payment.notes}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-lg font-bold text-teal-600">{formatCurrency(payment.totalAmount)}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleVoidPayment(payment.id)}
                      disabled={voidingPaymentId === payment.id}
                      className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 rounded-lg text-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      {voidingPaymentId === payment.id ? 'Undoing...' : 'Undo'}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* CURRENT STATEMENT */
        <>
          {!hasUnpaidJobs ? (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
              <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">All Caught Up!</h3>
              <p className="text-gray-400 text-sm">No unpaid jobs for {subcontractor.name}.</p>
            </div>
          ) : (
            <>
              {/* Selection Controls */}
              <div className="flex items-center justify-between">
                <p className="text-gray-400 text-sm">
                  <span className="font-semibold text-gray-900">{selectedCount}</span> of {(subcontractor.jobs || []).length} items selected
                </p>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={selectAll} className="rounded-lg text-xs">
                    <Check className="w-3 h-3 mr-1" /> All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll} className="rounded-lg text-xs">
                    <Minus className="w-3 h-3 mr-1" /> Clear
                  </Button>
                </div>
              </div>

              {/* FLAT RATE SECTION */}
              {flatRateGroups.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-teal-50/50">
                    <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-teal-600" />
                      Flat Rate Monthly
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {flatRateGroups.map(group => {
                      const isSelected = isClientFullySelected(group.clientId)
                      return (
                        <label
                          key={group.clientId}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                            isSelected ? 'bg-teal-50/50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => toggleClientJobs(group.clientId, !!checked)}
                            className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                          />
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 text-sm">{group.clientName}</p>
                            <p className="text-xs text-teal-600">{group.month}</p>
                            <p className="text-xs text-gray-400">{group.jobs.length} clean{group.jobs.length !== 1 ? 's' : ''} included</p>
                          </div>
                          <p className="font-bold text-teal-700 text-sm">{formatCurrency(group.monthlyAmount || 0)}</p>
                        </label>
                      )
                    })}
                  </div>
                  <div className="bg-gray-50 px-4 py-2.5 border-t border-gray-100 flex justify-between items-center">
                    <p className="text-xs text-gray-400">Flat Rate Subtotal</p>
                    <p className="font-bold text-gray-900 text-sm">
                      {formatCurrency(flatRateGroups.reduce((sum, g) => sum + (isClientFullySelected(g.clientId) ? (g.monthlyAmount || 0) : 0), 0))}
                    </p>
                  </div>
                </div>
              )}

              {/* PER CLEAN SECTION */}
              {perCleanGroups.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 bg-teal-50/50">
                    <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-teal-600" />
                      Per Clean
                    </h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {perCleanGroups.map(group => {
                      const isExpanded = expandedClients.has(group.clientId)
                      const isFullySelected = isClientFullySelected(group.clientId)
                      const isPartially = isClientPartiallySelected(group.clientId)
                      const selectedJobsInGroup = group.jobs.filter(j => selectedJobIds.has(j.id))
                      const selectedAmount = selectedJobsInGroup.reduce((sum, j) => sum + j.subcontractorRate, 0)

                      return (
                        <Collapsible
                          key={group.clientId}
                          open={isExpanded}
                          onOpenChange={() => toggleClientExpanded(group.clientId)}
                        >
                          <div className={`flex items-center gap-3 px-4 py-3 ${isFullySelected || isPartially ? 'bg-teal-50/30' : ''}`}>
                            <Checkbox
                              checked={isFullySelected}
                              className={`data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600 ${isPartially ? 'bg-teal-200 border-teal-400' : ''}`}
                              onCheckedChange={(checked) => toggleClientJobs(group.clientId, !!checked)}
                            />
                            <CollapsibleTrigger className="flex-1 flex items-center justify-between cursor-pointer group">
                              <div>
                                <p className="font-medium text-gray-900 group-hover:text-teal-700 transition-colors text-sm">{group.clientName}</p>
                                <p className="text-xs text-gray-400">{selectedJobsInGroup.length} of {group.jobs.length} selected</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-gray-900 text-sm">{formatCurrency(selectedAmount)}</p>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                              </div>
                            </CollapsibleTrigger>
                          </div>
                          <CollapsibleContent>
                            <div className="border-t border-gray-100 bg-gray-50/50">
                              {group.jobs
                                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                .map(job => {
                                  const isJobSelected = selectedJobIds.has(job.id)
                                  return (
                                    <label
                                      key={job.id}
                                      className={`flex items-center gap-3 px-4 py-2.5 pl-10 cursor-pointer transition-colors border-b border-gray-100 last:border-b-0 ${
                                        isJobSelected ? 'bg-teal-50/50' : 'hover:bg-gray-100'
                                      }`}
                                    >
                                      <Checkbox
                                        checked={isJobSelected}
                                        onCheckedChange={() => toggleJob(job.id)}
                                        className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-900">{format(new Date(job.date), 'EEE, MMM d, yyyy')}</p>
                                        <p className="text-xs text-gray-400">{job.location.name}</p>
                                      </div>
                                      <p className={`font-medium text-sm ${isJobSelected ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {formatCurrency(job.subcontractorRate)}
                                      </p>
                                    </label>
                                  )
                                })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )
                    })}
                  </div>
                  <div className="bg-gray-50 px-4 py-2.5 border-t border-gray-100 flex justify-between items-center">
                    <p className="text-xs text-gray-400">Per Clean Subtotal</p>
                    <p className="font-bold text-gray-900 text-sm">
                      {formatCurrency(perCleanGroups.reduce((sum, g) => sum + g.jobs.filter(j => selectedJobIds.has(j.id)).reduce((s, j) => s + j.subcontractorRate, 0), 0))}
                    </p>
                  </div>
                </div>
              )}

              {/* Record Payment Button */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400">Selected total</p>
                  <p className="text-xl font-bold text-gray-900">{formatCurrency(selectedTotal)}</p>
                </div>
                <Button
                  onClick={() => setShowPaymentDialog(true)}
                  disabled={selectedCount === 0}
                  className="bg-teal-600 hover:bg-teal-700 text-white h-10 px-5 text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  <DollarSign className="w-4 h-4 mr-1.5" />
                  Record Payment
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {/* MANUAL PAYMENT DIALOG */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              Record Payment
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-teal-700 text-sm">Paying:</span>
                <span className="font-semibold text-gray-900 text-sm">{subcontractor.name}</span>
              </div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-teal-700 text-sm">Items:</span>
                <span className="font-semibold text-gray-900 text-sm">{selectedCount} selected</span>
              </div>
              <div className="border-t border-teal-200 pt-1.5 mt-1.5 flex items-center justify-between">
                <span className="text-teal-700 font-medium text-sm">Amount:</span>
                <span className="text-xl font-bold text-gray-900">{formatCurrency(selectedTotal)}</span>
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-500 font-medium">Payment Date</Label>
              <Input
                type="date"
                value={datePaid}
                onChange={(e) => setDatePaid(e.target.value)}
                className="mt-1 h-9 text-sm rounded-lg"
              />
            </div>

            <div>
              <Label className="text-xs text-gray-500 font-medium">Notes <span className="text-gray-300">(optional)</span></Label>
              <Textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="e.g., Venmo, check #1234, Zelle..."
                className="mt-1 resize-none text-sm rounded-lg"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPaymentDialog(false)}
              disabled={isSubmitting}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleRecordPayment()}
              disabled={isSubmitting}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {isSubmitting ? 'Recording...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  )
}
