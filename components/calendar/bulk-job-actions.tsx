"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, User, X, Loader2 } from "lucide-react"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import { useConfirm } from "@/hooks/use-confirm"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface BulkJobActionsProps {
  selectedJobIds: Set<string>
  onClearSelection: () => void
  onJobsUpdated: () => void
  subcontractors: Array<{ id: string; name: string }>
}

export function BulkJobActions({
  selectedJobIds,
  onClearSelection,
  onJobsUpdated,
  subcontractors,
}: BulkJobActionsProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string>("")
  const { confirm, ConfirmDialog } = useConfirm()

  const selectedCount = selectedJobIds.size

  if (selectedCount === 0) {
    return null
  }

  const handleBulkComplete = async () => {
    const confirmed = await confirm({
      title: "Mark Jobs as Complete?",
      description: `Mark ${selectedCount} job${selectedCount !== 1 ? 's' : ''} as completed?`,
      confirmText: "Mark Complete",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    setIsProcessing(true)
    try {
      const response = await fetch('/api/jobs/bulk-update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobIds: Array.from(selectedJobIds),
          status: 'COMPLETED',
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to mark jobs as complete')
        return
      }

      showSuccess(`${selectedCount} job${selectedCount !== 1 ? 's' : ''} marked as complete`)
      onClearSelection()
      onJobsUpdated()
    } catch (error) {
      showError('Failed to mark jobs as complete. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkAssign = async () => {
    if (!selectedSubcontractorId || selectedSubcontractorId === 'unassigned') {
      showError('Please select a subcontractor')
      return
    }

    const subcontractor = subcontractors.find(s => s.id === selectedSubcontractorId)
    const confirmed = await confirm({
      title: "Assign Subcontractor?",
      description: `Assign ${selectedCount} job${selectedCount !== 1 ? 's' : ''} to ${subcontractor?.name || 'selected subcontractor'}?`,
      confirmText: "Assign",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    setIsProcessing(true)
    try {
      const response = await fetch('/api/jobs/bulk-update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobIds: Array.from(selectedJobIds),
          subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId,
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to assign subcontractor')
        return
      }

      showSuccess(`${selectedCount} job${selectedCount !== 1 ? 's' : ''} assigned`)
      onClearSelection()
      setSelectedSubcontractorId("")
      onJobsUpdated()
    } catch (error) {
      showError('Failed to assign subcontractor. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkCancel = async () => {
    const confirmed = await confirm({
      title: "Cancel Jobs?",
      description: `Cancel ${selectedCount} job${selectedCount !== 1 ? 's' : ''}? This action cannot be undone.`,
      confirmText: "Cancel Jobs",
      cancelText: "Keep Scheduled",
      variant: "destructive",
    })

    if (!confirmed) return

    setIsProcessing(true)
    try {
      const response = await fetch('/api/jobs/bulk-update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobIds: Array.from(selectedJobIds),
          status: 'CANCELLED',
        }),
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to cancel jobs')
        return
      }

      showSuccess(`${selectedCount} job${selectedCount !== 1 ? 's' : ''} cancelled`)
      onClearSelection()
      onJobsUpdated()
    } catch (error) {
      showError('Failed to cancel jobs. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-white border-2 border-teal-500 rounded-xl shadow-2xl p-4 min-w-[500px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
            <span className="text-sm font-bold text-teal-700">{selectedCount}</span>
          </div>
          <span className="font-semibold text-gray-900">
            {selectedCount} job{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleBulkComplete}
            disabled={isProcessing}
            className="bg-green-600 hover:bg-green-700"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Mark Complete
          </Button>

          <div className="flex items-center gap-2">
            <Select
              value={selectedSubcontractorId}
              onValueChange={setSelectedSubcontractorId}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {subcontractors.map((sub) => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {sub.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleBulkAssign}
              disabled={isProcessing || !selectedSubcontractorId || selectedSubcontractorId === 'unassigned'}
              variant="outline"
            >
              <User className="h-4 w-4 mr-2" />
              Assign
            </Button>
          </div>

          <Button
            size="sm"
            onClick={handleBulkCancel}
            disabled={isProcessing}
            variant="outline"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            disabled={isProcessing}
          >
            Clear
          </Button>
        </div>
      </div>
      <ConfirmDialog />
    </div>
  )
}


