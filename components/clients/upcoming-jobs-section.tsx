"use client"

import { useState, useMemo } from "react"
import { format } from "date-fns"
import { formatCurrency } from "@/lib/utils"
import { 
  Calendar, Clock, MapPin, User, CheckCircle, XCircle, 
  Edit2, Trash2, Check, AlertCircle, RotateCcw
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { showError, showSuccess, showApiError } from "@/lib/toast"
import { SimpleTooltip } from "@/components/ui/simple-tooltip"
import { useConfirm } from "@/hooks/use-confirm"

interface Job {
  id: string
  date: Date | string
  startTime?: string | null
  status: string
  invoiced: boolean
  scheduleId: string | null
  location: {
    id: string
    name: string
  }
  subcontractor: {
    id: string
    name: string
  } | null
  vendor?: {
    id: string
    name: string
  } | null
  schedule: {
    id: string
    frequency: string
  } | null
  clientRate?: number
  subcontractorRate?: number
}

interface UpcomingJobsSectionProps {
  jobs: Job[]
  locations: Array<{ id: string; name: string }>
  onDataChange?: () => void
}

export function UpcomingJobsSection({ jobs, locations, onDataChange }: UpcomingJobsSectionProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'upcoming' | 'recent'>('upcoming')
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  // Memoize 'now' so it doesn't create a new object on every render
  const now = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const { upcomingJobs, recentJobs } = useMemo(() => {
    const upcoming: Job[] = []
    const recent: Job[] = []

    jobs.forEach((job) => {
      const jobDate = new Date(job.date)
      jobDate.setHours(0, 0, 0, 0)
      const isUpcoming = jobDate >= now && job.status === 'SCHEDULED'
      const isRecent = jobDate < now || job.status !== 'SCHEDULED'

      if (isUpcoming) {
        upcoming.push(job)
      } else if (isRecent) {
        recent.push(job)
      }
    })

    // Sort upcoming by date (ascending)
    upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    
    // Sort recent by date (descending)
    recent.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return {
      upcomingJobs: upcoming.slice(0, 10), // Show next 10 upcoming
      recentJobs: recent.slice(0, 10), // Show last 10 recent
    }
  }, [jobs, now])

  const handleMarkComplete = async (jobId: string) => {
    setUpdatingJobId(jobId)
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update job')
      }

      showSuccess('Job marked as completed')
      onDataChange?.()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update job')
    } finally {
      setUpdatingJobId(null)
    }
  }

  const handleMarkAsScheduled = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    setUpdatingJobId(jobId)
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SCHEDULED' }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update job')
      }

      showSuccess('Job marked as scheduled')
      onDataChange?.()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update job')
    } finally {
      setUpdatingJobId(null)
    }
  }

  const handleCardClick = (job: Job) => {
    router.push(`/calendar?jobId=${job.id}`)
  }

  const handleDeleteJob = async (jobId: string) => {
    const confirmed = await confirm({
      title: "Delete Job?",
      description: "Are you sure you want to delete this job?",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    setUpdatingJobId(jobId)
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        await showApiError(response, 'Failed to delete job')
        setUpdatingJobId(null)
        return
      }

      showSuccess('Job deleted successfully')
      onDataChange?.()
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete job')
    } finally {
      setUpdatingJobId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        )
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <XCircle className="w-3 h-3" />
            Cancelled
          </span>
        )
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: '#F3F3F3', color: '#555555' }}>
            <Calendar className="w-3 h-3" />
            Scheduled
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <AlertCircle className="w-3 h-3" />
            {status}
          </span>
        )
    }
  }

  const renderJobCard = (job: Job, isUpcoming: boolean) => {
    const isOneTime = job.scheduleId === null
    const jobDate = new Date(job.date)
    const location = locations.find(loc => loc.id === job.location.id)
    const isCompleted = job.status === 'COMPLETED'

    return (
      <div
        key={job.id}
        onClick={() => handleCardClick(job)}
        className={`group p-4 rounded-lg border transition-all duration-200 cursor-pointer
          ${isOneTime
            ? 'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 hover:border-orange-400 hover:border-2 hover:shadow-lg hover:scale-[1.02]'
            : 'bg-white border-gray-200 hover:border-teal-400 hover:border-2 hover:shadow-lg hover:scale-[1.02]'
          }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Header Row */}
            <div className="flex items-center gap-2 mb-2">
              {isOneTime ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-orange-700" style={{ backgroundColor: 'rgba(249, 115, 22, 0.12)' }}>
                  <AlertCircle className="w-3 h-3" />
                  One-Time
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-teal-700" style={{ backgroundColor: 'rgba(0, 168, 150, 0.12)' }}>
                  <RotateCcw className="w-3 h-3" />
                  Recurring
                </span>
              )}
              {getStatusBadge(job.status)}
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-4 mb-2 text-sm">
              <div className="flex items-center gap-1.5 text-gray-700">
                <Calendar className="w-4 h-4 text-stone-400" />
                <span className="font-semibold">
                  {format(jobDate, 'EEE, MMM d, yyyy')}
                </span>
              </div>
              {job.startTime && (
                <div className="flex items-center gap-1.5 text-gray-600">
                  <Clock className="w-4 h-4 text-stone-400" />
                  <span>{job.startTime}</span>
                </div>
              )}
            </div>

            {/* Location */}
            <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
              <MapPin className="w-4 h-4 text-stone-400" />
              <span>{location?.name || job.location.name}</span>
            </div>

            {/* Cleaner */}
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <User className="w-4 h-4 text-stone-400" />
              <span>{job.subcontractor?.name || job.vendor?.name || 'Unassigned'}</span>
            </div>

            {/* Frequency (for recurring) */}
            {!isOneTime && job.schedule?.frequency && (
              <div className="mt-2 text-xs text-stone-500">
                {job.schedule.frequency.replace('_', ' ')}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Mark as Scheduled (Undo) - for completed jobs */}
            {isCompleted && (
              <SimpleTooltip content="job-undo">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => handleMarkAsScheduled(job.id, e)}
                  disabled={updatingJobId === job.id}
                  className="h-7 w-7 p-0 hover:bg-teal-100"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-teal-600" />
                </Button>
              </SimpleTooltip>
            )}
            {/* Mark as Completed removed — assumed completion model */}
            <SimpleTooltip content="job-edit">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  router.push(`/calendar?jobId=${job.id}`)
                }}
                className="h-7 w-7 p-0 hover:bg-teal-100"
              >
                <Edit2 className="w-3.5 h-3.5 text-teal-600" />
              </Button>
            </SimpleTooltip>
            <SimpleTooltip content="job-delete">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteJob(job.id)
                }}
                disabled={updatingJobId === job.id}
                className="h-7 w-7 p-0 hover:bg-red-100"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </Button>
            </SimpleTooltip>
          </div>
        </div>

        {/* Mobile Actions */}
        <div className="flex gap-2 mt-3 sm:hidden pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
          {isCompleted && (
            <SimpleTooltip content="job-undo">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation()
                  handleMarkAsScheduled(job.id, e)
                }}
                disabled={updatingJobId === job.id}
                className="flex-1 text-xs"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Undo
              </Button>
            </SimpleTooltip>
          )}
          <SimpleTooltip content="job-edit">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/calendar?jobId=${job.id}`)
              }}
              className="flex-1 text-xs"
            >
              <Edit2 className="w-3 h-3 mr-1" />
              Edit
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="job-delete">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteJob(job.id)
              }}
              disabled={updatingJobId === job.id}
              className="flex-1 text-xs text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
          </SimpleTooltip>
        </div>
      </div>
    )
  }

  const displayJobs = activeTab === 'upcoming' ? upcomingJobs : recentJobs
  const emptyMessage = activeTab === 'upcoming' 
    ? 'No upcoming jobs scheduled'
    : 'No recent job activity'

  return (
    <>
      <ConfirmDialog />
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      {/* Header with Tabs */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 tracking-tight">Upcoming Jobs & Activity</h2>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'upcoming'
                ? 'bg-teal-600 text-white'
                : ''
            }`}
            style={activeTab !== 'upcoming' ? { backgroundColor: '#F3F3F3', color: '#888888' } : undefined}
          >
            Upcoming ({upcomingJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'recent'
                ? 'bg-teal-600 text-white'
                : ''
            }`}
            style={activeTab !== 'recent' ? { backgroundColor: '#F3F3F3', color: '#888888' } : undefined}
          >
            Recent ({recentJobs.length})
          </button>
        </div>
      </div>

      {/* Jobs List */}
      {displayJobs.length > 0 ? (
        <div className="divide-y divide-stone-100/80 max-h-[600px] overflow-y-auto">
          {displayJobs.map((job) => renderJobCard(job, activeTab === 'upcoming'))}
        </div>
      ) : (
        <div className="p-10 text-center">
          <Clock className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-500">{emptyMessage}</p>
        </div>
      )}
    </div>
    </>
  )
}
