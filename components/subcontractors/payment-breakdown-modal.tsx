"use client"

import { useState, useMemo, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/utils"
import { CreditCard, ChevronDown, ChevronRight, Calendar, X } from "lucide-react"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { format, isWithinInterval, parseISO } from "date-fns"
import { logger } from "@/lib/logger"
import { showError, showSuccess } from "@/lib/toast"
import type { CleanerJob } from "@/types"

interface ClientRow {
  clientId: string
  clientName: string
  payType: "FLAT_RATE" | "PER_CLEAN" | "ONE_OFF"
  amount: number
  jobs: CleanerJob[]
}

interface MonthGroup {
  monthKey: string
  label: string
  clients: ClientRow[]
  total: number
  allJobIds: string[]
}

interface PaymentBreakdownModalProps {
  subcontractor: { id: string; name: string } | null
  jobs: CleanerJob[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaymentComplete: () => void
}

export function PaymentBreakdownModal({
  subcontractor,
  jobs,
  open,
  onOpenChange,
  onPaymentComplete,
}: PaymentBreakdownModalProps) {
  const today = format(new Date(), "yyyy-MM-dd")

  const earliestJobDate = useMemo(() => {
    if (!jobs || jobs.length === 0) return today
    const dates = jobs.map(j => new Date(j.date).getTime())
    return format(new Date(Math.min(...dates)), "yyyy-MM-dd")
  }, [jobs, today])

  const [fromDate, setFromDate] = useState(earliestJobDate)
  const [toDate, setToDate] = useState(today)
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set())
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [datePaid, setDatePaid] = useState(today)
  const [paymentNotes, setPaymentNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setFromDate(earliestJobDate)
      setToDate(today)
    }
  }, [open, earliestJobDate, today])

  const monthGroups: MonthGroup[] = useMemo(() => {
    if (!jobs || jobs.length === 0) return []

    const from = parseISO(fromDate)
    const to = parseISO(toDate)
    to.setHours(23, 59, 59, 999)

    const filtered = jobs.filter((job) => {
      const d = new Date(job.date)
      return isWithinInterval(d, { start: from, end: to })
    })

    const byMonth = new Map<string, CleanerJob[]>()
    filtered.forEach((job) => {
      const key = format(new Date(job.date), "yyyy-MM")
      if (!byMonth.has(key)) byMonth.set(key, [])
      byMonth.get(key)!.push(job)
    })

    const groups: MonthGroup[] = []

    byMonth.forEach((monthJobs, monthKey) => {
      const label = format(new Date(monthJobs[0].date), "MMMM yyyy").toUpperCase()

      const byClient = new Map<string, CleanerJob[]>()
      monthJobs.forEach((job) => {
        // Group by clientId:scheduleId to keep multi-location clients separate
        const cid = job.location.client.id
        const key = job.scheduleId
          ? `${cid}:${job.scheduleId}`
          : `${cid}:${job.location.id}:one-off:${job.id}`
        if (!byClient.has(key)) byClient.set(key, [])
        byClient.get(key)!.push(job)
      })

      const clients: ClientRow[] = []
      const allJobIds: string[] = []

      byClient.forEach((clientJobs, groupKey) => {
        const first = clientJobs[0]
        const client = first.location.client
        const schedule = first.schedule
        const isOneOff = first.scheduleId === null

        // Determine pay type using schedule data first, then client fallback
        let payType: "FLAT_RATE" | "PER_CLEAN" | "ONE_OFF"
        let amount: number

        if (isOneOff && clientJobs.length === 1) {
          payType = "ONE_OFF"
          amount = clientJobs[0].subcontractorRate
        } else {
          // Use the same fallback chain as the centralized payout helper
          const resolvedPayType = schedule?.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN'
          if (resolvedPayType === "FLAT_RATE" && !isOneOff) {
            payType = "FLAT_RATE"
            amount = schedule?.defaultSubcontractorRate ?? first.subcontractorRate
          } else {
            payType = "PER_CLEAN"
            amount = clientJobs.reduce((s, j) => s + j.subcontractorRate, 0)
          }
        }

        const locationName = first.location?.name
        const displayName = locationName ? `${client.name} — ${locationName}` : client.name

        const sorted = [...clientJobs].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        )

        allJobIds.push(...sorted.map((j) => j.id))
        clients.push({ clientId: groupKey, clientName: displayName, payType, amount, jobs: sorted })
      })

      clients.sort((a, b) => b.amount - a.amount)
      const monthTotal = clients.reduce((sum, c) => sum + c.amount, 0)
      groups.push({ monthKey, label, clients, total: monthTotal, allJobIds })
    })

    groups.sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    return groups
  }, [jobs, fromDate, toDate])

  useEffect(() => {
    setSelectedMonths(new Set(monthGroups.map((g) => g.monthKey)))
  }, [monthGroups])

  const { totalAmount, totalClients, totalCleans, dateRangeLabel } = useMemo(() => {
    let amount = 0
    const clientSet = new Set<string>()
    let cleans = 0

    monthGroups.forEach((mg) => {
      if (!selectedMonths.has(mg.monthKey)) return
      amount += mg.total
      mg.clients.forEach((c) => {
        clientSet.add(c.clientId)
        cleans += c.jobs.length
      })
    })

    const selectedGroupLabels = monthGroups
      .filter((g) => selectedMonths.has(g.monthKey))
      .map((g) => g.label)

    let label = ""
    if (selectedGroupLabels.length === 1) label = selectedGroupLabels[0]
    else if (selectedGroupLabels.length > 1) label = `${selectedGroupLabels[selectedGroupLabels.length - 1]} – ${selectedGroupLabels[0]}`

    return { totalAmount: amount, totalClients: clientSet.size, totalCleans: cleans, dateRangeLabel: label }
  }, [monthGroups, selectedMonths])

  const selectedJobIds = useMemo(() => {
    const ids: string[] = []
    monthGroups.forEach((mg) => {
      if (!selectedMonths.has(mg.monthKey)) return
      ids.push(...mg.allJobIds)
    })
    return ids
  }, [monthGroups, selectedMonths])

  const toggleMonth = (monthKey: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev)
      next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey)
      return next
    })
  }

  const toggleCollapse = (monthKey: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev)
      next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey)
      return next
    })
  }

  const toggleClientExpand = (key: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handlePay = async () => {
    if (!subcontractor || selectedJobIds.length === 0) {
      showError("Please select at least one month to pay for")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/subcontractors/${subcontractor.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: selectedJobIds, datePaid, notes: paymentNotes || null }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to record payment")
      }

      showSuccess(`Payment of ${formatCurrency(totalAmount)} recorded for ${subcontractor.name}!`)
      onPaymentComplete()
    } catch (error) {
      logger.error("Error recording payment:", error)
      showError(error instanceof Error ? error.message : "Failed to record payment")
    } finally {
      setIsSubmitting(false)
    }
  }

  const payTypeBadge = (type: "FLAT_RATE" | "PER_CLEAN" | "ONE_OFF") => {
    const labels: Record<string, string> = { FLAT_RATE: "FLAT RATE", PER_CLEAN: "PER CLEAN", ONE_OFF: "ONE-OFF" }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-gray-100 text-gray-500">
        {labels[type]}
      </span>
    )
  }

  if (!subcontractor) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="max-w-lg p-0 flex flex-col overflow-hidden max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-start justify-between">
          <DialogHeader className="flex-1">
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-4 h-4 text-white" />
              </div>
              Pay {subcontractor.name}
            </DialogTitle>
            <p className="text-gray-400 text-sm mt-0.5">
              Review what you&apos;re paying for, then confirm
            </p>
          </DialogHeader>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-3 space-y-3">
          {/* Pay period filter */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Pay period
            </label>
            <div className="flex items-center gap-2 mt-1">
              <div className="relative flex-1">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="pl-8 h-9 text-sm rounded-lg"
                />
              </div>
              <span className="text-xs text-gray-400">to</span>
              <div className="relative flex-1">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="pl-8 h-9 text-sm rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Total Payment summary */}
          <div className="rounded-xl p-3 bg-white border border-gray-200 border-l-4 border-l-teal-600">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium text-gray-400">Total Payment</span>
              <span className="text-2xl font-bold text-gray-900">{formatCurrency(totalAmount)}</span>
            </div>
            <p className="text-xs text-gray-400">
              {totalClients} client{totalClients !== 1 ? "s" : ""} &bull; {dateRangeLabel} &bull; {totalCleans} clean{totalCleans !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Month sections */}
          {monthGroups.length === 0 ? (
            <p className="text-sm text-center py-6 text-gray-400">No unpaid jobs in this date range</p>
          ) : (
            <div className="space-y-2">
              {monthGroups.map((mg) => {
                const isSelected = selectedMonths.has(mg.monthKey)
                const isCollapsed = collapsedMonths.has(mg.monthKey)

                return (
                  <div
                    key={mg.monthKey}
                    className={`rounded-xl border border-gray-200 overflow-hidden transition-opacity ${isSelected ? 'opacity-100' : 'opacity-40'}`}
                  >
                    {/* Month header */}
                    <div className={`flex items-center gap-3 px-4 py-2.5 ${!isCollapsed ? 'border-b border-gray-100' : ''}`}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleMonth(mg.monthKey)}
                        className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
                      />
                      <button
                        onClick={() => toggleCollapse(mg.monthKey)}
                        className="flex-1 flex items-center justify-between cursor-pointer"
                      >
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                          {mg.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900">{formatCurrency(mg.total)}</span>
                          <ChevronDown
                            className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          />
                        </div>
                      </button>
                    </div>

                    {/* Client rows */}
                    <div className={`collapsible-content ${!isCollapsed ? 'expanded' : ''}`}>
                      <div>
                          {mg.clients.map((client) => {
                            const expandKey = `${mg.monthKey}-${client.clientId}`
                            const isExpandable = client.payType !== "FLAT_RATE"
                            const isExpanded = expandedClients.has(expandKey)

                            return (
                              <div key={client.clientId}>
                                <div
                                  className={`flex items-center gap-3 px-4 py-2 border-b border-gray-50 ${isExpandable ? "cursor-pointer hover:bg-gray-50" : ""}`}
                                  onClick={() => isExpandable && toggleClientExpand(expandKey)}
                                >
                                  <span className="text-sm font-semibold flex-1 min-w-0 truncate text-gray-900">
                                    {client.clientName}
                                  </span>
                                  {payTypeBadge(client.payType)}
                                  <span className="text-sm font-bold ml-2 whitespace-nowrap text-gray-900">
                                    {formatCurrency(client.amount)}
                                  </span>
                                  {isExpandable ? (
                                    <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                                  ) : (
                                    <span className="w-3.5 h-3.5 flex-shrink-0 inline-block" />
                                  )}
                                </div>

                                <div className={`collapsible-content ${isExpandable && isExpanded ? 'expanded' : ''}`}>
                                  <div>
                                      <div className="pl-8 pr-4 border-b border-gray-50">
                                        {client.jobs.map((job) => (
                                          <div key={job.id} className="flex items-center py-1.5">
                                            <span className="text-xs flex-1 text-gray-400">
                                              {format(new Date(job.date), "MMM d, yyyy")}
                                            </span>
                                            <span className="text-xs w-20 text-center text-gray-400">
                                              {format(new Date(job.date), "EEEE")}
                                            </span>
                                            <span className="text-xs font-semibold text-right w-20 text-gray-900">
                                              {formatCurrency(job.subcontractorRate)}
                                            </span>
                                          </div>
                                        ))}
                                        <div className="flex items-center py-1.5 mt-0.5 mb-1.5 rounded-md px-2 bg-gray-50">
                                          <span className="text-xs flex-1 text-gray-400">Subtotal</span>
                                          <span className="text-xs font-bold text-right w-20 text-gray-900">
                                            {formatCurrency(client.amount)}
                                          </span>
                                        </div>
                                      </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-gray-200 px-5 py-3 space-y-2.5 bg-white">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs font-medium text-gray-400">Payment Date</Label>
              <Input
                type="date"
                value={datePaid}
                onChange={(e) => setDatePaid(e.target.value)}
                className="mt-1 h-9 text-sm rounded-lg"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-400">
                Notes <span className="text-gray-300">(optional)</span>
              </Label>
              <Input
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Zelle, cash, check..."
                className="mt-1 h-9 text-sm rounded-lg"
              />
            </div>
          </div>

          <Button
            onClick={handlePay}
            disabled={isSubmitting || selectedJobIds.length === 0}
            className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg"
          >
            {isSubmitting ? (
              <>Recording... <ActionSpinner size={16} color="white" className="ml-1.5" /></>
            ) : (
              `Pay ${formatCurrency(totalAmount)}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
