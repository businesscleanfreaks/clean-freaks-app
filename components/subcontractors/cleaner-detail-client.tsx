"use client"

import { useMemo, useState } from "react"
import useSWR, { mutate as globalMutate } from "swr"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { ActionSpinner } from "@/components/ui/action-spinner"
import { buildSubcontractorPayLedger, type PayLedgerGroup } from "@/lib/payout-calculator"
import { cn, formatCurrency } from "@/lib/utils"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { showError, showSuccess } from "@/lib/toast"
import type { CleanerData, CleanerJob } from "@/types"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error("Failed to fetch")
  return res.json()
})

function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <SkeletonPulse className="mb-6 h-5 w-24" />
        <SkeletonPulse className="mb-4 h-24 w-full" rounded="xl" />
        <SkeletonPulse className="h-96 w-full" rounded="xl" />
      </div>
    </div>
  )
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

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number)
  return format(new Date(year, month - 1, 1), "MMMM yyyy")
}

function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
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

function cleanDateLabel(job: CleanerJob) {
  return format(new Date(job.date), "EEE, MMM d")
}

function jobTotal(job: CleanerJob) {
  return (job.subcontractorRate || 0) + (job.addOnServices || []).reduce((sum, addOn) => sum + (addOn.subcontractorRate || 0), 0)
}

interface CleanerDetailClientProps {
  id: string
}

export function CleanerDetailClient({ id }: CleanerDetailClientProps) {
  const router = useRouter()
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [editingContact, setEditingContact] = useState(false)
  const [contactForm, setContactForm] = useState({ phone: "", email: "" })
  const [savingContact, setSavingContact] = useState(false)

  const { data: sub, error, isLoading, mutate } = useSWR<CleanerData>(
    `/api/subcontractors/${id}?period=${period}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  )

  const { groups, total, unpaid, paid } = useMemo(() => {
    const payGroups = buildSubcontractorPayLedger(sub?.periodJobs || []).groups
    return {
      groups: payGroups,
      total: payGroups.reduce((sum, group) => sum + group.totalAmount, 0),
      unpaid: payGroups.reduce((sum, group) => sum + group.owedAmount, 0),
      paid: payGroups.reduce((sum, group) => sum + group.totalAmount, 0) - payGroups.reduce((sum, group) => sum + group.owedAmount, 0),
    }
  }, [sub?.periodJobs])

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups
    const query = searchQuery.toLowerCase()
    return groups.filter(group => accountName(group).toLowerCase().includes(query))
  }, [groups, searchQuery])

  const refreshAfterPaymentChange = () => {
    mutate()
    globalMutate(`/api/subcontractors/data?period=${period}`)
    globalMutate("/api/dashboard-stats")
  }

  const markJobsPaid = async (jobIds: string[], key: string) => {
    if (!sub || jobIds.length === 0) return
    setPendingKey(key)
    try {
      const response = await fetch(`/api/subcontractors/${sub.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds,
          datePaid: format(new Date(), "yyyy-MM-dd"),
          notes: null,
        }),
      })
      if (!response.ok) throw new Error((await response.json()).error || "Failed to mark paid")
      showSuccess("Payment tracked")
      refreshAfterPaymentChange()
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
      await Promise.all(jobIds.map(async (jobId) => {
        const response = await fetch(`/api/jobs/${jobId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subcontractorPaid: false }),
        })
        if (!response.ok) throw new Error("Failed to unmark paid")
      }))
      showSuccess("Payment unchecked")
      refreshAfterPaymentChange()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to unmark paid")
    } finally {
      setPendingKey(null)
    }
  }

  const toggleGroupPaid = (group: PayLedgerGroup) => {
    const key = `group:${group.clientId}`
    const paidJobIds = group.jobs.filter(job => job.subcontractorPaid).map(job => job.id)
    const unpaidJobIds = group.jobs.filter(job => !job.subcontractorPaid).map(job => job.id)
    if (group.unpaidCount > 0) {
      markJobsPaid(unpaidJobIds, key)
    } else {
      unmarkJobsPaid(paidJobIds, key)
    }
  }

  const toggleJobPaid = (job: CleanerJob) => {
    const key = `job:${job.id}`
    if (job.subcontractorPaid) {
      unmarkJobsPaid([job.id], key)
    } else {
      markJobsPaid([job.id], key)
    }
  }

  const saveContact = async () => {
    if (!sub) return
    setSavingContact(true)
    try {
      const response = await fetch(`/api/subcontractors/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: contactForm.phone || null,
          email: contactForm.email || null,
        }),
      })
      if (!response.ok) throw new Error("Failed to save contact")
      showSuccess("Contact updated")
      setEditingContact(false)
      mutate()
      globalMutate(`/api/subcontractors/data?period=${period}`)
    } catch {
      showError("Failed to update contact")
    } finally {
      setSavingContact(false)
    }
  }

  const toggleArchive = async () => {
    if (!sub) return
    const isArchiving = sub.isActive !== false
    if (!confirm(`${isArchiving ? "Archive" : "Restore"} ${sub.name}?`)) return
    try {
      const response = await fetch(`/api/subcontractors/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isArchiving }),
      })
      if (!response.ok) throw new Error("Failed to update")
      showSuccess(isArchiving ? "Cleaner archived" : "Cleaner restored")
      mutate()
      globalMutate(`/api/subcontractors/data?period=${period}`)
    } catch {
      showError("Failed to update cleaner")
    }
  }

  if (isLoading) return <DetailSkeleton />

  if (error || !sub) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="mb-2 text-red-600">Failed to load cleaner</p>
          <button onClick={() => router.back()} className="text-teal-600 hover:underline">
            Go back
          </button>
        </div>
      </div>
    )
  }

  const { hex } = getCleanerColorInfo(sub.name)
  const initials = getInitials(sub.name)
  const lastPayment = sub.payments?.[0]

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => router.push("/subcontractors")}
            className="flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Cleaners
          </button>
          <button
            onClick={toggleArchive}
            className={cn("flex items-center gap-1.5 text-sm font-medium", sub.isActive === false ? "text-teal-700" : "text-red-500")}
          >
            <Archive className="h-4 w-4" />
            {sub.isActive === false ? "Restore Cleaner" : "Archive Cleaner"}
          </button>
        </div>

        <header className="mb-3 border-b-2 border-gray-950 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                style={{ backgroundColor: hex }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-bold tracking-tight">{sub.name}</h1>
                  {sendsInvoices(sub.name) && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      Sends invoices
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  {groups.length} account{groups.length === 1 ? "" : "s"}
                  {lastPayment ? ` · Last paid ${format(new Date(lastPayment.datePaid), "MMM d, yyyy")}` : " · Never paid"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unpaid</div>
              <div className={cn("font-mono text-2xl font-bold tracking-tight", unpaid > 0 ? "text-red-600" : "text-emerald-600")}>
                {formatCurrency(unpaid)}
              </div>
              <div className="text-xs text-gray-500">of {formatCurrency(total)} total</div>
            </div>
          </div>
        </header>

        {editingContact ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-200 py-2">
            <Input
              value={contactForm.phone}
              onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })}
              placeholder="Phone"
              className="h-9 w-44"
            />
            <Input
              value={contactForm.email}
              onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveContact()
                if (event.key === "Escape") setEditingContact(false)
              }}
              placeholder="Email"
              className="h-9 min-w-56 flex-1"
            />
            <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700" onClick={saveContact} disabled={savingContact}>
              {savingContact ? "Saving..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingContact(false)
                setContactForm({ phone: sub.phone || "", email: sub.email || "" })
              }}
              disabled={savingContact}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            className="mb-4 flex w-full flex-wrap items-center gap-3 rounded-md border-b border-gray-200 py-2 text-left text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => {
              setContactForm({ phone: sub.phone || "", email: sub.email || "" })
              setEditingContact(true)
            }}
          >
            {sub.phone && <span>{sub.phone}</span>}
            {sub.email && <span>{sub.email}</span>}
            {!sub.phone && !sub.email && <span className="italic text-gray-400">Add contact info</span>}
            <span className="text-xs font-medium text-teal-700">Edit</span>
          </button>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight">Pay Ledger · {periodLabel(period)}</h2>
            <p className="text-xs text-gray-500">
              {formatCurrency(paid)} paid · {formatCurrency(unpaid)} unpaid
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-md border border-gray-200 bg-white">
              <button className="border-r border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50" onClick={() => setPeriod(shiftPeriod(period, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="flex min-w-[140px] items-center justify-center gap-2 px-4 py-2 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-teal-700" />
                {periodLabel(period)}
              </span>
              <button className="border-l border-gray-200 px-3 py-2 text-gray-500 hover:bg-gray-50" onClick={() => setPeriod(shiftPeriod(period, 1))}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search accounts..."
                className="h-10 bg-white pl-9"
              />
            </div>
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {filteredGroups.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              No jobs match this period.
            </div>
          ) : filteredGroups.map((group, index) => {
            const isPaid = group.unpaidCount === 0
            const isPerClean = group.payType === "PER_CLEAN"
            const isExpanded = expandedAccount === group.clientId
            const groupKey = `group:${group.clientId}`
            return (
              <div key={group.clientId} className={cn(index < filteredGroups.length - 1 && "border-b border-gray-100", isPaid && "opacity-45")}>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isPaid}
                      disabled={!!pendingKey}
                      onChange={() => toggleGroupPaid(group)}
                      className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                    />
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 text-left"
                      onClick={() => isPerClean && setExpandedAccount(isExpanded ? null : group.clientId)}
                    >
                      <span className="truncate text-sm font-semibold text-gray-950">{accountName(group)}</span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {isPerClean ? `Per clean · ${group.jobs.length} clean${group.jobs.length === 1 ? "" : "s"}` : "Flat monthly"}
                      </span>
                      {isPerClean && <ChevronDown className={cn("h-3 w-3 text-gray-400 transition-transform", isExpanded && "rotate-180")} />}
                    </button>
                  </div>
                  <span className={cn("font-mono text-sm font-semibold", isPaid && "text-gray-400 line-through")}>
                    {pendingKey === groupKey ? <ActionSpinner size={14} /> : formatCurrency(group.totalAmount)}
                  </span>
                </div>

                {isPerClean && isExpanded && (
                  <div className="border-t border-gray-100">
                    {group.jobs.map((job, jobIndex) => {
                      const jobKey = `job:${job.id}`
                      return (
                        <div
                          key={job.id}
                          className={cn(
                            "flex items-center justify-between gap-3 px-8 py-1.5",
                            jobIndex < group.jobs.length - 1 && "border-b border-gray-100",
                            job.subcontractorPaid && "opacity-45"
                          )}
                        >
                          <label className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={job.subcontractorPaid}
                              disabled={!!pendingKey}
                              onChange={() => toggleJobPaid(job)}
                              className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                            />
                            <span className={cn("truncate text-xs text-gray-600", job.subcontractorPaid && "line-through")}>
                              {cleanDateLabel(job)}
                            </span>
                          </label>
                          <span className={cn("font-mono text-xs text-gray-600", job.subcontractorPaid && "line-through")}>
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

          <div className="flex items-center justify-between border-t-2 border-gray-950 bg-gray-50 px-4 py-3">
            <span className="text-sm font-semibold">Unpaid</span>
            <span className={cn("font-mono text-lg font-bold", unpaid > 0 ? "text-red-600" : "text-emerald-600")}>
              {formatCurrency(unpaid)}
            </span>
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-bold tracking-tight">Payment History</h2>
          {!sub.payments || sub.payments.length === 0 ? (
            <p className="text-sm italic text-gray-400">No payment history yet</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              {sub.payments.map((payment, index) => (
                <div key={payment.id} className={cn("flex items-center justify-between px-4 py-2.5", index < (sub.payments?.length || 0) - 1 && "border-b border-gray-100")}>
                  <div>
                    <p className="text-sm font-medium text-gray-950">{format(new Date(payment.datePaid), "MMM d, yyyy")}</p>
                    <p className="text-xs text-gray-500">
                      {payment.lineItems?.length || 0} item{payment.lineItems?.length === 1 ? "" : "s"}
                      {payment.notes ? ` · ${payment.notes}` : ""}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold">{formatCurrency(payment.totalAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
