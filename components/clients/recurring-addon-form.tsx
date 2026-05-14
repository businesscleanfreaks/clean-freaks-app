"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { showError, showSuccess } from "@/lib/toast"
import { logger } from "@/lib/logger"

interface RecurringAddonFormProps {
  scheduleId: string
  /** Other active schedule IDs on the same client — used for optional bulk apply */
  siblingScheduleIds?: string[]
  onSuccess: () => void
  onCancel: () => void
}

const FREQUENCY_OPTIONS = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BI_WEEKLY', label: 'Every 2 Weeks' },
  { value: 'EVERY_3_WEEKS', label: 'Every 3 Weeks' },
  { value: 'EVERY_4_WEEKS', label: 'Every 4 Weeks' },
  { value: 'EVERY_6_WEEKS', label: 'Every 6 Weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
]

export function RecurringAddonForm({ scheduleId, siblingScheduleIds = [], onSuccess, onCancel }: RecurringAddonFormProps) {
  const [loading, setLoading] = useState(false)
  const [applyToAllSchedules, setApplyToAllSchedules] = useState(false)
  const [formData, setFormData] = useState({
    description: '',
    clientRate: '',
    subcontractorRate: '',
    frequency: 'MONTHLY',
    vendorId: '',
  })
  const [newVendorName, setNewVendorName] = useState('')
  const [showNewVendor, setShowNewVendor] = useState(false)

  const fetcher = (url: string) => fetch(url).then(r => r.json())
  const { data: vendors, mutate: mutateVendors } = useSWR<Array<{ id: string; name: string; isActive?: boolean }>>('/api/vendors', fetcher)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // If creating a new vendor inline, create it first
      let vendorId = formData.vendorId || null
      if (showNewVendor && newVendorName.trim()) {
        const vRes = await fetch('/api/vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newVendorName.trim() }),
        })
        if (vRes.ok) {
          const vendor = await vRes.json()
          vendorId = vendor.id
          mutateVendors()
        }
      }

      const targets = applyToAllSchedules && siblingScheduleIds.length > 0
        ? [scheduleId, ...siblingScheduleIds]
        : [scheduleId]

      for (const sid of targets) {
        const response = await fetch('/api/add-on-services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleId: sid,
            description: formData.description,
            clientRate: parseFloat(formData.clientRate) || 0,
            subcontractorRate: parseFloat(formData.subcontractorRate) || 0,
            frequency: formData.frequency,
            isRecurring: true,
            vendorId,
          }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to create add-on')
        }
      }

      showSuccess(
        targets.length > 1
          ? `Recurring add-on added to ${targets.length} schedules`
          : 'Recurring add-on created successfully'
      )
      onSuccess()
    } catch (error) {
      logger.error('Error creating add-on:', error)
      showError(error instanceof Error ? error.message : 'Failed to create add-on')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
      <h4 className="font-semibold text-purple-800">Add Recurring Add-On Service</h4>
      
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description">Service Description *</Label>
          <Input
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="e.g., Window Cleaning, Deep Clean Fridge"
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="frequency">Frequency *</Label>
          <Select
            value={formData.frequency}
            onValueChange={(value) => setFormData({ ...formData, frequency: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="clientRate">Client Rate ($) *</Label>
          <Input
            id="clientRate"
            type="number"
            step="0.01"
            min="0"
            value={formData.clientRate}
            onChange={(e) => setFormData({ ...formData, clientRate: e.target.value })}
            placeholder="0.00"
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="subcontractorRate">Subcontractor Rate ($) *</Label>
          <Input
            id="subcontractorRate"
            type="number"
            step="0.01"
            min="0"
            value={formData.subcontractorRate}
            onChange={(e) => setFormData({ ...formData, subcontractorRate: e.target.value })}
            placeholder="0.00"
            required
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Outsourced Vendor <span className="text-gray-400 font-normal">(optional)</span></Label>
          {showNewVendor ? (
            <div className="flex gap-2">
              <Input
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="New vendor name"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setShowNewVendor(false); setNewVendorName('') }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <select
              value={formData.vendorId}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  setShowNewVendor(true)
                  setFormData({ ...formData, vendorId: '' })
                } else {
                  setFormData({ ...formData, vendorId: e.target.value })
                }
              }}
              className="w-full h-10 px-3 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">None (in-house)</option>
              {(vendors || []).filter(v => v.isActive !== false).map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
              <option value="__new__">+ Add new vendor...</option>
            </select>
          )}
          <p className="text-xs text-gray-400">If this add-on is performed by an external subcontractor</p>
        </div>
      </div>

      {siblingScheduleIds.length > 0 && (
        <label className="flex items-start gap-3 rounded-lg border border-purple-100 bg-white/80 px-3 py-3 cursor-pointer md:col-span-2">
          <Checkbox
            checked={applyToAllSchedules}
            onCheckedChange={(checked) => setApplyToAllSchedules(checked === true)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">Add to every recurring schedule for this client</p>
            <p className="text-xs text-gray-500">
              Also creates the same add-on on {siblingScheduleIds.length} other active schedule
              {siblingScheduleIds.length !== 1 ? 's' : ''} (same rates and frequency).
            </p>
          </div>
        </label>
      )}
      
      <div className="flex gap-2">
        <Button type="submit" disabled={loading} className="bg-purple-600 hover:bg-purple-700">
          {loading ? 'Adding...' : 'Add Recurring Add-On'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}



