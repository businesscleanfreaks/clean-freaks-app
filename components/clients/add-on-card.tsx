"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/utils"
import { formatFrequency } from "@/lib/frequency-utils"
import { Edit2, Trash2, Check, X, RotateCcw } from "lucide-react"
import { showError, showSuccess } from "@/lib/toast"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"

const FREQUENCY_OPTIONS = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BI_WEEKLY', label: 'Every 2 Weeks' },
  { value: 'EVERY_3_WEEKS', label: 'Every 3 Weeks' },
  { value: 'EVERY_4_WEEKS', label: 'Every 4 Weeks' },
  { value: 'EVERY_6_WEEKS', label: 'Every 6 Weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
]

interface AddOnCardProps {
  addOn: {
    id: string
    description: string
    clientRate: number
    subcontractorRate: number
    frequency?: string | null
    isRecurring: boolean
  }
  onDelete?: () => void
}

export function AddOnCard({ addOn, onDelete }: AddOnCardProps) {
  const router = useRouter()
  const { confirm, ConfirmDialog } = useConfirm()
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({
    description: addOn.description,
    clientRate: addOn.clientRate.toString(),
    subcontractorRate: addOn.subcontractorRate.toString(),
    frequency: addOn.frequency || 'MONTHLY',
  })

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updateData: any = {
        description: formData.description,
        clientRate: parseFloat(formData.clientRate) || 0,
        subcontractorRate: parseFloat(formData.subcontractorRate) || 0,
      }
      
      // Only include frequency if it's a recurring add-on
      if (addOn.isRecurring) {
        updateData.frequency = formData.frequency
      }

      const response = await fetch(`/api/add-on-services/${addOn.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update add-on')
      }

      showSuccess('Add-on updated successfully')
      setIsEditing(false)
      router.refresh()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update add-on')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Add-on?",
      description: `Delete "${addOn.description}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/add-on-services/${addOn.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to delete add-on')
        setIsDeleting(false)
        return
      }

      showSuccess('Add-on deleted successfully')
      if (onDelete) {
        onDelete()
      }
      router.refresh()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete add-on')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      description: addOn.description,
      clientRate: addOn.clientRate.toString(),
      subcontractorRate: addOn.subcontractorRate.toString(),
      frequency: addOn.frequency || 'MONTHLY',
    })
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="bg-white border-2 border-purple-300 rounded-lg p-4 shadow-sm">
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium">
              Description
            </Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g., Window Cleaning"
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="clientRate" className="text-sm font-medium">
                Client Rate ($)
              </Label>
              <Input
                id="clientRate"
                type="number"
                step="0.01"
                min="0"
                value={formData.clientRate}
                onChange={(e) => setFormData({ ...formData, clientRate: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subcontractorRate" className="text-sm font-medium">
                Cleaner Rate ($)
              </Label>
              <Input
                id="subcontractorRate"
                type="number"
                step="0.01"
                min="0"
                value={formData.subcontractorRate}
                onChange={(e) => setFormData({ ...formData, subcontractorRate: e.target.value })}
                className="text-sm"
              />
            </div>
          </div>

          {addOn.isRecurring && (
            <div className="space-y-2">
              <Label htmlFor="frequency" className="text-sm font-medium">
                Frequency
              </Label>
              <Select
                value={formData.frequency}
                onValueChange={(value) => setFormData({ ...formData, frequency: value })}
              >
                <SelectTrigger className="text-sm">
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
          )}

          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !formData.description || !formData.clientRate || !formData.subcontractorRate}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Check className="w-4 h-4 mr-1" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group relative rounded-lg p-3 transition-all ${
        addOn.isRecurring
          ? 'bg-gradient-to-br from-purple-50 to-teal-50 border border-purple-200 hover:border-purple-300'
          : 'bg-gray-50 border border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-stone-800">{addOn.description}</h4>
            {addOn.isRecurring && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                <RotateCcw className="w-3 h-3" />
                Recurring
              </span>
            )}
          </div>
          {addOn.isRecurring && addOn.frequency && (
            <p className="text-xs text-purple-600 font-medium">
              {formatFrequency(addOn.frequency)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-7 w-7 p-0 hover:bg-purple-100"
            title="Edit add-on"
          >
            <Edit2 className="w-3.5 h-3.5 text-purple-600" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={isDeleting}
            className="h-7 w-7 p-0 hover:bg-red-100"
            title="Delete add-on"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </Button>
        </div>
      </div>

      {/* Rates Row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Client:</span>
          <span className="font-semibold text-green-600">
            {formatCurrency(addOn.clientRate)}
          </span>
        </div>
        <div className="w-px h-4 bg-gray-300" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Cleaner:</span>
          <span className="font-semibold text-stone-700">
            {formatCurrency(addOn.subcontractorRate)}
          </span>
        </div>
      </div>

      {/* Always visible edit button on mobile */}
      <div className="flex gap-2 mt-2 sm:hidden">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
          className="flex-1 text-xs"
        >
          <Edit2 className="w-3 h-3 mr-1" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDelete}
          disabled={isDeleting}
          className="flex-1 text-xs text-red-600 hover:text-red-700"
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Delete
        </Button>
      </div>
      <ConfirmDialog />
    </div>
  )
}

