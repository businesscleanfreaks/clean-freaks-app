"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/utils"
import { Plus, Search, Package, Phone, Mail, ChevronDown, DollarSign, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { showError, showSuccess } from "@/lib/toast"
import { SkeletonPulse } from "@/components/ui/skeleton-pulse"
import { format } from "date-fns"

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error("Failed to fetch")
  return res.json()
})

interface VendorData {
  id: string
  name: string
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
  addOnServices: Array<{
    id: string
    description: string
    subcontractorRate: number
  }>
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [payingVendor, setPayingVendor] = useState<VendorData | null>(null)
  const [payingSaving, setPayingSaving] = useState(false)

  const filtered = useMemo(() => {
    if (!vendors) return []
    if (!searchQuery.trim()) return vendors
    const q = searchQuery.toLowerCase()
    return vendors.filter(v => v.name.toLowerCase().includes(q))
  }, [vendors, searchQuery])

  const totalOwed = useMemo(() => {
    return (vendors || []).reduce((sum, v) => sum + v.owedAmount, 0)
  }, [vendors])

  const handleAddVendor = async () => {
    if (!addForm.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to create vendor")
      }
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

  const handlePayVendor = async (vendor: VendorData) => {
    if (!vendor.addOnServices.length) return
    setPayingSaving(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addOnServiceIds: vendor.addOnServices.map(a => a.id),
          datePaid: format(new Date(), "yyyy-MM-dd"),
        }),
      })
      if (!res.ok) throw new Error("Failed to record payment")
      showSuccess(`Paid ${formatCurrency(vendor.owedAmount)} to ${vendor.name}`)
      setPayingVendor(null)
      mutate()
    } catch {
      showError("Failed to record payment")
    } finally {
      setPayingSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <SkeletonPulse className="h-10 w-48" rounded="lg" />
        <SkeletonPulse className="h-20 w-full" rounded="xl" />
        <SkeletonPulse className="h-64 w-full" rounded="xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600 font-medium">Failed to load vendors</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500">
            {vendors?.length || 0} vendor{(vendors?.length || 0) !== 1 ? "s" : ""}
            {totalOwed > 0 && (
              <> · <span className="text-amber-600 font-medium">{formatCurrency(totalOwed)} owed</span></>
            )}
          </p>
        </div>
        <Button
          onClick={() => setAddDialogOpen(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white h-9 px-4 text-sm rounded-lg"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Vendor
        </Button>
      </div>

      {/* Search */}
      {(vendors?.length || 0) > 3 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vendors..."
            className="w-full h-10 pl-9 pr-4 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      )}

      {/* Vendor List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">{searchQuery ? "No matching vendors" : "No vendors yet"}</p>
          {!searchQuery && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              className="mt-3 text-teal-600 border-teal-200 hover:bg-teal-50"
            >
              Add your first vendor
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {filtered.map(vendor => (
            <div key={vendor.id}>
              {/* Row */}
              <div
                className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${expandedId === vendor.id ? "bg-teal-50/40" : "hover:bg-gray-50"}`}
                onClick={() => setExpandedId(expandedId === vendor.id ? null : vendor.id)}
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-semibold text-sm flex-shrink-0">
                  {vendor.name.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 truncate text-[15px]">{vendor.name}</span>
                  </div>
                  <p className="text-sm text-gray-400 truncate">
                    {vendor.unpaidAddOns > 0
                      ? `${vendor.unpaidAddOns} unpaid add-on${vendor.unpaidAddOns !== 1 ? "s" : ""}`
                      : "All paid up"}
                    {vendor.lastPayment && ` · Last paid ${format(new Date(vendor.lastPayment.datePaid), "MMM d")}`}
                  </p>
                </div>

                {vendor.owedAmount > 0 ? (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-bold text-gray-900 text-[15px] tabular-nums">
                      {formatCurrency(vendor.owedAmount)}
                    </span>
                    <Button
                      size="sm"
                      className="bg-teal-600 hover:bg-teal-700 text-white h-8 px-4 text-sm font-medium rounded-lg"
                      onClick={(e) => { e.stopPropagation(); setPayingVendor(vendor) }}
                    >
                      Pay
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-teal-600 flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">$0</span>
                  </div>
                )}

                <ChevronDown
                  className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${expandedId === vendor.id ? "rotate-180" : ""}`}
                />
              </div>

              {/* Expanded Detail */}
              {expandedId === vendor.id && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                  <div className="space-y-3">
                    {vendor.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="w-3.5 h-3.5 text-gray-400" />
                        <a href={`tel:${vendor.phone}`} className="hover:text-teal-600">{vendor.phone}</a>
                      </div>
                    )}
                    {vendor.email && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="w-3.5 h-3.5 text-gray-400" />
                        <a href={`mailto:${vendor.email}`} className="hover:text-teal-600">{vendor.email}</a>
                      </div>
                    )}
                    {vendor.unpaidAddOns > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-2">Unpaid Add-Ons</p>
                        <div className="space-y-1">
                          {vendor.addOnServices.map(addon => (
                            <div key={addon.id} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">{addon.description}</span>
                              <span className="font-medium text-gray-900 tabular-nums">{formatCurrency(addon.subcontractorRate)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!vendor.phone && !vendor.email && vendor.unpaidAddOns === 0 && (
                      <p className="text-sm text-gray-400">No details to show</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Vendor Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                <Package className="w-4 h-4 text-purple-700" />
              </div>
              Add Vendor
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-gray-500 font-medium">Vendor Name *</Label>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="e.g., Quick Clean"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500 font-medium">Phone</Label>
                <Input
                  value={addForm.phone}
                  onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500 font-medium">Email</Label>
                <Input
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  placeholder="vendor@email.com"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
              disabled={saving}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddVendor}
              disabled={saving || !addForm.name.trim()}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {saving ? "Adding..." : "Add Vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Vendor Dialog */}
      <Dialog open={!!payingVendor} onOpenChange={(open) => !open && setPayingVendor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-teal-700" />
              </div>
              Pay {payingVendor?.name}
            </DialogTitle>
          </DialogHeader>

          {payingVendor && (
            <div className="py-2">
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-gray-500 mb-1">Total to Pay</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(payingVendor.owedAmount)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {payingVendor.unpaidAddOns} add-on service{payingVendor.unpaidAddOns !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="space-y-1 mb-4">
                {payingVendor.addOnServices.map(addon => (
                  <div key={addon.id} className="flex items-center justify-between text-sm py-1">
                    <span className="text-gray-700">{addon.description}</span>
                    <span className="font-medium text-gray-900 tabular-nums">{formatCurrency(addon.subcontractorRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPayingVendor(null)}
              disabled={payingSaving}
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={() => payingVendor && handlePayVendor(payingVendor)}
              disabled={payingSaving}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
            >
              {payingSaving ? "Processing..." : `Pay ${payingVendor ? formatCurrency(payingVendor.owedAmount) : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
