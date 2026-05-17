"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { format } from "date-fns"
import {
  Archive,
  ChevronDown,
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
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { cn, formatCurrency } from "@/lib/utils"
import { showError, showSuccess } from "@/lib/toast"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error("Failed to fetch")
  return res.json()
})

interface VendorAddOn {
  id: string
  description: string
  subcontractorRate: number
  vendorPaid: boolean
  createdAt: string
  paidDate?: string | null
  job: {
    id: string
    date: string
    status: string
    location: {
      client: {
        id: string
        name: string
      }
    }
  } | null
  schedule: {
    id: string
    location: {
      client: {
        id: string
        name: string
      }
    }
  } | null
}

interface VendorData {
  id: string
  name: string
  isActive: boolean
  phone: string | null
  email: string | null
  notes: string | null
  owedAmount: number
  unpaidAddOns: number
  lastPayment: {
    id: string
    datePaid: string
    totalAmount: number
  } | null
  payments: Array<{
    id: string
    datePaid: string
    totalAmount: number
    lineItems?: Array<{ id: string }>
  }>
  addOnServices: VendorAddOn[]
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

function addOnClientName(addOn: VendorAddOn) {
  return addOn.job?.location?.client?.name || addOn.schedule?.location?.client?.name || "Unassigned"
}

function addOnDateLabel(addOn: VendorAddOn) {
  if (addOn.job?.date) return format(new Date(addOn.job.date), "EEE, MMM d")
  return addOn.schedule ? "Recurring add-on" : format(new Date(addOn.createdAt), "MMM d")
}

function vendorTotals(vendor: VendorData) {
  const total = vendor.addOnServices.reduce((sum, addOn) => sum + addOn.subcontractorRate, 0)
  const unpaid = vendor.addOnServices
    .filter(addOn => !addOn.vendorPaid)
    .reduce((sum, addOn) => sum + addOn.subcontractorRate, 0)
  return { total, unpaid, paid: Math.max(0, total - unpaid) }
}

export function VendorsPageClient() {
  const { data: vendors, error, isLoading, mutate } = useSWR<VendorData[]>(
    "/api/vendors",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 }
  )

  const [searchQuery, setSearchQuery] = useState("")
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addForm, setAddForm] = useState({ name: "", phone: "", email: "" })
  const [saving, setSaving] = useState(false)
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [confirmDeleteVendorId, setConfirmDeleteVendorId] = useState<string | null>(null)
  const [isDeletingVendor, setIsDeletingVendor] = useState(false)
  const [editingVendor, setEditingVendor] = useState<VendorData | null>(null)
  const [vendorEditForm, setVendorEditForm] = useState({ name: "", phone: "", email: "", notes: "" })
  const [isSavingVendorEdit, setIsSavingVendorEdit] = useState(false)
  const [historyVendorId, setHistoryVendorId] = useState<string | null>(null)

  const activeVendors = useMemo(() => (vendors || []).filter(v => v.isActive !== false), [vendors])
  const archivedVendors = useMemo(() => (vendors || []).filter(v => v.isActive === false), [vendors])

  const rows = useMemo(() => {
    return activeVendors
      .map(vendor => ({ vendor, ...vendorTotals(vendor) }))
      .filter(row => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        return row.vendor.name.toLowerCase().includes(query)
          || row.vendor.email?.toLowerCase().includes(query)
          || row.vendor.phone?.toLowerCase().includes(query)
          || row.vendor.addOnServices.some(addOn =>
            addOn.description.toLowerCase().includes(query)
            || addOnClientName(addOn).toLowerCase().includes(query)
          )
      })
      .sort((a, b) => b.unpaid - a.unpaid || a.vendor.name.localeCompare(b.vendor.name))
  }, [activeVendors, searchQuery])

  const totalUnpaid = rows.reduce((sum, row) => sum + row.unpaid, 0)

  const refreshAfterPaymentChange = () => mutate()

  const toggleAddOnsPaid = async (vendor: VendorData, addOnIds: string[], paid: boolean, key: string) => {
    if (addOnIds.length === 0) return
    setPendingKey(key)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/payments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addOnServiceIds: addOnIds, vendorPaid: paid }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update vendor payment")
      showSuccess(paid ? "Payment tracked" : "Payment unchecked")
      refreshAfterPaymentChange()
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update vendor payment")
    } finally {
      setPendingKey(null)
    }
  }

  const toggleVendorPaid = (vendor: VendorData) => {
    const unpaidIds = vendor.addOnServices.filter(addOn => !addOn.vendorPaid).map(addOn => addOn.id)
    const paidIds = vendor.addOnServices.filter(addOn => addOn.vendorPaid).map(addOn => addOn.id)
    if (unpaidIds.length > 0) {
      toggleAddOnsPaid(vendor, unpaidIds, true, `${vendor.id}:all`)
    } else {
      toggleAddOnsPaid(vendor, paidIds, false, `${vendor.id}:all`)
    }
  }

  const toggleAddOnPaid = (vendor: VendorData, addOn: VendorAddOn) => {
    toggleAddOnsPaid(vendor, [addOn.id], !addOn.vendorPaid, `${vendor.id}:${addOn.id}`)
  }

  const openEditVendor = (vendor: VendorData) => {
    setVendorEditForm({
      name: vendor.name || "",
      phone: vendor.phone || "",
      email: vendor.email || "",
      notes: vendor.notes || "",
    })
    setEditingVendor(vendor)
  }

  const handleSaveVendorEdit = async () => {
    if (!editingVendor || !vendorEditForm.name.trim()) return
    setIsSavingVendorEdit(true)
    try {
      const res = await fetch(`/api/vendors/${editingVendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vendorEditForm),
      })
      if (!res.ok) throw new Error("Failed to update")
      showSuccess(`${vendorEditForm.name} updated`)
      setEditingVendor(null)
      mutate()
    } catch {
      showError("Failed to update vendor")
    } finally {
      setIsSavingVendorEdit(false)
    }
  }

  const handleAddVendor = async () => {
    if (!addForm.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create vendor")
      showSuccess("Vendor added")
      setAddDialogOpen(false)
      setAddForm({ name: "", phone: "", email: "" })
      mutate()
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add vendor")
    } finally {
      setSaving(false)
    }
  }

  const handleToggleArchive = async (vendor: VendorData) => {
    const isArchiving = vendor.isActive
    if (!confirm(isArchiving ? `Archive ${vendor.name}? They will be hidden from the active list but all history will be preserved.` : `Restore ${vendor.name}?`)) return
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isArchiving }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      showSuccess(isArchiving ? "Vendor archived" : "Vendor restored")
      mutate()
    } catch {
      showError("Failed to update vendor status")
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <SkeletonPulse className="mb-4 h-16 w-full" rounded="lg" />
        <SkeletonPulse className="h-80 w-full" rounded="xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-600">Failed to load vendors</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4 border-b-2 border-gray-950 pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
              <p className="text-sm text-gray-500">Manual tracking for outsourced add-on payments</p>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unpaid</div>
              <div className={cn("font-mono text-2xl font-bold tracking-tight", totalUnpaid > 0 ? "text-red-600" : "text-emerald-600")}>
                {formatCurrency(totalUnpaid)}
              </div>
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search vendors or add-ons..."
              className="h-10 rounded-md bg-white pl-9"
            />
          </div>
          <Button variant="outline" className="h-10 gap-2 rounded-md" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Vendor
          </Button>
        </div>

        {activeVendors.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <p className="text-sm text-gray-500">No vendors yet</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              className="mt-3 border-teal-200 text-teal-700 hover:bg-teal-50"
            >
              Add your first vendor
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-950 px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Vendor</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Owed</span>
            </div>

            {rows.map(({ vendor, total, unpaid, paid }, rowIndex) => {
              const isExpanded = expandedVendor === vendor.id
              const allPaid = vendor.addOnServices.length > 0 && vendor.addOnServices.every(addOn => addOn.vendorPaid)
              const isBusy = pendingKey === `${vendor.id}:all`
              const historyOpen = historyVendorId === vendor.id

              return (
                <div key={vendor.id} className={cn(rowIndex < rows.length - 1 && "border-b border-gray-100")}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-gray-50",
                      isExpanded && "bg-gray-50"
                    )}
                    onClick={() => setExpandedVendor(isExpanded ? null : vendor.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setExpandedVendor(isExpanded ? null : vendor.id)
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                        {getInitials(vendor.name) || vendor.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-gray-950">{vendor.name}</span>
                          <ChevronDown className={cn("h-3 w-3 text-gray-400 transition-transform", isExpanded && "rotate-180")} />
                        </div>
                        <p className="text-xs text-gray-500">
                          {vendor.addOnServices.length} service{vendor.addOnServices.length === 1 ? "" : "s"} · {unpaid === 0 ? "Paid up" : `${formatCurrency(paid)} of ${formatCurrency(total)} paid`}
                          {vendor.lastPayment && ` · Last paid ${format(new Date(vendor.lastPayment.datePaid), "MMM d")}`}
                        </p>
                      </div>
                    </div>
                    <div className={cn("font-mono text-base font-bold tracking-tight", unpaid === 0 && "text-emerald-600")}>
                      {isBusy ? <ActionSpinner size={14} /> : unpaid > 0 ? formatCurrency(unpaid) : "✓"}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-gray-50 px-4 pb-3 pl-16">
                      <div className="flex items-center justify-between px-3 pb-1 pt-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Service</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Amount</span>
                      </div>

                      {vendor.addOnServices.length === 0 ? (
                        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                          No linked add-on services yet.
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
                            <label className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={allPaid}
                                disabled={!!pendingKey || vendor.addOnServices.length === 0}
                                onChange={() => toggleVendorPaid(vendor)}
                                className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                              />
                              <span className="text-xs font-semibold text-gray-600">
                                {allPaid ? "All services paid" : "Mark all unpaid services paid"}
                              </span>
                            </label>
                            <span className={cn("font-mono text-xs font-semibold", unpaid === 0 ? "text-emerald-600" : "text-gray-700")}>
                              {formatCurrency(unpaid)}
                            </span>
                          </div>

                          {vendor.addOnServices.map((addOn, addOnIndex) => {
                            const addOnKey = `${vendor.id}:${addOn.id}`
                            const isAddOnBusy = pendingKey === addOnKey
                            return (
                              <div
                                key={addOn.id}
                                className={cn(
                                  "flex items-center justify-between gap-3 px-3 py-2 transition-opacity",
                                  addOnIndex < vendor.addOnServices.length - 1 && "border-b border-gray-100",
                                  addOn.vendorPaid && "opacity-45"
                                )}
                              >
                                <label className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={addOn.vendorPaid}
                                    disabled={!!pendingKey}
                                    onChange={() => toggleAddOnPaid(vendor, addOn)}
                                    className="h-4 w-4 rounded border-gray-300 accent-gray-950"
                                  />
                                  <span className="min-w-0">
                                    <span className={cn("block truncate text-sm font-semibold text-gray-950", addOn.vendorPaid && "line-through")}>
                                      {addOnClientName(addOn)}
                                    </span>
                                    <span className={cn("block truncate text-xs text-gray-500", addOn.vendorPaid && "line-through")}>
                                      {addOn.description} · {addOnDateLabel(addOn)}
                                      {addOn.paidDate && ` · Paid ${format(new Date(addOn.paidDate), "MMM d")}`}
                                    </span>
                                  </span>
                                </label>
                                <span className={cn("shrink-0 font-mono text-sm font-semibold", addOn.vendorPaid && "text-gray-400 line-through")}>
                                  {isAddOnBusy ? <ActionSpinner size={12} /> : formatCurrency(addOn.subcontractorRate)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <button
                          className="text-xs font-medium text-teal-700 hover:underline"
                          onClick={() => setHistoryVendorId(historyOpen ? null : vendor.id)}
                        >
                          {historyOpen ? "Hide payment history" : "Payment history"}
                        </button>
                        <div className="flex items-center gap-3">
                          <button className="text-xs font-medium text-gray-500 hover:text-teal-700" onClick={() => openEditVendor(vendor)}>
                            Edit
                          </button>
                          <button className="text-xs font-medium text-orange-700 hover:text-orange-800" onClick={() => handleToggleArchive(vendor)}>
                            Archive
                          </button>
                        </div>
                      </div>

                      {historyOpen && (
                        <div className="mt-2 overflow-hidden rounded-md border border-gray-200 bg-white">
                          {vendor.payments.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-gray-500">No payment history yet.</div>
                          ) : vendor.payments.map((payment, paymentIndex) => (
                            <div
                              key={payment.id}
                              className={cn(
                                "flex items-center justify-between px-3 py-2 text-sm",
                                paymentIndex < vendor.payments.length - 1 && "border-b border-gray-100"
                              )}
                            >
                              <span className="font-medium text-gray-700">{format(new Date(payment.datePaid), "MMM d, yyyy")}</span>
                              <span className="font-mono font-semibold">{formatCurrency(payment.totalAmount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
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

        {archivedVendors.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 px-1">
              <Archive className="h-3.5 w-3.5 text-gray-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Archived</h2>
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
                {archivedVendors.length}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white opacity-70">
              {archivedVendors.map(vendor => {
                const hasHistory = vendor.addOnServices.length > 0 || vendor.payments.length > 0
                return (
                  <div key={vendor.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-300 text-xs font-semibold text-gray-600">
                      {getInitials(vendor.name) || vendor.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-600">{vendor.name}</p>
                      <p className="text-xs text-gray-400">{hasHistory ? "Archived · Has service/payment history" : "Archived · No history"}</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs" onClick={() => handleToggleArchive(vendor)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                    {!hasHistory && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setConfirmDeleteVendorId(vendor.id)}
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

        <Dialog open={!!confirmDeleteVendorId} onOpenChange={(open) => !open && setConfirmDeleteVendorId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <Trash2 className="h-5 w-5 text-red-500" />
                Delete permanently?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600">
              This will permanently remove <strong>{archivedVendors.find(v => v.id === confirmDeleteVendorId)?.name}</strong>. This cannot be undone.
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfirmDeleteVendorId(null)} disabled={isDeletingVendor}>Cancel</Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={isDeletingVendor}
                onClick={async () => {
                  if (!confirmDeleteVendorId) return
                  setIsDeletingVendor(true)
                  try {
                    const res = await fetch(`/api/vendors/${confirmDeleteVendorId}`, { method: "DELETE" })
                    if (res.status === 409) {
                      showError("Cannot delete: this vendor has service/payment history. Use Archive instead.")
                      setConfirmDeleteVendorId(null)
                      return
                    }
                    if (!res.ok) throw new Error("Failed to delete")
                    showSuccess("Vendor permanently deleted")
                    setConfirmDeleteVendorId(null)
                    mutate()
                  } catch {
                    showError("Failed to delete vendor")
                  } finally {
                    setIsDeletingVendor(false)
                  }
                }}
              >
                {isDeletingVendor ? "Deleting..." : "Delete Permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-gray-900">Add Vendor</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-xs font-medium text-gray-500">Vendor Name *</Label>
                <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g., Window vendor" className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-gray-500">Phone</Label>
                  <Input value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} placeholder="(555) 123-4567" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-gray-500">Email</Label>
                  <Input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="vendor@email.com" className="mt-1" />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={saving} className="flex-1 rounded-lg">Cancel</Button>
              <Button onClick={handleAddVendor} disabled={saving || !addForm.name.trim()} className="flex-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                {saving ? "Adding..." : "Add Vendor"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editingVendor} onOpenChange={(open) => !open && setEditingVendor(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <Edit2 className="h-4 w-4 text-teal-700" />
                Edit Vendor
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-xs font-medium text-gray-500">Name *</Label>
                <Input value={vendorEditForm.name} onChange={(e) => setVendorEditForm({ ...vendorEditForm, name: e.target.value })} placeholder="Vendor name" className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-gray-500">Phone</Label>
                  <Input value={vendorEditForm.phone} onChange={(e) => setVendorEditForm({ ...vendorEditForm, phone: e.target.value })} placeholder="(555) 123-4567" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-gray-500">Email</Label>
                  <Input value={vendorEditForm.email} onChange={(e) => setVendorEditForm({ ...vendorEditForm, email: e.target.value })} placeholder="vendor@email.com" className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium text-gray-500">Notes</Label>
                <Input value={vendorEditForm.notes} onChange={(e) => setVendorEditForm({ ...vendorEditForm, notes: e.target.value })} placeholder="Optional notes" className="mt-1" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditingVendor(null)} disabled={isSavingVendorEdit} className="flex-1 rounded-lg">Cancel</Button>
              <Button onClick={handleSaveVendorEdit} disabled={isSavingVendorEdit || !vendorEditForm.name.trim()} className="flex-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                {isSavingVendorEdit ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
