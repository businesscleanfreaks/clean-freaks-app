"use client"

import { useState, useMemo, useEffect, Fragment } from "react"
import { refreshCalendarData } from "./calendar-client"
import { useDebounce } from "@/hooks/use-debounce"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TimePicker } from "@/components/ui/time-picker"
import { format } from "date-fns"
import {
  Calendar as CalendarIcon,
  Search,
  UserPlus,
  Sparkles,
  Plus,
  PlusCircle,
  ArrowLeft,
  ArrowRight,
  MapPin,
  DollarSign,
  Clock,
  CheckCircle2,
  X,
  Check,
  Building2,
} from "lucide-react"
import type { ClientListItem, SubcontractorSummary } from "@/lib/types"

interface CreateJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDate: Date | null
  selectedTime?: string
  clients: ClientListItem[]
  subcontractors: SubcontractorSummary[]
  preSelectedClientId?: string
}

type JobType = 'regular' | 'post_construction' | 'move_in_out' | 'deep_clean' | 'event'

const JOB_TYPE_OPTIONS: { id: JobType; label: string }[] = [
  { id: 'regular', label: 'Regular' },
  { id: 'deep_clean', label: 'Deep Clean' },
  { id: 'post_construction', label: 'Post-Construction' },
  { id: 'move_in_out', label: 'Move In/Out' },
  { id: 'event', label: 'Event' },
]

export function CreateJobDialog({
  open,
  onOpenChange,
  selectedDate,
  selectedTime,
  clients,
  subcontractors,
  preSelectedClientId,
}: CreateJobDialogProps) {
  const activeSubcontractors = useMemo(() => subcontractors.filter(s => s.isActive !== false), [subcontractors])
  const [loading, setLoading] = useState(false)

  // Vendors for add-on assignment
  const [vendors, setVendors] = useState<{ id: string; name: string; isActive?: boolean }[]>([])
  useEffect(() => {
    if (open) {
      fetch('/api/vendors')
        .then(res => res.ok ? res.json() : [])
        .then(data => setVendors(Array.isArray(data) ? data : []))
        .catch(() => setVendors([]))
    }
  }, [open])
  
  const [step, setStep] = useState<1 | 2 | 3>(preSelectedClientId ? 2 : 1)
  
  // Flow type: null = picking, 'cleaning' = extra cleaning, 'addon' = add-on service
  const [flowType, setFlowType] = useState<'cleaning' | 'addon' | null>(null)
  
  // Step 1: Client
  const [clientType, setClientType] = useState<'existing' | 'one-time' | null>(preSelectedClientId ? 'existing' : null)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [selectedClientId, setSelectedClientId] = useState<string>(preSelectedClientId || '')
  const [oneTimeClientName, setOneTimeClientName] = useState('')
  const [oneTimeAddress, setOneTimeAddress] = useState('')
  const [oneTimePhone, setOneTimePhone] = useState('')
  
  // Step 2: Job Details (cleaning flow)
  const [jobType, setJobType] = useState<JobType>('regular')
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>(() => {
    if (preSelectedClientId) {
      const preClient = clients.find(c => c.id === preSelectedClientId)
      if (preClient?.locations?.length === 1) {
        return [preClient.locations[0].id]
      }
    }
    return []
  })
  const [jobDate, setJobDate] = useState<Date | null>(selectedDate)
  const [timeType, setTimeType] = useState<'specific' | 'window'>('specific')
  const [startTime, setStartTime] = useState(selectedTime || '')
  const [startWindowBegin, setStartWindowBegin] = useState('')
  const [startWindowEnd, setStartWindowEnd] = useState('')
  const [isTrial, setIsTrial] = useState(false)
  const [trialNotes, setTrialNotes] = useState('')
  
  // Step 3: Pricing (cleaning flow)
  const [clientRate, setClientRate] = useState('')
  const [subcontractorRate, setSubcontractorRate] = useState('')
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string>('unassigned')
  
  // Add-on flow state
  const [addonDescription, setAddonDescription] = useState('')
  const [addonClientRate, setAddonClientRate] = useState('')
  const [addonCleanerPay, setAddonCleanerPay] = useState('')

  // Filtered clients
  const filteredClients = useMemo(() => {
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name))
    if (!searchQuery.trim()) return sorted
    return sorted.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [clients, searchQuery])

  const selectedClient = useMemo(() => {
    return clients.find(c => c.id === selectedClientId)
  }, [clients, selectedClientId])

  const locations = useMemo(() => {
    return selectedClient?.locations || []
  }, [selectedClient])

  useMemo(() => {
    if (selectedDate) setJobDate(selectedDate)
  }, [selectedDate])

  const resetForm = () => {
    setStep(preSelectedClientId ? 2 : 1)
    setFlowType(null)
    setClientType(preSelectedClientId ? 'existing' : null)
    setSearchQuery('')
    setSelectedClientId(preSelectedClientId || '')
    setOneTimeClientName('')
    setOneTimeAddress('')
    setOneTimePhone('')
    setJobType('regular')
    const preClient = preSelectedClientId ? clients.find(c => c.id === preSelectedClientId) : null
    setSelectedLocationIds(preClient?.locations?.length === 1 ? [preClient.locations[0].id] : [])
    setJobDate(selectedDate)
    setTimeType('specific')
    setStartTime('')
    setStartWindowBegin('')
    setStartWindowEnd('')
    setIsTrial(false)
    setTrialNotes('')
    setClientRate('')
    setSubcontractorRate('')
    setSelectedSubcontractorId('unassigned')
    setAddonDescription('')
    setAddonClientRate('')
    setAddonCleanerPay('')
  }

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId) 
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    )
  }

  const selectClient = (client: ClientListItem) => {
    setSelectedClientId(client.id)
    setClientType('existing')
    
    if (client.locations?.length === 1) {
      setSelectedLocationIds([client.locations[0].id])
      setStep(2)
    }
  }

  const selectLocationAndAdvance = (locationId: string) => {
    setSelectedLocationIds([locationId])
    setStep(2)
  }

  const handleClose = () => {
    resetForm()
    onOpenChange(false)
  }

  // Step validation
  const canProceedStep1 = clientType === 'existing' 
    ? (!!selectedClientId && selectedLocationIds.length > 0) 
    : (!!oneTimeClientName && !!oneTimeAddress)
  const canProceedStep2 = flowType === 'cleaning' && (clientType === 'one-time' || selectedLocationIds.length > 0)
  const canSubmit = !!clientRate && !!subcontractorRate
  const canSubmitAddon = !!addonDescription && !!addonClientRate && !!jobDate

  const goToStep = (targetStep: 1 | 2 | 3) => {
    if (targetStep === 1) {
      setStep(1)
    } else if (targetStep === 2 && canProceedStep1) {
      setStep(2)
    } else if (targetStep === 3 && canProceedStep1 && canProceedStep2) {
      setStep(3)
    }
  }

  // Submit handler for the cleaning flow
  const handleSubmit = async () => {
    const { showError, showSuccess } = await import('@/lib/toast')

    if (!jobDate) {
      showError('Please select a date')
      return
    }

    if (clientType === 'existing' && selectedLocationIds.length === 0) {
      showError('Please select at least one location')
      return
    }

    if (!clientRate || !subcontractorRate) {
      showError('Please enter both rates')
      return
    }

    setLoading(true)
    try {
      let locationIdsToCreate = selectedLocationIds

      if (clientType === 'one-time') {
        const clientResponse = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: oneTimeClientName,
            phone: oneTimePhone || null,
            billingType: 'PER_CLEAN',
            cleanerPayType: 'PER_CLEAN',
            notes: `One-time ${jobType?.replace('_', ' ')} job`,
            locations: [{ name: 'Primary', address: oneTimeAddress }],
          }),
        })

        if (!clientResponse.ok) throw new Error('Failed to create one-time client')
        const newClient = await clientResponse.json()
        locationIdsToCreate = [newClient.locations[0].id]
      }

      const jobResults = await Promise.all(
        locationIdsToCreate.map(locationId =>
          fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              locationId,
              subcontractorId: selectedSubcontractorId === 'unassigned' ? null : selectedSubcontractorId,
              date: format(jobDate, 'yyyy-MM-dd'),
              startTime: timeType === 'specific' && startTime ? startTime : null,
              startWindowBegin: timeType === 'window' && startWindowBegin ? startWindowBegin : null,
              startWindowEnd: timeType === 'window' && startWindowEnd ? startWindowEnd : null,
              clientRate: parseFloat(clientRate),
              subcontractorRate: parseFloat(subcontractorRate),
              isTrial,
              trialNotes: isTrial ? (trialNotes.trim() || null) : null,
            }),
          })
        )
      )

      if (jobResults.some(r => !r.ok)) throw new Error('Failed to create some jobs')

      handleClose()
      showSuccess(locationIdsToCreate.length > 1 ? `${locationIdsToCreate.length} jobs scheduled!` : 'Job scheduled!')
      refreshCalendarData()
    } catch (error) {
      const { logger } = await import('@/lib/logger')
      logger.error('Error creating job:', error)
      showError('Failed to create job. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Submit handler for the add-on flow
  const handleAddonSubmit = async () => {
    const { showError, showSuccess } = await import('@/lib/toast')

    if (!jobDate) {
      showError('Please select a date')
      return
    }
    if (!addonDescription || !addonClientRate) {
      showError('Please fill in the service details')
      return
    }
    // Auto-select location if not explicitly chosen (e.g. addon flow skips location picker)
    let locationIdsForAddon = selectedLocationIds
    if (locationIdsForAddon.length === 0) {
      const clientLocations = clients.find(c => c.id === selectedClientId)?.locations || []
      if (clientLocations.length > 0) {
        locationIdsForAddon = [clientLocations[0].id]
      } else {
        showError('No location found for this client')
        return
      }
    }

    setLoading(true)
    try {
      const dateStr = format(jobDate, 'yyyy-MM-dd')
      const locationId = locationIdsForAddon[0]

      // Check for an existing job on this date for this client's location
      const existingJobsRes = await fetch(`/api/jobs/by-date-range?start=${dateStr}&end=${dateStr}`)
      let targetJobId: string | null = null

      if (existingJobsRes.ok) {
        const data = await existingJobsRes.json()
        const existingJobs = Array.isArray(data) ? data : (data.jobs || [])
        const matchingJob = existingJobs.find((j: { locationId: string; status: string; id: string }) => j.locationId === locationId && j.status !== 'CANCELLED')
        if (matchingJob) {
          targetJobId = matchingJob.id
        }
      }

      // No existing job on this date -- create a minimal container job
      if (!targetJobId) {
        const jobRes = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            subcontractorId: selectedSubcontractorId === 'unassigned' || selectedSubcontractorId.startsWith('vendor:') ? null : selectedSubcontractorId,
            date: dateStr,
            startTime: timeType === 'specific' && startTime ? startTime : null,
            startWindowBegin: timeType === 'window' && startWindowBegin ? startWindowBegin : null,
            startWindowEnd: timeType === 'window' && startWindowEnd ? startWindowEnd : null,
            clientRate: 0,
            subcontractorRate: 0,
            isTrial,
            trialNotes: isTrial ? (trialNotes.trim() || null) : null,
          }),
        })
        if (!jobRes.ok) throw new Error('Failed to create job')
        const newJob = await jobRes.json()
        targetJobId = newJob.id
      }

      // Attach the add-on service
      const isVendorAssignment = selectedSubcontractorId.startsWith('vendor:')
      const addonRes = await fetch('/api/add-on-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: targetJobId,
          description: addonDescription,
          clientRate: parseFloat(addonClientRate),
          subcontractorRate: parseFloat(addonCleanerPay || '0'),
          isRecurring: false,
          ...(isVendorAssignment ? { vendorId: selectedSubcontractorId.replace('vendor:', '') } : {}),
        }),
      })
      if (!addonRes.ok) {
        const err = await addonRes.json()
        throw new Error(err.error || 'Failed to add service')
      }

      handleClose()
      showSuccess(`${addonDescription} added!`)
      refreshCalendarData()
    } catch (error) {
      const { logger } = await import('@/lib/logger')
      logger.error('Error adding add-on service:', error)
      showError('Failed to add service. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const profit = clientRate && subcontractorRate 
    ? parseFloat(clientRate) - parseFloat(subcontractorRate) 
    : 0

  const addonProfit = addonClientRate && addonCleanerPay
    ? parseFloat(addonClientRate) - parseFloat(addonCleanerPay)
    : addonClientRate ? parseFloat(addonClientRate) : 0

  // Dynamic step labels
  const isAddonFlow = flowType === 'addon'
  const stepLabels = isAddonFlow ? ['Client', 'Add-On'] : ['Client', 'Details', 'Pricing']
  const totalSteps = isAddonFlow ? 2 : 3

  // Handle back navigation
  const handleBack = () => {
    if (step === 2 && flowType !== null) {
      setFlowType(null)
    } else if (step > 1) {
      setStep((s) => (s - 1) as 1 | 2 | 3)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent hideClose className="max-w-lg p-0 overflow-hidden flex flex-col max-h-[85vh] !left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2">
        {/* Header — white, clean */}
        <div
          className="px-5 py-4 bg-white shrink-0 relative"
          style={{ borderBottom: '1px solid #EEEEEE' }}
        >
          {/* Close button */}
          <button
            onClick={handleClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <X style={{ width: '16px', height: '16px', color: '#6B7280' }} />
          </button>

          {/* Title + date */}
          <div className="flex items-center gap-3 pr-10">
            <CalendarIcon className="w-5 h-5 shrink-0" style={{ color: '#00A896' }} />
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#111111', lineHeight: '1.2' }}>
                Schedule a Job
              </h2>
              {jobDate && (
                <p style={{ fontSize: '13px', color: '#888888', marginTop: '2px' }}>
                  {format(jobDate, 'EEE, MMM d, yyyy')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div
          className="px-6 py-4 bg-white shrink-0"
          style={{ borderBottom: '1px solid #EEEEEE' }}
        >
          <div className="flex items-start">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s, idx) => {
              const isCompleted = s < step
              const isCurrent = s === step
              const canClick = s === 1 || (s === 2 && canProceedStep1) || (s === 3 && canProceedStep1 && canProceedStep2)

              return (
                <Fragment key={s}>
                  {/* Connecting line before each step (except first) */}
                  {idx > 0 && (
                    <div
                      className="flex-1"
                      style={{
                        height: '2px',
                        marginTop: '13px',
                        backgroundColor: s <= step ? '#00A896' : '#EEEEEE',
                      }}
                    />
                  )}

                  {/* Circle + label */}
                  <button
                    onClick={() => canClick && goToStep(s as 1 | 2 | 3)}
                    disabled={!canClick}
                    className="flex flex-col items-center"
                    style={{ flexShrink: 0, cursor: canClick ? 'pointer' : 'default' }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: isCurrent || isCompleted ? '#00A896' : '#F5F5F5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isCompleted ? (
                        <Check className="w-3.5 h-3.5" style={{ color: 'white' }} />
                      ) : (
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: isCurrent ? 'white' : '#BBBBBB',
                            lineHeight: '1',
                          }}
                        >
                          {s}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: isCurrent || isCompleted ? 600 : 400,
                        color: isCurrent || isCompleted ? '#00A896' : '#BBBBBB',
                        marginTop: '6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stepLabels[s - 1]}
                    </span>
                  </button>
                </Fragment>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-white" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Step 1 — initial picker: one-time pinned + search pinned + client list scrolls */}
          {step === 1 && !clientType && (
            <>
              {/* ONE-TIME CLIENT — always visible, pinned at top */}
              <div className="shrink-0 px-5 pt-4">
                <button
                  onClick={() => setClientType('one-time')}
                  className="w-full flex items-center gap-3 text-left transition-all duration-150"
                  style={{
                    height: '56px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    border: '1px solid #EEEEEE',
                    backgroundColor: 'white',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.border = '1px solid #00A896'
                    e.currentTarget.style.backgroundColor = 'rgba(0,168,150,0.04)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.border = '1px solid #EEEEEE'
                    e.currentTarget.style.backgroundColor = 'white'
                  }}
                >
                  <UserPlus className="w-5 h-5 shrink-0" style={{ color: '#00A896' }} />
                  <div className="flex-1">
                    <p style={{ fontSize: '15px', fontWeight: 600, color: '#111111', lineHeight: '1.2' }}>
                      One-Time Client
                    </p>
                    <p style={{ fontSize: '12px', color: '#888888', marginTop: '1px' }}>
                      Move-outs, post-construction, etc.
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0" style={{ color: '#BBBBBB' }} />
                </button>
              </div>

              {/* "OR" DIVIDER — pinned */}
              <div className="shrink-0" style={{ padding: '10px 20px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '20px', right: '20px', top: '50%', height: '1px', backgroundColor: '#EEEEEE' }} />
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <span className="bg-white px-3" style={{ fontSize: '12px', color: '#BBBBBB' }}>or</span>
                </div>
              </div>

              {/* SEARCH — always visible, pinned */}
              <div className="shrink-0 px-5 pb-3">
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                    style={{ color: '#BBBBBB' }}
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter clients..."
                    className="w-full pl-10 pr-3 h-10 text-sm bg-white outline-none transition-all"
                    style={{
                      border: '1px solid #E0E0E0',
                      borderRadius: '8px',
                      color: '#111111',
                    }}
                    onFocus={e => {
                      e.currentTarget.style.border = '1px solid #00A896'
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,168,150,0.08)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.border = '1px solid #E0E0E0'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  />
                </div>
              </div>

              {/* CLIENT LIST — scrolls independently, fills remaining height */}
              <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2" style={{ minHeight: 0 }}>
                {filteredClients.length > 0 ? (
                  filteredClients.map(client => {
                    const isSelected = selectedClientId === client.id && clientType === 'existing'
                    return (
                      <button
                        key={client.id}
                        onClick={() => selectClient(client)}
                        className="w-full text-left flex items-center gap-3 transition-all duration-100"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid #00A896' : '1px solid #EEEEEE',
                          backgroundColor: isSelected ? 'rgba(0,168,150,0.08)' : 'white',
                        }}
                        onMouseEnter={e => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = '#F9F9F9'
                        }}
                        onMouseLeave={e => {
                          if (!isSelected) e.currentTarget.style.backgroundColor = 'white'
                        }}
                      >
                        <div
                          className="flex items-center justify-center shrink-0 font-semibold text-white"
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: '#00A896',
                            fontSize: '15px',
                          }}
                        >
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate"
                            style={{ fontSize: '15px', fontWeight: 500, color: '#111111', lineHeight: '1.3' }}
                          >
                            {client.name}
                          </p>
                          {client.locations?.length > 0 && (
                            <p style={{ fontSize: '13px', color: '#888888', lineHeight: '1.3' }}>
                              {client.locations.length} location{client.locations.length !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 shrink-0" style={{ color: '#BBBBBB' }} />
                      </button>
                    )
                  })
                ) : (
                  <div
                    className="text-center py-8"
                    style={{ fontSize: '14px', color: '#888888' }}
                  >
                    No clients found
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step 1 — existing client selected: location picker */}
          {step === 1 && clientType === 'existing' && selectedClientId && (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-3">
                {/* Selected client card */}
                <div
                  className="flex items-center gap-3"
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #00A896',
                    backgroundColor: 'rgba(0,168,150,0.06)',
                  }}
                >
                  <div
                    className="flex items-center justify-center shrink-0 font-semibold text-white"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: '#00A896',
                      fontSize: '15px',
                    }}
                  >
                    {selectedClient?.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{selectedClient?.name}</p>
                    <p style={{ fontSize: '12px', color: '#00A896' }}>
                      {locations.length} location{locations.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => { setSelectedClientId(''); setClientType(null); setSearchQuery(''); setSelectedLocationIds([]) }}
                    className="p-1 hover:bg-white/60 rounded transition-colors"
                    style={{ color: '#888888' }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Multi-location picker */}
                {locations.length > 1 && (
                  <div className="space-y-2">
                    <p style={{ fontSize: '14px', fontWeight: 500, color: '#111111' }}>Select location:</p>
                    <div className="space-y-2">
                      {locations.map((loc) => {
                        const isSelected = selectedLocationIds.includes(loc.id)
                        return (
                          <button
                            key={loc.id}
                            onClick={() => selectLocationAndAdvance(loc.id)}
                            className="w-full text-left flex items-center gap-3 transition-all"
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: isSelected ? '1px solid #00A896' : '1px solid #EEEEEE',
                              backgroundColor: isSelected ? 'rgba(0,168,150,0.06)' : 'white',
                            }}
                          >
                            <div
                              className="flex items-center justify-center shrink-0 transition-colors"
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                backgroundColor: isSelected ? '#00A896' : '#F5F5F5',
                              }}
                            >
                              {isSelected
                                ? <Check className="w-4 h-4" style={{ color: 'white' }} />
                                : <Building2 className="w-4 h-4" style={{ color: '#BBBBBB' }} />
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <p style={{ fontSize: '14px', fontWeight: 500, color: '#111111' }}>{loc.name}</p>
                              <p className="truncate" style={{ fontSize: '12px', color: '#888888' }}>{loc.address}</p>
                            </div>
                            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: isSelected ? '#00A896' : '#BBBBBB' }} />
                          </button>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => { setSelectedLocationIds(locations.map((l) => l.id)); setStep(2) }}
                      className="w-full py-2.5 px-3 text-sm font-medium rounded-lg transition-colors"
                      style={{ color: '#00A896', backgroundColor: 'rgba(0,168,150,0.06)', border: '1px solid rgba(0,168,150,0.2)' }}
                    >
                      Schedule for all {locations.length} locations →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 1 — one-time client form */}
          {step === 1 && clientType === 'one-time' && (
            <div className="flex-1 overflow-y-auto p-5">
              <div
                className="space-y-2"
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid #EEEEEE',
                  backgroundColor: 'white',
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4" style={{ color: '#00A896' }} />
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#111111' }}>One-Time Client</span>
                  </div>
                  <button
                    onClick={() => setClientType(null)}
                    className="p-1 rounded hover:bg-gray-100 transition-colors"
                    style={{ color: '#888888' }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Input value={oneTimeClientName} onChange={(e) => setOneTimeClientName(e.target.value)} placeholder="Client name *" className="h-9" />
                <Input value={oneTimeAddress} onChange={(e) => setOneTimeAddress(e.target.value)} placeholder="Full address *" className="h-9" />
                <Input value={oneTimePhone} onChange={(e) => setOneTimePhone(e.target.value)} placeholder="Phone (optional)" className="h-9" />
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ minHeight: 0 }}>
              {/* Intent picker -- shown when flowType not yet chosen */}
              {flowType === null && (
                <>
                  <h3 className="text-base font-semibold text-gray-900">What do you need?</h3>
                  <div className="grid gap-3">
                    {/* Extra Cleaning card */}
                    <button
                      onClick={() => setFlowType('cleaning')}
                      className="w-full p-4 rounded-xl bg-white border border-[#E5E5E5] hover:bg-[rgba(0,168,150,0.06)] hover:border-l-[3px] hover:border-l-teal-500 hover:pl-[13px] border-l-[3px] border-l-transparent transition-all text-left flex items-center gap-4 group"
                      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                    >
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors" style={{ backgroundColor: 'rgba(0,168,150,0.1)' }}>
                        <Sparkles className="w-6 h-6 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">Extra Cleaning Visit</p>
                        <p className="text-xs mt-0.5" style={{ color: '#888888' }}>Schedule an additional cleaning day</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-teal-500 transition-colors shrink-0" />
                    </button>

                    {/* Add-On Service card */}
                    <button
                      onClick={() => setFlowType('addon')}
                      className="w-full p-4 rounded-xl bg-white border border-[#E5E5E5] hover:bg-[rgba(0,168,150,0.06)] hover:border-l-[3px] hover:border-l-teal-500 hover:pl-[13px] border-l-[3px] border-l-transparent transition-all text-left flex items-center gap-4 group"
                      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                    >
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors" style={{ backgroundColor: 'rgba(0,168,150,0.1)' }}>
                        <PlusCircle className="w-6 h-6 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">Add-On Service</p>
                        <p className="text-xs mt-0.5" style={{ color: '#888888' }}>Window cleaning, carpet shampooing, etc.</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-teal-500 transition-colors shrink-0" />
                    </button>
                  </div>
                </>
              )}

              {/* Cleaning flow form */}
              {flowType === 'cleaning' && (
                <>
                  {/* Location summary */}
                  {clientType === 'existing' && selectedLocationIds.length > 0 && (
                    <div className="p-2 bg-teal-50 border border-teal-200 rounded-lg flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-teal-600 shrink-0" />
                      <span className="text-teal-800 font-medium">
                        {selectedLocationIds.length === 1 
                          ? locations.find((l) => l.id === selectedLocationIds[0])?.name || 'Location'
                          : `${selectedLocationIds.length} locations selected`
                        }
                      </span>
                    </div>
                  )}
                  {clientType === 'one-time' && oneTimeAddress && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="text-amber-800 font-medium truncate">{oneTimeAddress}</span>
                    </div>
                  )}

                  {/* Type of clean -- dropdown */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-1.5 block">Type of clean</Label>
                    <Select value={jobType} onValueChange={(v) => setJobType(v as JobType)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_TYPE_OPTIONS.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Date */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-1.5 block">Date</Label>
                    <Input
                      type="date"
                      value={jobDate ? format(jobDate, 'yyyy-MM-dd') : ''}
                      onChange={(e) => setJobDate(new Date(e.target.value))}
                      className="h-9"
                    />
                  </div>
                  
                  {/* Time */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                      <Clock className="w-4 h-4" />
                      Arrival time
                    </Label>
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => setTimeType('specific')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                          timeType === 'specific' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        Exact Time
                      </button>
                      <button
                        onClick={() => setTimeType('window')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                          timeType === 'window' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        Time Window
                      </button>
                    </div>
                    {timeType === 'specific' ? (
                      <TimePicker value={startTime} onChange={setStartTime} />
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-stone-500">From</span>
                          <TimePicker value={startWindowBegin} onChange={setStartWindowBegin} />
                        </div>
                        <div>
                          <span className="text-[10px] text-stone-500">To</span>
                          <TimePicker value={startWindowEnd} onChange={setStartWindowEnd} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Trial clean toggle */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-amber-900">Trial clean</p>
                        <p className="text-xs text-amber-800/80 mt-0.5">Visual badge only. No billing changes.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isTrial}
                        onChange={(e) => {
                          const next = e.target.checked
                          setIsTrial(next)
                          if (!next) setTrialNotes('')
                        }}
                        style={{ width: '16px', height: '16px', accentColor: '#D97706' }}
                      />
                    </div>
                    {isTrial && (
                      <div className="mt-2">
                        <Label className="text-xs text-amber-900/80 mb-1 block">Trial notes (optional)</Label>
                        <textarea
                          value={trialNotes}
                          onChange={(e) => setTrialNotes(e.target.value)}
                          placeholder="Entry details, expectations, special prep…"
                          rows={2}
                          className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none resize-none"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Add-on flow form -- everything on one screen */}
              {flowType === 'addon' && (
                <>
                  {/* Location summary */}
                  {clientType === 'existing' && selectedLocationIds.length > 0 && (
                    <div className="p-2 bg-violet-50 border border-violet-200 rounded-lg flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-violet-600 shrink-0" />
                      <span className="text-violet-800 font-medium">
                        {selectedClient?.name} — {locations.find((l) => l.id === selectedLocationIds[0])?.name || 'Location'}
                      </span>
                    </div>
                  )}

                  {/* Date */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-1.5 block">Date</Label>
                    <Input
                      type="date"
                      value={jobDate ? format(jobDate, 'yyyy-MM-dd') : ''}
                      onChange={(e) => setJobDate(new Date(e.target.value))}
                      className="h-9"
                    />
                  </div>

                  {/* Service description */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-1.5 block">What service?</Label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {['Beds/Laundry', 'Window Cleaning', 'Carpet Shampooing', 'Deep Clean'].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAddonDescription(addonDescription === preset ? '' : preset)}
                          className="text-xs font-medium px-2.5 py-1 rounded-full border transition-colors"
                          style={{
                            backgroundColor: addonDescription === preset ? '#0F766E' : '#F9FAFB',
                            color: addonDescription === preset ? 'white' : '#4B5563',
                            borderColor: addonDescription === preset ? '#0F766E' : '#E5E7EB',
                          }}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={addonDescription}
                      onChange={(e) => setAddonDescription(e.target.value)}
                      placeholder="e.g. Window cleaning, carpet shampooing"
                      className="h-9"
                    />
                  </div>

                  {/* Pricing */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">Client pays *</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={addonClientRate}
                          onChange={(e) => setAddonClientRate(e.target.value)}
                          placeholder="0.00"
                          className="pl-8 h-9"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">Cleaner pay</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={addonCleanerPay}
                          onChange={(e) => setAddonCleanerPay(e.target.value)}
                          placeholder="0.00"
                          className="pl-8 h-9"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Profit preview */}
                  {addonClientRate && (
                    <div className={`p-3 rounded-lg border ${addonProfit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Your Profit</span>
                        <span className={`text-xl font-bold ${addonProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          ${addonProfit.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Assignment */}
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Assign to</Label>
                    <Select value={selectedSubcontractorId} onValueChange={setSelectedSubcontractorId}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">
                          <span className="text-amber-600">Leave unassigned</span>
                        </SelectItem>
                        {activeSubcontractors.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">Cleaners</div>
                            {activeSubcontractors.map(sub => (
                              <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                            ))}
                          </>
                        )}
                        {vendors.filter(v => v.isActive !== false).length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">Vendors</div>
                            {vendors.filter(v => v.isActive !== false).map(v => (
                              <SelectItem key={`vendor:${v.id}`} value={`vendor:${v.id}`}>{v.name}</SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Time (optional, collapsed) */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                      <Clock className="w-4 h-4" />
                      Arrival time (optional)
                    </Label>
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => setTimeType('specific')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                          timeType === 'specific' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        Exact Time
                      </button>
                      <button
                        onClick={() => setTimeType('window')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                          timeType === 'window' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
                        }`}
                      >
                        Time Window
                      </button>
                    </div>
                    {timeType === 'specific' ? (
                      <TimePicker value={startTime} onChange={setStartTime} />
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-stone-500">From</span>
                          <TimePicker value={startWindowBegin} onChange={setStartWindowBegin} />
                        </div>
                        <div>
                          <span className="text-[10px] text-stone-500">To</span>
                          <TimePicker value={startWindowEnd} onChange={setStartWindowEnd} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Trial clean toggle */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-amber-900">Trial clean</p>
                        <p className="text-xs text-amber-800/80 mt-0.5">If we create a container job, it’ll be marked TRIAL.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isTrial}
                        onChange={(e) => {
                          const next = e.target.checked
                          setIsTrial(next)
                          if (!next) setTrialNotes('')
                        }}
                        style={{ width: '16px', height: '16px', accentColor: '#D97706' }}
                      />
                    </div>
                    {isTrial && (
                      <div className="mt-2">
                        <Label className="text-xs text-amber-900/80 mb-1 block">Trial notes (optional)</Label>
                        <textarea
                          value={trialNotes}
                          onChange={(e) => setTrialNotes(e.target.value)}
                          placeholder="Entry details, expectations, special prep…"
                          rows={2}
                          className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none resize-none"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 3: Pricing (cleaning flow only) */}
          {step === 3 && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ minHeight: 0 }}>
              <h3 className="text-base font-semibold text-gray-900">Pricing & Assignment</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Charging client *</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={clientRate}
                      onChange={(e) => setClientRate(e.target.value)}
                      placeholder="0.00"
                      className="pl-8 h-9"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Paying cleaner *</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={subcontractorRate}
                      onChange={(e) => setSubcontractorRate(e.target.value)}
                      placeholder="0.00"
                      className="pl-8 h-9"
                    />
                  </div>
                </div>
              </div>
              
              {clientRate && subcontractorRate && (
                <div className={`p-3 rounded-lg border ${profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Your Profit</span>
                    <span className={`text-xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      ${profit.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">Assign to</Label>
                <Select value={selectedSubcontractorId} onValueChange={setSelectedSubcontractorId}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">
                      <span className="text-amber-600">Leave unassigned</span>
                    </SelectItem>
                    {activeSubcontractors.map(sub => (
                      <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between shrink-0 bg-white"
          style={{ padding: '16px 20px', borderTop: '1px solid #EEEEEE' }}
        >
          {/* Left: Cancel (step 1) or Back (step 2+) */}
          {step > 1 ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-1 transition-colors"
              style={{ fontSize: '14px', color: '#5F6368', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <button
              onClick={handleClose}
              style={{ fontSize: '14px', color: '#5F6368', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          )}

          {/* Right: Continue / Submit */}
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              style={{
                height: '44px',
                padding: '0 16px',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                color: 'white',
                backgroundColor: canProceedStep1 ? '#00A896' : '#BBBBBB',
                border: 'none',
                cursor: canProceedStep1 ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={e => { if (canProceedStep1) e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { if (canProceedStep1) e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              Continue →
            </button>
          )}

          {step === 2 && flowType === null && <div />}

          {step === 2 && flowType === 'cleaning' && (
            <button
              onClick={() => setStep(3)}
              disabled={!canProceedStep2}
              style={{
                height: '44px',
                padding: '0 16px',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                color: 'white',
                backgroundColor: canProceedStep2 ? '#00A896' : '#BBBBBB',
                border: 'none',
                cursor: canProceedStep2 ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={e => { if (canProceedStep2) e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { if (canProceedStep2) e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              Continue →
            </button>
          )}

          {step === 2 && flowType === 'addon' && (
            <button
              onClick={handleAddonSubmit}
              disabled={loading || !canSubmitAddon}
              style={{
                height: '44px',
                padding: '0 16px',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                color: 'white',
                backgroundColor: !loading && canSubmitAddon ? '#00A896' : '#BBBBBB',
                border: 'none',
                cursor: !loading && canSubmitAddon ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={e => { if (!loading && canSubmitAddon) e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { if (!loading && canSubmitAddon) e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              {loading ? 'Adding...' : 'Add Service'}
            </button>
          )}

          {step === 3 && (
            <button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              style={{
                height: '44px',
                padding: '0 16px',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                color: 'white',
                backgroundColor: !loading && canSubmit ? '#00A896' : '#BBBBBB',
                border: 'none',
                cursor: !loading && canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={e => { if (!loading && canSubmit) e.currentTarget.style.backgroundColor = '#008F7E' }}
              onMouseLeave={e => { if (!loading && canSubmit) e.currentTarget.style.backgroundColor = '#00A896' }}
            >
              {loading ? 'Scheduling...' : 'Schedule Job'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
