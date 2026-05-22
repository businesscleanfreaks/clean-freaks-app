"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { mutate as globalMutate } from "swr"
import { format } from "date-fns"
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { buildSubcontractorPayLedger, type PayLedgerGroup } from "@/lib/payout-calculator"
import { cn, formatCurrency } from "@/lib/utils"
import { showError, showSuccess } from "@/lib/toast"
import type { CleanerData, CleanerJob } from "@/types"

interface SubcontractorsPageWrapperProps {
  subcontractors: CleanerData[]
  period: string
  onPeriodChange: (period: string) => void
  onDataChange: () => void
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function sendsInvoices(name: string) {
  return /celeste|ana lina|ricardo/i.test(name)
}

function getJobsForDisplay(sub: CleanerData) {
  return (Array.isArray(sub.periodJobs) ? sub.periodJobs : sub.jobs || []) as CleanerJob[]
}

function getGroups(sub: CleanerData) {
  return buildSubcontractorPayLedger(getJobsForDisplay(sub)).groups
}

function getCleanerTotals(sub: CleanerData) {
  const groups = getGroups(sub)
  const total = groups.reduce((sum, group) => sum + group.totalAmount, 0)
  const unpaid = groups.reduce((sum, group) => sum + group.owedAmount, 0)
  return { groups, total, unpaid, paid: Math.max(0, total - unpaid) }
}

function shortClientName(name: string) {
  return name
    .replace(/\bCorporation\b/gi, "")
    .replace(/\bCondominiums\b/gi, "Condos")
    .replace(/\s+/g, " ")
    .trim()
}

function accountName(group: PayLedgerGroup) {
  const firstJob = group.jobs[0]
  const clientName = firstJob?.location?.client?.name || group.clientName
  const locationName = firstJob?.location?.name || ""
  const shortClient = shortClientName(clientName)

  if (!locationName || locationName.toLowerCase() === clientName.toLowerCase()) {
    return shortClient
  }

  const stripped = locationName
    .replace(new RegExp(clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
    .replace(new RegExp(shortClient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
    .replace(/[()\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (stripped) return `${shortClient} (${stripped})`
  return shortClient
}

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number)
  return format(new Date(year, month - 1, 1), "MMMM yyyy")
}

function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function cleanDateLabel(job: CleanerJob) {
  return format(new Date(job.date), "EEE, MMM d")
}

function jobTotal(job: CleanerJob) {
  return (job.subcontractorRate || 0) + (job.addOnServices || []).reduce((sum, addOn) => sum + (addOn.subcontractorRate || 0), 0)
}

export function WorkersPageWrapper({
  subcontractors,
  period,
  onPeriodChange,
  onDataChange,
}: SubcontractorsPageWrapperProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedCleaner, setExpandedCleaner] = useState<string | null>(null)
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editingCleaner, setEditingCleaner] = useState<CleanerData | null>(null)
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", notes: "" })
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const openEditCleaner = (sub: CleanerData) => {
    setEditForm({
      name: sub.name || "",
      phone: sub.phone || "",
      email: sub.email || "",
      notes: sub.notes || "",
    })
    setEditingCleaner(sub)
  }

  const handleSaveEdit = async () => {
    if (!editingCleaner || !editForm.name.trim()) return
    setIsSavingEdit(true)
    try {
      const res = await fetch(`/api/subcontractors/${editingCleaner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error("Failed to update")
      showSuccess(`${editForm.name} updated`)
      setEditingCleaner(null)
      onDataChange()
    } catch {
      showError("Failed to update cleaner")
    } finally {
      setIsSavingEdit(false)
    }
  }

  const patchPaymentState = (jobIds: string[], paid: boolean) => {
    const ids = new Set(jobIds)
    const patchJobs = (jobs: CleanerJob[] = []) =>
      jobs?.map(job => ids.has(job.id) ? { ...job, subcontractorPaid: paid } : job)

    void globalMutate(
      `/api/subcontractors/data?period=${period}`,
      (current: CleanerData[] | undefined) => current?.map(sub => ({
        ...sub,
        jobs: patchJobs(sub.jobs),
        periodJobs: patchJobs(sub.periodJobs),
      })),
      { revalidate: false }
    )
  }

  const refreshAfterPaymentChange = (jobIds: string[], paid: boolean) => {
    patchPaymentState(jobIds, paid)
    onDataChange()
    globalMutate("/dashboard-stats")
    globalMutate("/api/dashboard-stats")
  }

  const markJobsPaid = async (subId: string, jobIds: string[], key: string) => {
    if (jobIds.length === 0) return
    setPendingKey(key)
    try {
      const res = await fetch(`/api/subcontractors/${subId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds,
          datePaid: format(new Date(), "yyyy-MM-dd"),
          notes: null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to mark paid")
      showSuccess("Payment tracked")
      refreshAfterPaymentChange(jobIds, true)
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to mark paid")
    } finally {
      setPendingKey(null)
    }
  }

  const unmarkJobsPaid = async (jobIds: string[], key: string) => {
    if (jobIds.length === 0) return
    setPendingKey(key)
    try {
      // Jobs marked together commonly share one payment. Undo those writes in
      // order so payment-line cleanup cannot race itself on the same payment.
      for (const jobId of jobIds) {
        const res = await fetch(`/api/jobs/${jobId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subcontractorPaid: false }),
        })
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.error || "Failed to unmark paid")
        }
      }
      showSuccess("Payment unchecked")
      refreshAfterPaymentChange(jobIds, false)
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to unmark paid")
    } finally {
      setPendingKey(null)
    }
  }

  const toggleGroupPaid = (sub: CleanerData, group: PayLedgerGroup) => {
    const key = `${sub.id}:${group.clientId}`
    const paidJobs = group.jobs.filter(job => job.subcontractorPaid).map(job => job.id)
    const unpaidJobs = group.jobs.filter(job => !job.subcontractorPaid).map(job => job.id)
    if (group.unpaidCount > 0) {
      markJobsPaid(sub.id, unpaidJobs, key)
    } else {
      unmarkJobsPaid(paidJobs, key)
    }
  }

  const toggleJobPaid = (sub: CleanerData, job: CleanerJob) => {
    const key = `${sub.id}:${job.id}`
    if (job.subcontractorPaid) {
      unmarkJobsPaid([job.id], key)
    } else {
      markJobsPaid(sub.id, [job.id], key)
    }
  }

  const handleArchiveCleaner = async (sub: CleanerData) => {
    if (!confirm(`Archive ${sub.name}? They will be hidden from the active list but all history will be preserved.`)) return
    try {
      const res = await fetch(`/api/subcontractors/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      })
      if (!res.ok) throw new Error("Failed to archive")
      showSuccess(`${sub.name} archived`)
      onDataChange()
    } catch {
      showError("Failed to archive cleaner")
    }
  }

  const rows = useMemo(() => {
    return subcontractors
      .filter(sub => sub.isActive !== false)
      .map(sub => ({ sub, ...getCleanerTotals(sub) }))
      .filter(row => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        return row.sub.name.toLowerCase().includes(query)
          || row.sub.email?.toLowerCase().includes(query)
          || row.sub.phone?.toLowerCase().includes(query)
          || row.groups.some(group => accountName(group).toLowerCase().includes(query))
      })
      .sort((a, b) => b.unpaid - a.unpaid || a.sub.name.localeCompare(b.sub.name))
  }, [subcontractors, searchQuery])

  const archivedSubcontractors = useMemo(
    () => subcontractors.filter(sub => sub.isActive === false),
    [subcontractors]
  )

  const totalUnpaid = rows.reduce((sum, row) => sum + row.unpaid, 0)

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4 border-b-2 border-gray-950 pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Cleaners</h1>
              <p className="text-sm text-gray-500">Manual Zelle tracking for cleaner payouts</p>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {periodLabel(period)} · Unpaid
              </div>
              <div className={cn("font-mono text-2xl font-bold tracking-tight", totalUnpaid > 0 ? "text-red-600" : "text-emerald-600")}>
                {formatCurrency(totalUnpaid)}
              </div>
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center overflow-hidden rounded-md border border-gray-200 bg-white">
            <button
              className="border-r border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50"
              onClick={() => onPeriodChange(shiftPeriod(period, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex min-w-[150px] items-center justify-center gap-2 px-4 py-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-teal-700" />
              {periodLabel(period)}
            </span>
            <button
              className="border-l border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50"
              onClick={() => onPeriodChange(shiftPeriod(period, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <div className="relative min-w-[180px] flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="h-10 rounded-md bg-white pl-9"
              />
            </div>
            <Link href="/subcontractors/new">
              <Button variant="outline" className="h-10 gap-2 rounded-md">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add Cleaner</span>
              </Button>
            </Link>
          </div>
        </div>

        {subcontractors.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No cleaners yet"
            description="Add your first cleaner to start tracking payments and assignments."
            actionLabel="Add Cleaner"
            actionHref="/subcontractors/new"
            helpTooltip="empty-subcontractors"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-950 px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Cleaner</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Owed</span>
            </div>

            {rows.map(({ sub, groups, total, unpaid, paid }, rowIndex) => {
              const isExpanded = expandedCleaner === sub.id
              const initials = getInitials(sub.name)
              const { hex } = getCleanerColorInfo(sub.name)

              return (
                <div key={sub.id} className={cn(rowIndex < rows.length - 1 && "border-b border-gray-100")}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-gray-50",
                      isExpanded && "bg-gray-50"
                    )}
                    onClick={() => setExpandedCleaner(isExpanded ? null : sub.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setExpandedCleaner(isExpanded ? null : sub.id)
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: hex }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            href={`/subcontractors/${sub.id}`}
                            className="truncate text-[15px] font-semibold text-gray-950 hover:text-teal-700"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {sub.name}
                          </Link>
                          {sendsInvoices(sub.name) && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                              Sends invoices
                            </span>
                          )}
                          <ChevronDown className={cn("h-3 w-3 text-gray-400 transition-transform", isExpanded && "rotate-180")} />
                        </div>
                        <p className="text-xs text-gray-500">
                          {groups.length} account{groups.length === 1 ? "" : "s"} · {unpaid === 0 ? "Paid up" : `${formatCurrency(paid)} of ${formatCurrency(total)} paid`}
                        </p>
                      </div>
                    </div>
                    <div className={cn("font-mono text-base font-bold tracking-tight", unpaid === 0 && "text-emerald-600")}>
                      {unpaid > 0 ? formatCurrency(unpaid) : "✓"}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-gray-50 px-4 pb-3 pl-16">
                      <div className="flex items-center justify-between px-3 pb-1 pt-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Amount</span>
                      </div>

                      {groups.length === 0 ? (
                        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                          No payable jobs for {periodLabel(period)}.
                        </div>
                      ) : groups.map(group => {
                        const key = `${sub.id}:${group.clientId}`
                        const isAccountExpanded = expandedAccount === key
                        const isPaid = group.unpaidCount === 0
                        const isBusy = pendingKey === key
                        const perClean = group.payType === "PER_CLEAN"

                        return (
                          <div
                            key={group.clientId}
                            className={cn(
                              "mb-1.5 overflow-hidden rounded-md border border-gray-200 bg-white transition-opacity",
                              isPaid && "opacity-45"
                            )}
                          >
                            <div className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isPaid}
                                  disabled={!!pendingKey}
                                  onChange={() => toggleGroupPaid(sub, group)}
                                  className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                                />
                                <button
                                  type="button"
                                  className="flex min-w-0 items-center gap-2 text-left"
                                  onClick={() => perClean && setExpandedAccount(isAccountExpanded ? null : key)}
                                >
                                  <span className="truncate text-sm font-semibold text-gray-950">{accountName(group)}</span>
                                  <span className="shrink-0 text-xs text-gray-400">
                                    {perClean ? `Per clean · ${group.jobs.length} clean${group.jobs.length === 1 ? "" : "s"}` : "Flat monthly"}
                                  </span>
                                  {perClean && <ChevronDown className={cn("h-3 w-3 text-gray-400 transition-transform", isAccountExpanded && "rotate-180")} />}
                                </button>
                              </div>
                              <span className={cn("shrink-0 font-mono text-sm font-semibold", isPaid && "text-gray-400 line-through")}>
                                {isBusy ? <ActionSpinner size={14} /> : formatCurrency(group.totalAmount)}
                              </span>
                            </div>

                            {perClean && isAccountExpanded && (
                              <div className="border-t border-gray-100">
                                {group.jobs.map((job, jobIndex) => {
                                  const jobKey = `${sub.id}:${job.id}`
                                  const paidJob = job.subcontractorPaid
                                  return (
                                    <div
                                      key={job.id}
                                      className={cn(
                                        "flex items-center justify-between gap-3 px-5 py-1.5",
                                        jobIndex < group.jobs.length - 1 && "border-b border-gray-100",
                                        paidJob && "opacity-45"
                                      )}
                                    >
                                      <label className="flex min-w-0 items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={paidJob}
                                          disabled={!!pendingKey}
                                          onChange={() => toggleJobPaid(sub, job)}
                                          className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                                        />
                                        <span className={cn("truncate text-xs text-gray-600", paidJob && "line-through")}>
                                          {cleanDateLabel(job)}
                                        </span>
                                      </label>
                                      <span className={cn("font-mono text-xs text-gray-600", paidJob && "line-through")}>
                                        {pendingKey === jobKey ? <ActionSpinner size={12} /> : formatCurrency(jobTotal(job))}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      <div className="mt-2 flex items-center justify-between">
                        <Link href={`/subcontractors/${sub.id}`} className="text-xs font-medium text-teal-700 hover:underline">
                          View profile →
                        </Link>
                        <div className="flex items-center gap-3">
                          <button className="text-xs font-medium text-gray-500 hover:text-teal-700" onClick={() => openEditCleaner(sub)}>
                            Edit
                          </button>
                          <button className="text-xs font-medium text-orange-700 hover:text-orange-800" onClick={() => handleArchiveCleaner(sub)}>
                            Archive
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <div className="flex items-center justify-between border-t-2 border-gray-950 bg-gray-50 px-4 py-3">
              <span className="text-sm font-semibold">Total unpaid</span>
              <span className={cn("font-mono text-lg font-bold", totalUnpaid > 0 ? "text-red-600" : "text-emerald-600")}>
                {formatCurrency(totalUnpaid)}
              </span>
            </div>
          </div>
        )}

        {archivedSubcontractors.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 px-1">
              <Archive className="h-3.5 w-3.5 text-gray-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Archived</h2>
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
                {archivedSubcontractors.length}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white opacity-70">
              {archivedSubcontractors.map(sub => {
                const hasHistory = (sub.jobs?.length || 0) > 0 || (sub.payments?.length || 0) > 0
                return (
                  <div key={sub.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: getCleanerColorInfo(sub.name).hex, filter: "grayscale(50%)" }}
                    >
                      {getInitials(sub.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-600">{sub.name}</p>
                      <p className="text-xs text-gray-400">{hasHistory ? "Archived · Has job/payment history" : "Archived · No history"}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 px-3 text-xs"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/subcontractors/${sub.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isActive: true }),
                          })
                          if (!res.ok) throw new Error("Failed to restore")
                          showSuccess(`${sub.name} restored`)
                          onDataChange()
                        } catch {
                          showError("Failed to restore cleaner")
                        }
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                    {!hasHistory && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setConfirmDeleteId(sub.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <Trash2 className="h-5 w-5 text-red-500" />
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
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isDeleting}
              onClick={async () => {
                if (!confirmDeleteId) return
                setIsDeleting(true)
                try {
                  const res = await fetch(`/api/subcontractors/${confirmDeleteId}`, { method: "DELETE" })
                  if (res.status === 409) {
                    showError("Cannot delete: this cleaner has job/payment history. Use Archive instead.")
                    setConfirmDeleteId(null)
                    return
                  }
                  if (!res.ok) throw new Error("Failed to delete")
                  showSuccess("Cleaner permanently deleted")
                  setConfirmDeleteId(null)
                  onDataChange()
                } catch {
                  showError("Failed to delete cleaner")
                } finally {
                  setIsDeleting(false)
                }
              }}
            >
              {isDeleting ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCleaner} onOpenChange={(open) => !open && setEditingCleaner(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-lg font-bold text-gray-900">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100">
                <Edit2 className="h-4 w-4 text-teal-700" />
              </div>
              Edit Cleaner
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-medium text-gray-500">Name *</Label>
              <Input
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                placeholder="Cleaner name"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-gray-500">Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                  placeholder="(555) 123-4567"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-gray-500">Email</Label>
                <Input
                  value={editForm.email}
                  onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                  placeholder="cleaner@email.com"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-500">Notes</Label>
              <Input
                value={editForm.notes}
                onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
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
              className="flex-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              {isSavingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
