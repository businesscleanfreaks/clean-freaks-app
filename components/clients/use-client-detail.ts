"use client"

import { useState, useEffect, useMemo } from "react"
import { getErrorMessage } from '@/lib/logger'
import { useRouter } from "next/navigation"
import { formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { getAvgOccurrencesPerMonth } from "@/lib/frequency-utils"
import { getAverageScheduleOccurrencesPerMonth } from "@/lib/schedule-averages"
import { getPrimaryScheduleForDisplay, sortSchedulesForDisplay } from "@/lib/schedule-timing"
import { showError, showSuccess, showInfo } from "@/lib/toast"
import { useConfirm } from "@/hooks/use-confirm"
import { showApiError } from "@/lib/toast"
import type {
  ClientSchedule, ClientLocation, ScheduleForModal, SubcontractorRecord,
  JobWithLocation, ActivityEntry, CreateJobPayload, BillingType, ScheduleFormMode
} from "./client-detail-types"
import {
  getAverageMonthlyScheduleOccurrences, parseScheduleDays, getScheduleFrequencyLabel,
  getScheduleTimingBadge, formatScheduleDate, getScheduleHistoryLine,
  getScheduleHistoryOverview, getInitials
} from "./client-detail-helpers"
import type { ClientWithDetails, ClientJobSummary, InvoiceSummary } from "@/lib/types"

interface UseClientDetailOptions {
  client: ClientWithDetails
  onDataChange?: () => void
}

export function useClientDetail({ client: initialClient, onDataChange }: UseClientDetailOptions) {
  const router = useRouter()
  const [client, setClient] = useState(initialClient)
  const [editing, setEditing] = useState(false)
  const [editingContact, setEditingContact] = useState(false)
  const [addingLocation, setAddingLocation] = useState(false)
  const [addingScheduleToLocation, setAddingScheduleToLocation] = useState<string | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<(ClientSchedule & { locationId?: string }) | null>(null)
  const [scheduleFormMode, setScheduleFormMode] = useState<ScheduleFormMode>('edit')
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null)
  const [addingAddonToSchedule, setAddingAddonToSchedule] = useState<string | null>(null)
  const [reassigningSchedule, setReassigningSchedule] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()
  const [subcontractors, setSubcontractors] = useState<SubcontractorRecord[]>([])
  const [mounted, setMounted] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [addingOneTimeJob, setAddingOneTimeJob] = useState<string | null>(null)
  const [oneTimeJobDate, setOneTimeJobDate] = useState('')
  const [oneTimeJobCustomTime, setOneTimeJobCustomTime] = useState(false)
  const [oneTimeJobTime, setOneTimeJobTime] = useState('')
  const [creatingOneTimeJob, setCreatingOneTimeJob] = useState(false)
  
  const [showOneTimeServiceDialog, setShowOneTimeServiceDialog] = useState(false)
  const [isTogglingPause, setIsTogglingPause] = useState(false)
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState<string | null>(null)
  const [showAdditionalServiceChoice, setShowAdditionalServiceChoice] = useState(false)

  // Add Job Modal state
  const [showAddJobModal, setShowAddJobModal] = useState(false)
  const [addJobSelectedSchedule, setAddJobSelectedSchedule] = useState<string | null>(null)
  const [addJobDate, setAddJobDate] = useState('')
  const [addJobCustomTime, setAddJobCustomTime] = useState(false)
  const [addJobTime, setAddJobTime] = useState('')
  const [addingJob, setAddingJob] = useState(false)
  const [jobTab, setJobTab] = useState<'upcoming' | 'recent'>('upcoming')
  
  const [formData, setFormData] = useState({
    name: client.name,
    phone: client.phone || '',
    communicationEmail: client.communicationEmail || '',
    communicationContactName: client.communicationContactName || '',
    communicationPhone: client.communicationPhone || '',
    invoicingEmail: client.invoicingEmail || '',
    invoicingContactName: client.invoicingContactName || '',
    invoicingPhone: client.invoicingPhone || '',
    billingType: client.billingType,
    cleanerPayType: client.cleanerPayType || 'PER_CLEAN',
    invoiceFrequency: client.invoiceFrequency || 'END_OF_MONTH',
    startDate: client.startDate ? new Date(client.startDate).toISOString().split('T')[0] : '',
    notes: client.notes || '',
  })
  const [newLocation, setNewLocation] = useState({ name: '', address: '' })

  useEffect(() => {
    setClient(initialClient)
    setMounted(true)

    // Fetch subcontractors for quick reassign
    fetch('/api/subcontractors')
      .then(res => res.json())
      .then(data => setSubcontractors(data))
      .catch(() => showError("Failed to load subcontractors"))
  }, [initialClient])

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date()
    
    let nextJob: ClientJobSummary | null = null
    let nextJobLocation = ''
    client.locations?.forEach((loc: ClientLocation) => {
      loc.jobs?.forEach((job: ClientJobSummary) => {
        if (new Date(job.date) >= now && job.status === 'SCHEDULED') {
          if (!nextJob || new Date(job.date) < new Date(nextJob.date)) {
            nextJob = job
            nextJobLocation = loc.name
          }
        }
      })
    })

    // Calculate profit from actual current-month job data (not schedule estimates)
    // This reflects per-job rate overrides (e.g. higher pay for initial deep cleans)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const monthLabel = now.toLocaleDateString('en-US', { month: 'short' })

    // Collect current-month non-cancelled jobs across all locations
    const currentMonthJobs: ClientJobSummary[] = []
    client.locations?.forEach((loc: ClientLocation) => {
      loc.jobs?.forEach((job: ClientJobSummary) => {
        const jobDate = new Date(job.date)
        if (jobDate >= monthStart && jobDate <= monthEnd
            && job.status !== 'CANCELLED') {
          currentMonthJobs.push(job)
        }
      })
    })

    let monthlyRevenue: number
    let monthlyCost: number
    let isEstimate = false

    if (currentMonthJobs.length > 0) {
      // Actual: compute from real per-job rates
      // Group by scheduleId for FLAT_RATE handling (count once per schedule, not per job)
      const jobsBySchedule = new Map<string, ClientJobSummary[]>()
      currentMonthJobs.forEach(job => {
        const key = job.scheduleId || `oneoff-${job.id}`
        if (!jobsBySchedule.has(key)) jobsBySchedule.set(key, [])
        jobsBySchedule.get(key)!.push(job)
      })

      // Build schedule lookup from loaded data (for clientPayType/subcontractorPayType)
      const scheduleMap = new Map<string, ClientSchedule>()
      client.locations?.forEach((loc: ClientLocation) => {
        loc.schedules?.forEach((sch: ClientSchedule) => {
          scheduleMap.set(sch.id, sch)
        })
      })

      monthlyRevenue = 0
      monthlyCost = 0

      jobsBySchedule.forEach((jobs) => {
        if (jobs.length === 0) return
        const isRecurring = jobs[0].scheduleId !== null
        const schedule = isRecurring ? scheduleMap.get(jobs[0].scheduleId!) : undefined

        const clientPayType = (schedule?.clientPayType || client.billingType || 'PER_CLEAN') as BillingType
        const subPayType = (schedule?.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN') as BillingType

        // Revenue
        if (clientPayType === 'FLAT_RATE' && isRecurring) {
          monthlyRevenue += jobs[0].clientRate || 0
        } else {
          monthlyRevenue += jobs.reduce((sum, j) => sum + (j.clientRate || 0), 0)
        }

        // Cost
        if (subPayType === 'FLAT_RATE' && isRecurring) {
          monthlyCost += jobs[0].subcontractorRate || 0
        } else {
          monthlyCost += jobs.reduce((sum, j) => sum + (j.subcontractorRate || 0), 0)
        }

        // Recurring add-ons (for all schedule types)
        if (schedule?.recurringAddOnServices) {
          schedule.recurringAddOnServices.forEach((addon: { clientRate: number; subcontractorRate: number }) => {
            monthlyRevenue += addon.clientRate || 0
            monthlyCost += addon.subcontractorRate || 0
          })
        }
      })
    } else {
      // Estimate: fall back to schedule-based calculation (no jobs this month yet)
      isEstimate = true

      monthlyRevenue = client.locations?.reduce((sum: number, loc: ClientLocation) => {
        return sum + (loc.schedules?.reduce((s: number, sch: ClientSchedule) => {
          const clientPayType = sch.clientPayType || client.billingType || 'PER_CLEAN'
          const avgOccurrences = getAverageMonthlyScheduleOccurrences(sch)
          let schedRevenue = 0
          if (clientPayType === 'FLAT_RATE') {
            schedRevenue = sch.defaultClientRate || 0
          } else {
            schedRevenue = (sch.defaultClientRate || 0) * avgOccurrences
          }
          // Add recurring add-ons
          sch.recurringAddOnServices?.forEach((addon: { clientRate: number; frequency: string | null }) => {
            const addonFreq = addon.frequency || 'MONTHLY'
            schedRevenue += (addon.clientRate || 0) * getAvgOccurrencesPerMonth(addonFreq, undefined)
          })
          return s + schedRevenue
        }, 0) || 0)
      }, 0) || 0

      monthlyCost = client.locations?.reduce((sum: number, loc: ClientLocation) => {
        return sum + (loc.schedules?.reduce((s: number, sch: ClientSchedule) => {
          const subcontractorPayType = sch.subcontractorPayType || client.cleanerPayType || 'PER_CLEAN'
          const avgOccurrences = getAverageMonthlyScheduleOccurrences(sch)
          let schedCost = 0
          if (subcontractorPayType === 'FLAT_RATE') {
            schedCost = sch.defaultSubcontractorRate || 0
          } else {
            schedCost = (sch.defaultSubcontractorRate || 0) * avgOccurrences
          }
          // Add recurring add-ons
          sch.recurringAddOnServices?.forEach((addon: { subcontractorRate: number; frequency: string | null }) => {
            const addonFreq = addon.frequency || 'MONTHLY'
            schedCost += (addon.subcontractorRate || 0) * getAvgOccurrencesPerMonth(addonFreq, undefined)
          })
          return s + schedCost
        }, 0) || 0)
      }, 0) || 0
    }

    const workerCounts: Record<string, number> = {}
    let earliestScheduleDate: Date | null = null
    let earliestJobDate: Date | null = null
    client.locations?.forEach((loc: ClientLocation) => {
      loc.schedules?.forEach((sch: ClientSchedule) => {
        if (sch.subcontractor?.name) {
          workerCounts[sch.subcontractor.name] = (workerCounts[sch.subcontractor.name] || 0) + 1
        }
        // Find earliest schedule start date
        if (sch.startDate) {
          const scheduleStart = new Date(sch.startDate)
          if (!earliestScheduleDate || scheduleStart < earliestScheduleDate) {
            earliestScheduleDate = scheduleStart
          }
        }
      })

      // Find earliest job date (this is the actual first cleaning date)
      loc.jobs?.forEach((job: ClientJobSummary) => {
        const jobDate = new Date(job.date)
        if (!earliestJobDate || jobDate < earliestJobDate) {
          earliestJobDate = jobDate
        }
      })
    })
    const primaryWorker = Object.entries(workerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unassigned'

    let upcomingJobsCount = 0
    client.locations?.forEach((loc: ClientLocation) => {
      loc.jobs?.forEach((job: ClientJobSummary) => {
        if (new Date(job.date) >= now && job.status === 'SCHEDULED') {
          upcomingJobsCount++
        }
      })
    })

    const activities: ActivityEntry[] = []
    client.locations?.forEach((loc: ClientLocation) => {
      loc.jobs?.filter((j: ClientJobSummary) => j.status === 'COMPLETED').slice(0, 3).forEach((job: ClientJobSummary) => {
        activities.push({
          type: 'completed',
          title: 'Service Completed',
          location: loc.name,
          date: new Date(job.date),
          worker: job.subcontractor?.name || 'Team'
        })
      })
    })
    client.invoices?.slice(0, 3).forEach((inv: InvoiceSummary) => {
      activities.push({
        type: inv.status === 'PAID' ? 'paid' : 'invoice',
        title: inv.status === 'PAID' ? 'Payment Received' : 'Invoice Sent',
        amount: inv.totalAmount,
        date: new Date(inv.dateCreated),
      })
    })
    activities.sort((a, b) => b.date.getTime() - a.date.getTime())

    return {
      nextJob: nextJob as ClientJobSummary | null,
      nextJobLocation,
      monthlyRevenue,
      monthlyCost,
      monthlyProfit: monthlyRevenue - monthlyCost,
      profitMargin: monthlyRevenue > 0 ? ((monthlyRevenue - monthlyCost) / monthlyRevenue * 100) : 0,
      isEstimate,
      monthLabel,
      primaryWorker,
      upcomingJobsCount,
      activities: activities.slice(0, 5),
      clientSince: earliestJobDate || (client.startDate ? new Date(client.startDate) : earliestScheduleDate),
    }
  }, [client])

  const handleUpdate = async () => {
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!response.ok) throw new Error('Failed to update')
      const updatedClient = await response.json()
      setClient(updatedClient)
      setEditing(false)
      setEditingContact(false)
      onDataChange?.()
      showSuccess('Client updated')
    } catch (error) {
      showError('Failed to update')
    }
  }

  const handleAddLocation = async () => {
    if (!newLocation.name || !newLocation.address) {
      showError('Please fill in both fields')
      return
    }
    try {
      const response = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newLocation, clientId: client.id }),
      })
      if (!response.ok) throw new Error('Failed to add location')
      setNewLocation({ name: '', address: '' })
      setAddingLocation(false)
      showSuccess('Location added')
      onDataChange?.()
    } catch (error) {
      showError('Failed to add location')
    }
  }

  const handleDeleteLocation = async (locationId: string) => {
    const confirmed = await confirm({
      title: "Delete Location?",
      description: "Delete this location and all schedules?",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      const response = await fetch(`/api/locations/${locationId}`, { method: 'DELETE' })
      if (!response.ok) {
        await showApiError(response, 'Failed to delete location')
        return
      }
      showSuccess('Location deleted')
      onDataChange?.()
    } catch {
      showError('Failed to delete location. Please try again.')
    }
  }

  const handleDeleteSchedule = async (scheduleId: string) => {
    const confirmed = await confirm({
      title: "Delete Schedule?",
      description: "Delete this schedule?",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' })
      if (!response.ok) {
        await showApiError(response, 'Failed to delete schedule')
        return
      }
      showSuccess('Schedule deleted')
      onDataChange?.()
    } catch {
      showError('Failed to delete schedule. Please try again.')
    }
  }

  const handleToggleSchedulePause = async (scheduleId: string, currentlyActive: boolean) => {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentlyActive }),
      })
      if (!response.ok) {
        await showApiError(response, 'Failed to update schedule')
        return
      }
      showSuccess(currentlyActive ? 'Schedule paused' : 'Schedule resumed')
      onDataChange?.()
    } catch {
      showError('Failed to update schedule. Please try again.')
    }
  }

  const closeScheduleEditor = () => {
    setEditingSchedule(null)
    setScheduleFormMode('edit')
  }

  const handleDeleteClient = async () => {
    const totalJobs = client.locations?.reduce((sum: number, loc: ClientLocation) => sum + (loc.jobs?.length || 0), 0) || 0
    const totalSchedules = client.locations?.reduce((sum: number, loc: ClientLocation) => sum + (loc.schedules?.length || 0), 0) || 0

    const impactParts: string[] = []
    if (totalJobs > 0) impactParts.push(`${totalJobs} job${totalJobs === 1 ? '' : 's'}`)
    if (totalSchedules > 0) impactParts.push(`${totalSchedules} schedule${totalSchedules === 1 ? '' : 's'}`)

    const impactText = impactParts.length > 0
      ? ` This will permanently remove ${impactParts.join(' and ')}.`
      : ''

    const confirmed = await confirm({
      title: "Delete Client?",
      description: `Delete "${client.name}"? This cannot be undone.${impactText}`,
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      const response = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' })
      if (!response.ok) {
        await showApiError(response, 'Failed to delete client')
        return
      }
      showSuccess('Client deleted')
      router.push('/clients')
    } catch {
      showError('Failed to delete client. Please try again.')
    }
  }

  const handleTogglePause = async () => {
    const currentlyActive = client.isActive !== false
    const futureJobCount = client.locations?.reduce((total: number, loc: ClientLocation) => {
      const now = new Date()
      return total + (loc.jobs?.filter((j: ClientJobSummary) =>
        j.status === 'SCHEDULED' && new Date(j.date) >= now
      ).length || 0)
    }, 0) || 0

    if (currentlyActive) {
      const confirmed = await confirm({
        title: "Pause Client?",
        description: futureJobCount > 0
          ? `This will cancel ${futureJobCount} upcoming job${futureJobCount === 1 ? '' : 's'} and pause all schedules for ${client.name}. You can resume at any time.`
          : `All schedules for ${client.name} will be paused. You can resume at any time.`,
        confirmText: "Pause Client",
        cancelText: "Never mind",
        variant: "destructive",
      })
      if (!confirmed) return
    }

    setIsTogglingPause(true)
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentlyActive }),
      })
      if (!response.ok) {
        await showApiError(response, `Failed to ${currentlyActive ? 'pause' : 'resume'} client`)
        return
      }
      const updated = await response.json()
      setClient(updated)
      showSuccess(currentlyActive ? 'Client paused — upcoming jobs cancelled' : 'Client resumed — schedules reactivated')
      onDataChange?.()
    } catch {
      showError(`Failed to ${currentlyActive ? 'pause' : 'resume'} client. Please try again.`)
    } finally {
      setIsTogglingPause(false)
    }
  }

  const handleGenerateInvoice = () => {
    setShowInvoiceModal(true)
  }

  const handleCreateInvoice = async () => {
    // Prevent double-clicks
    if (creatingInvoice) return
    
    try {
      setCreatingInvoice(true)
      
      // Find all uninvoiced completed jobs that are in the past (not future jobs)
      const today = new Date()
      today.setHours(23, 59, 59, 999) // End of today
      const uninvoicedJobs: string[] = []
      client.locations?.forEach((loc: ClientLocation) => {
        loc.jobs?.forEach((job: ClientJobSummary) => {
          const jobDate = new Date(job.date)
          if (job.status === 'COMPLETED' && !job.invoiced && jobDate <= today) {
            uninvoicedJobs.push(job.id)
          }
        })
      })

      if (uninvoicedJobs.length === 0) {
        showInfo('No completed jobs to invoice. Complete some jobs first!')
        setShowInvoiceModal(false)
        return
      }

      // Create invoice with the uninvoiced jobs
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          clientId: client.id,
          jobIds: uninvoicedJobs,
        }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create invoice')
      }
      const invoice = await response.json()
      showSuccess(`Invoice created! Opening email...`)
      setShowInvoiceModal(false)
      // Small delay to ensure database is synced, then go to email dialog
      await new Promise(resolve => setTimeout(resolve, 500))
      router.push(`/invoices/${invoice.id}?action=email`)
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreatingInvoice(false)
    }
  }

  const handleAddJob = () => {
    // Check if there are any schedules to add jobs to
    const allSchedules: ScheduleForModal[] = client.locations?.flatMap((loc: ClientLocation) =>
      loc.schedules?.map((sch: ClientSchedule) => ({ ...sch, locationId: loc.id, locationName: loc.name })) || []
    ) || []
    
    if (allSchedules.length === 0) {
      if (client.locations?.length > 0) {
        setExpandedLocation(client.locations[0].id)
        showInfo('Create a schedule first, then you can add jobs')
      } else {
        setAddingLocation(true)
        showInfo('Add a location first, then create a schedule')
      }
      return
    }
    
    // Open the Add Job modal
    setShowAddJobModal(true)
    // Auto-select if there's only one schedule
    if (allSchedules.length === 1) {
      setAddJobSelectedSchedule(allSchedules[0].id)
    }
  }
  
  // Get all schedules with location info for the modal
  const allSchedulesForModal: ScheduleForModal[] = client.locations?.flatMap((loc: ClientLocation) =>
    loc.schedules?.map((sch: ClientSchedule) => ({ ...sch, locationId: loc.id, locationName: loc.name })) || []
  ) || []
  
  const handleAddJobSubmit = async () => {
    if (!addJobSelectedSchedule || !addJobDate) {
      showError('Please select a schedule and date')
      return
    }
    
    const selectedSchedule = allSchedulesForModal.find((s: ScheduleForModal) => s.id === addJobSelectedSchedule)
    if (!selectedSchedule) return

    setAddingJob(true)
    try {
      const jobData: CreateJobPayload = {
        scheduleId: selectedSchedule.id,
        locationId: selectedSchedule.locationId,
        subcontractorId: selectedSchedule.subcontractorId || null,
        date: addJobDate,
        clientRate: selectedSchedule.defaultClientRate || 0,
        subcontractorRate: selectedSchedule.defaultSubcontractorRate || 0,
        status: 'SCHEDULED',
      }
      
      if (addJobCustomTime && addJobTime) {
        jobData.startTime = addJobTime
        jobData.startWindowBegin = null
        jobData.startWindowEnd = null
      } else {
        jobData.startTime = selectedSchedule.startTime || null
        jobData.startWindowBegin = selectedSchedule.startWindowBegin || null
        jobData.startWindowEnd = selectedSchedule.startWindowEnd || null
      }
      
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create job')
      }
      
      showSuccess('Job added successfully!')
      setShowAddJobModal(false)
      setAddJobSelectedSchedule(null)
      setAddJobDate('')
      setAddJobCustomTime(false)
      setAddJobTime('')
      onDataChange?.()
    } catch (error) {
      showError(error instanceof Error ? getErrorMessage(error) : 'Failed to create job')
    } finally {
      setAddingJob(false)
    }
  }

  const handleQuickReassign = async (scheduleId: string, newSubcontractorId: string | null) => {
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcontractorId: newSubcontractorId }),
      })
      if (!response.ok) throw new Error('Failed to reassign')
      showSuccess('Cleaner reassigned')
      setReassigningSchedule(null)
      onDataChange?.()
    } catch (error) {
      showError('Failed to reassign cleaner')
    }
  }

  const handleCreateOneTimeJob = async (schedule: ClientSchedule, locationId: string) => {
    if (!oneTimeJobDate) {
      showError('Please select a date')
      return
    }

    setCreatingOneTimeJob(true)
    try {
      // Use custom time if specified, otherwise use schedule's default
      const jobData: CreateJobPayload = {
        scheduleId: schedule.id,
        locationId: locationId,
        subcontractorId: schedule.subcontractorId || null,
        date: oneTimeJobDate,
        clientRate: schedule.defaultClientRate || 0,
        subcontractorRate: schedule.defaultSubcontractorRate || 0,
        status: 'SCHEDULED',
      }
      
      if (oneTimeJobCustomTime && oneTimeJobTime) {
        // Custom time - use specific time
        jobData.startTime = oneTimeJobTime
        jobData.startWindowBegin = null
        jobData.startWindowEnd = null
      } else {
        // Use schedule's default time
        jobData.startTime = schedule.startTime || null
        jobData.startWindowBegin = schedule.startWindowBegin || null
        jobData.startWindowEnd = schedule.startWindowEnd || null
      }
      
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create job')
      }
      
      showSuccess('One-time job added!')
      setAddingOneTimeJob(null)
      setOneTimeJobDate('')
      setOneTimeJobCustomTime(false)
      setOneTimeJobTime('')
      onDataChange?.()
    } catch (error) {
      showError(error instanceof Error ? getErrorMessage(error) : 'Failed to create job')
    } finally {
      setCreatingOneTimeJob(false)
    }
  }
  
  const formatNextClean = () => {
    if (!stats.nextJob) return null
    const date = new Date(stats.nextJob.date)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    let dateStr = ''
    if (date.toDateString() === today.toDateString()) {
      dateStr = 'Today'
    } else if (date.toDateString() === tomorrow.toDateString()) {
      dateStr = 'Tomorrow'
    } else {
      dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }
    
    return {
      date: dateStr,
      time: formatTime(stats.nextJob.startTime || '09:00'),
      location: stats.nextJobLocation,
      worker: stats.nextJob.subcontractor?.name
    }
  }

  const { upcomingJobs, recentJobs } = useMemo(() => {
    const nowDate = new Date()
    nowDate.setHours(0, 0, 0, 0)
    const allJobs: JobWithLocation[] = client.locations?.flatMap((loc: ClientLocation) =>
      loc.jobs?.map((job: ClientJobSummary) => ({ ...job, location: { id: loc.id, name: loc.name } })) || []
    ) || []
    const upcoming = allJobs
      .filter((j: JobWithLocation) => new Date(j.date) >= nowDate && j.status === 'SCHEDULED')
      .sort((a: JobWithLocation, b: JobWithLocation) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 15)
    const recent = allJobs
      .filter((j: JobWithLocation) => new Date(j.date) < nowDate || j.status !== 'SCHEDULED')
      .sort((a: JobWithLocation, b: JobWithLocation) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 15)
    return { upcomingJobs: upcoming, recentJobs: recent }
  }, [client])

  const displayJobs = jobTab === 'upcoming' ? upcomingJobs : recentJobs
  const nextClean = formatNextClean()
  const isActive = client.isActive !== false
  const locationCount = client.locations?.length || 0
  const hasDifferentInvoicingEmail = client.invoicingEmail && client.invoicingEmail !== client.communicationEmail

  // Animation classes
  const fadeIn = mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'

  return {
    // Core
    router,
    client,
    mounted,
    fadeIn,
    ConfirmDialog,
    
    // Computed
    stats,
    nextClean,
    isActive,
    locationCount,
    hasDifferentInvoicingEmail,
    upcomingJobs,
    recentJobs,
    displayJobs,
    allSchedulesForModal,
    subcontractors,
    
    // Form state
    formData,
    setFormData,
    newLocation,
    setNewLocation,
    
    // UI state
    editing,
    setEditing,
    editingContact,
    setEditingContact,
    addingLocation,
    setAddingLocation,
    addingScheduleToLocation,
    setAddingScheduleToLocation,
    editingSchedule,
    setEditingSchedule,
    scheduleFormMode,
    setScheduleFormMode,
    expandedLocation,
    setExpandedLocation,
    addingAddonToSchedule,
    setAddingAddonToSchedule,
    reassigningSchedule,
    setReassigningSchedule,
    scheduleMenuOpen,
    setScheduleMenuOpen,
    jobTab,
    setJobTab,
    
    // Modal state
    showInvoiceModal,
    setShowInvoiceModal,
    creatingInvoice,
    showAdditionalServiceChoice,
    setShowAdditionalServiceChoice,
    showOneTimeServiceDialog,
    setShowOneTimeServiceDialog,
    showAddJobModal,
    setShowAddJobModal,
    addJobSelectedSchedule,
    setAddJobSelectedSchedule,
    addJobDate,
    setAddJobDate,
    addJobCustomTime,
    setAddJobCustomTime,
    addJobTime,
    setAddJobTime,
    addingJob,
    
    // One-time job state
    addingOneTimeJob,
    setAddingOneTimeJob,
    oneTimeJobDate,
    setOneTimeJobDate,
    oneTimeJobCustomTime,
    setOneTimeJobCustomTime,
    oneTimeJobTime,
    setOneTimeJobTime,
    creatingOneTimeJob,
    
    // Pause state
    isTogglingPause,
    
    // Handlers
    handleUpdate,
    handleAddLocation,
    handleDeleteLocation,
    handleDeleteSchedule,
    handleToggleSchedulePause,
    closeScheduleEditor,
    handleDeleteClient,
    handleTogglePause,
    handleGenerateInvoice,
    handleCreateInvoice,
    handleAddJob,
    handleAddJobSubmit,
    handleQuickReassign,
    handleCreateOneTimeJob,
    
    // Re-export onDataChange so sub-components can call it
    onDataChange,
  }
}

export type ClientDetailState = ReturnType<typeof useClientDetail>
