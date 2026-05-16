"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { logger } from "@/lib/logger"
import { generateInvoiceSubject, getDefaultEmailMessage } from "@/lib/email-templates"

function mergeUniqueEmails(...candidates: (string | null | undefined | string[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const flat = candidates.flatMap((c) => (Array.isArray(c) ? c : c ? [c] : []))
  for (const raw of flat) {
    const t = raw.trim()
    if (!t) continue
    const low = t.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(low)) continue
    if (seen.has(low)) continue
    seen.add(low)
    out.push(t)
  }
  return out
}

export interface LineItemDraft {
  id: string
  jobId: string | null
  description: string
  amount: number
  serviceDate: Date | null
  isEditing?: boolean
}

export interface QuickInvoiceClient {
  id: string
  name: string
  billingType: string
  invoicingEmail?: string | null
  communicationEmail?: string | null
}

export type QuickInvoiceJob = {
  id: string
  date: string | Date
  clientRate: number
  scheduleId: string | null
  status: string
  location: {
    name: string
  }
  addOnServices?: Array<{
    id: string
    description: string
    clientRate: number
  }>
  schedule?: {
    defaultClientRate?: number | null
    startDate?: string | Date | null
    recurringAddOnServices?: Array<{
      id: string
      description: string
      clientRate: number
    }>
  } | null
}

interface UseQuickInvoiceOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: QuickInvoiceClient
  jobs: QuickInvoiceJob[]
  initialMonth?: string
  onSuccess?: () => void
  onNext?: () => void
  onPrevious?: () => void
  currentIndex?: number
  totalCount?: number
  batchMode?: boolean
}

export function useQuickInvoice({
  open,
  onOpenChange,
  client,
  jobs,
  initialMonth,
  onSuccess,
  onNext,
  onPrevious,
  currentIndex,
  totalCount,
  batchMode,
}: UseQuickInvoiceOptions) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null)
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null)
  const [netTerms, setNetTerms] = useState('net-7')
  const [dateDue, setDateDue] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([])
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressStep, setProgressStep] = useState('')
  const autoPreviewSignature = useRef<string | null>(null)
  
  // Email fields — "To" supports multiple recipients (invoice API accepts string | string[])
  const [recipientPool, setRecipientPool] = useState<string[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([])
  const [manualEmailInput, setManualEmailInput] = useState('')
  const [emailCc, setEmailCc] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [showPaymentOptions, setShowPaymentOptions] = useState(true)
  const [showSendConfirmation, setShowSendConfirmation] = useState(false)

  // Collapsible sections (jobs expanded by default)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['jobs']))
  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])
  const isSectionExpanded = useCallback((section: string) => expandedSections.has(section), [expandedSections])

  // Job selection for the job picker
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() => new Set(jobs.map(j => j.id)))
  const isInitialJobRender = useRef(true)

  // Location grouping collapse/expand
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())

  // Auto-scroll the active month pill into view using a callback ref
  const activeMonthPillRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ inline: 'center', block: 'nearest' })
      })
    }
  }, [])

  // Month pills + date range filter
  const defaultMonth = useMemo(() => {
    if (initialMonth) return initialMonth
    const currentMonth = format(new Date(), 'yyyy-MM')
    const hasCurrentMonth = jobs.some(j => j.status !== 'CANCELLED' && format(new Date(j.date), 'yyyy-MM') === currentMonth)
    return hasCurrentMonth ? currentMonth : 'all'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [activeMonth, setActiveMonth] = useState<string>(defaultMonth)
  const [dateFrom, setDateFrom] = useState(() => {
    if (defaultMonth !== 'all') {
      const [year, mo] = defaultMonth.split('-').map(Number)
      return format(startOfMonth(new Date(year, mo - 1)), 'yyyy-MM-dd')
    }
    return ''
  })
  const [dateTo, setDateTo] = useState(() => {
    if (defaultMonth !== 'all') {
      const [year, mo] = defaultMonth.split('-').map(Number)
      return format(endOfMonth(new Date(year, mo - 1)), 'yyyy-MM-dd')
    }
    return ''
  })
  const [showCustomDates, setShowCustomDates] = useState(false)

  // Derive available months from jobs
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    jobs.forEach(j => {
      if (j.status !== 'CANCELLED') {
        months.add(format(new Date(j.date), 'yyyy-MM'))
      }
    })
    return Array.from(months).sort().reverse()
  }, [jobs])

  // Jobs filtered by date range
  const filteredJobs = useMemo(() => {
    let filtered = jobs.filter(j => j.status !== 'CANCELLED')
    if (dateFrom) {
      const fromTime = new Date(dateFrom + 'T00:00:00').getTime()
      filtered = filtered.filter(j => new Date(j.date).getTime() >= fromTime)
    }
    if (dateTo) {
      const toTime = new Date(dateTo + 'T23:59:59').getTime()
      filtered = filtered.filter(j => new Date(j.date).getTime() <= toTime)
    }
    return filtered
  }, [jobs, dateFrom, dateTo])

  const getMonthJobs = useCallback((month: string) => {
    if (month === 'all') return jobs.filter(j => j.status !== 'CANCELLED')
    const [year, mo] = month.split('-').map(Number)
    const monthStart = startOfMonth(new Date(year, mo - 1))
    const monthEnd = endOfMonth(new Date(year, mo - 1))
    return jobs.filter(j => {
      if (j.status === 'CANCELLED') return false
      const time = new Date(j.date).getTime()
      return time >= monthStart.getTime() && time <= monthEnd.getTime()
    })
  }, [jobs])

  const getFlatRatePeriodStart = useCallback((scheduleJobs: QuickInvoiceJob[]) => {
    const firstJob = scheduleJobs[0]
    const firstJobDate = firstJob ? new Date(firstJob.date) : new Date()
    const scheduleStart = firstJob?.schedule?.startDate ? new Date(firstJob.schedule.startDate) : null
    const periodStart = dateFrom ? new Date(dateFrom + 'T00:00:00') : startOfMonth(firstJobDate)
    return scheduleStart && scheduleStart > periodStart ? scheduleStart : periodStart
  }, [dateFrom])

  const getFlatRatePeriodLabel = useCallback((scheduleJobs: QuickInvoiceJob[]) => {
    const periodStart = getFlatRatePeriodStart(scheduleJobs)
    const firstJob = scheduleJobs[0]
    const endDate = dateTo ? new Date(dateTo + 'T23:59:59') : endOfMonth(firstJob ? new Date(firstJob.date) : periodStart)
    return `${format(periodStart, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`
  }, [dateTo, getFlatRatePeriodStart])

  // Computed data for flat-rate clients
  const flatRateData = useMemo(() => {
    if (client.billingType !== 'FLAT_RATE') return null
    const recurringJobs = filteredJobs.filter(j => j.scheduleId !== null)
    const oneOffJobs = filteredJobs.filter(j => j.scheduleId === null)
    const scheduleRates = new Map<string, number>()
    recurringJobs.forEach(j => {
      const sid = j.scheduleId!
      if (!scheduleRates.has(sid)) {
        scheduleRates.set(sid, j.schedule?.defaultClientRate ?? j.clientRate)
      }
    })
    const monthlyRate = Array.from(scheduleRates.values()).reduce((sum, r) => sum + r, 0)
    const completedCount = recurringJobs.filter(j => j.status === 'COMPLETED').length
    return { recurringJobs, oneOffJobs, monthlyRate, completedCount, totalCount: recurringJobs.length }
  }, [client.billingType, filteredJobs])

  // Group recurring jobs by location (flat-rate)
  const recurringLocationGroups = useMemo(() => {
    if (!flatRateData) return []
    const groupMap = new Map<string, typeof flatRateData.recurringJobs>()
    flatRateData.recurringJobs.forEach(job => {
      const loc = job.location.name
      if (!groupMap.has(loc)) groupMap.set(loc, [])
      groupMap.get(loc)!.push(job)
    })
    return Array.from(groupMap.entries()).map(([locationName, locJobs]) => ({
      locationName,
      jobs: locJobs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      completedCount: locJobs.filter(j => j.status === 'COMPLETED').length,
    }))
  }, [flatRateData])

  // Group filtered jobs by location (per-clean)
  const perCleanLocationGroups = useMemo(() => {
    if (client.billingType === 'FLAT_RATE') return []
    const groupMap = new Map<string, typeof filteredJobs>()
    filteredJobs.forEach(job => {
      const loc = job.location.name
      if (!groupMap.has(loc)) groupMap.set(loc, [])
      groupMap.get(loc)!.push(job)
    })
    return Array.from(groupMap.entries()).map(([locationName, locJobs]) => ({
      locationName,
      jobs: locJobs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      totalAmount: locJobs.reduce((sum, j) => sum + j.clientRate, 0),
      selectedCount: locJobs.filter(j => selectedJobIds.has(j.id)).length,
      selectedAmount: locJobs.filter(j => selectedJobIds.has(j.id)).reduce((sum, j) => sum + j.clientRate, 0),
    }))
  }, [client.billingType, filteredJobs, selectedJobIds])

  // Auto-expand locations with fewer than 4 cleans
  useEffect(() => {
    const groups = client.billingType === 'FLAT_RATE' ? recurringLocationGroups : perCleanLocationGroups
    const autoExpand = new Set<string>()
    groups.forEach(g => {
      if (g.jobs.length < 4) autoExpand.add(g.locationName)
    })
    setExpandedLocations(autoExpand)
  }, [recurringLocationGroups, perCleanLocationGroups, client.billingType])

  // When date filter changes, select all jobs in the filtered range
  const dateFilterRef = useRef({ dateFrom: '', dateTo: '' })
  useEffect(() => {
    if (dateFilterRef.current.dateFrom !== dateFrom || dateFilterRef.current.dateTo !== dateTo) {
      dateFilterRef.current = { dateFrom, dateTo }
      if (dateFrom || dateTo) {
        setSelectedJobIds(new Set(filteredJobs.map(j => j.id)))
      }
    }
  }, [dateFrom, dateTo, filteredJobs])

  // Handle month pill click
  const handleMonthSelect = useCallback((month: string) => {
    setActiveMonth(month)
    setShowCustomDates(false)
    if (month === 'all') {
      setDateFrom('')
      setDateTo('')
      setSelectedJobIds(new Set(jobs.filter(j => j.status !== 'CANCELLED').map(j => j.id)))
    } else {
      const [year, mo] = month.split('-').map(Number)
      const monthStart = startOfMonth(new Date(year, mo - 1))
      const monthEnd = endOfMonth(new Date(year, mo - 1))
      setDateFrom(format(monthStart, 'yyyy-MM-dd'))
      setDateTo(format(monthEnd, 'yyyy-MM-dd'))
    }
  }, [jobs])

  const handleCustomDates = useCallback(() => {
    setActiveMonth('custom')
    setShowCustomDates(true)
  }, [])

  const clearDateFilter = useCallback(() => {
    setActiveMonth('all')
    setShowCustomDates(false)
    setDateFrom('')
    setDateTo('')
    setSelectedJobIds(new Set(jobs.filter(j => j.status !== 'CANCELLED').map(j => j.id)))
  }, [jobs])

  const toggleJob = useCallback((jobId: string) => {
    if (client.billingType === 'FLAT_RATE') {
      const job = jobs.find(j => j.id === jobId)
      if (job && job.scheduleId !== null) return
    }
    setSelectedJobIds(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }, [client.billingType, jobs])

  const toggleAllJobs = useCallback(() => {
    setSelectedJobIds(prev => {
      const validJobs = filteredJobs
      if (prev.size === validJobs.length) return new Set()
      return new Set(validJobs.map(j => j.id))
    })
  }, [filteredJobs])

  const toggleLocationExpand = useCallback((locationName: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev)
      if (next.has(locationName)) next.delete(locationName)
      else next.add(locationName)
      return next
    })
  }, [])

  const toggleLocationJobs = useCallback((locationName: string) => {
    const group = perCleanLocationGroups.find(g => g.locationName === locationName)
    if (!group) return
    const allSelected = group.jobs.every(j => selectedJobIds.has(j.id))
    setSelectedJobIds(prev => {
      const next = new Set(prev)
      group.jobs.forEach(j => {
        if (allSelected) next.delete(j.id)
        else next.add(j.id)
      })
      return next
    })
  }, [perCleanLocationGroups, selectedJobIds])

  // Net terms options
  const netTermsOptions = [
    { value: 'due-on-receipt', label: 'Due on Receipt', days: 0 },
    { value: 'net-7', label: 'Net 7', days: 7 },
    { value: 'net-15', label: 'Net 15', days: 15 },
    { value: 'net-30', label: 'Net 30', days: 30 },
    { value: 'net-45', label: 'Net 45', days: 45 },
    { value: 'net-60', label: 'Net 60', days: 60 },
    { value: 'custom', label: 'Custom', days: null as number | null },
  ]

  // Generate line items based on client billing type
  const generateLineItems = (jobsToUse?: typeof jobs): LineItemDraft[] => {
    const validJobs = (jobsToUse || jobs).filter(j => j.status !== 'CANCELLED')

    if (client.billingType === 'FLAT_RATE') {
      const recurringJobs = validJobs.filter(j => j.scheduleId !== null)
      const oneOffJobs = validJobs.filter(j => j.scheduleId === null)
      const items: LineItemDraft[] = []

      if (recurringJobs.length > 0) {
        const jobsByScheduleMonth = new Map<string, typeof recurringJobs>()
        recurringJobs.forEach(job => {
          const scheduleId = job.scheduleId || 'no-schedule'
          const monthKey = format(new Date(job.date), 'yyyy-MM')
          const key = `${scheduleId}:${monthKey}`
          if (!jobsByScheduleMonth.has(key)) jobsByScheduleMonth.set(key, [])
          jobsByScheduleMonth.get(key)!.push(job)
        })

        jobsByScheduleMonth.forEach((scheduleJobs) => {
          if (scheduleJobs.length > 0) {
            const firstJob = scheduleJobs[0]
            const jobDate = getFlatRatePeriodStart(scheduleJobs)
            const monthKey = format(jobDate, 'yyyy-MM')
            const periodLabel = getFlatRatePeriodLabel(scheduleJobs)
            const locationName = firstJob.location?.name || 'Unknown Location'
            const monthlyRate = firstJob.schedule?.defaultClientRate ?? firstJob.clientRate

            items.push({
              id: `recurring-${firstJob.scheduleId || 'no-schedule'}-${monthKey}-${Date.now()}`,
              jobId: firstJob.id,
              description: `Monthly Cleaning - ${locationName} - ${periodLabel}`,
              amount: monthlyRate,
              serviceDate: jobDate,
            })

            const recurringAddOns = firstJob.schedule?.recurringAddOnServices || []
            recurringAddOns.forEach(addOn => {
              items.push({
                id: `schedule-addon-${addOn.id}-${monthKey}-${Date.now()}`,
                jobId: firstJob.id,
                description: `${addOn.description} (recurring) - ${periodLabel}`,
                amount: addOn.clientRate,
                serviceDate: jobDate,
              })
            })

            scheduleJobs.forEach(job => {
              ;(job.addOnServices || []).forEach(addOn => {
                items.push({
                  id: `addon-${addOn.id}-${Date.now()}`,
                  jobId: job.id,
                  description: `${addOn.description} - ${format(new Date(job.date), 'MMMM d, yyyy')}`,
                  amount: addOn.clientRate,
                  serviceDate: new Date(job.date),
                })
              })
            })
          }
        })
      }

      oneOffJobs.forEach((job, idx) => {
        const jobDate = new Date(job.date)
        if (job.clientRate > 0) {
          items.push({
            id: `oneoff-${idx}-${Date.now()}`,
            jobId: job.id,
            description: `Additional Service - ${job.location.name} - ${format(jobDate, 'MMMM d, yyyy')}`,
            amount: job.clientRate,
            serviceDate: jobDate,
          })
        }
        ;(job.addOnServices || []).forEach(addOn => {
          items.push({
            id: `addon-${addOn.id}-${Date.now()}`,
            jobId: job.id,
            description: `${addOn.description} - ${format(jobDate, 'MMMM d, yyyy')}`,
            amount: addOn.clientRate,
            serviceDate: jobDate,
          })
        })
      })

      return items
    } else {
      const items: LineItemDraft[] = []
      validJobs.forEach((job, idx) => {
        const jobDate = new Date(job.date)
        items.push({
          id: `job-${idx}-${Date.now()}`,
          jobId: job.id,
          description: `Cleaning - ${job.location.name} - ${format(jobDate, 'MMMM d, yyyy')}`,
          amount: job.clientRate,
          serviceDate: jobDate,
        })
        ;(job.addOnServices || []).forEach(addOn => {
          items.push({
            id: `addon-${addOn.id}-${Date.now()}`,
            jobId: job.id,
            description: `${addOn.description} - ${format(jobDate, 'MMMM d, yyyy')}`,
            amount: addOn.clientRate,
            serviceDate: jobDate,
          })
        })
      })
      return items
    }
  }

  // Initialize line items, date filter, and due date when modal opens
  useEffect(() => {
    if (open && jobs.length > 0) {
      let month = initialMonth && initialMonth !== 'all' ? initialMonth : 'all'
      if (client.billingType === 'FLAT_RATE' && month === 'all') {
        const validMonths = new Set<string>()
        jobs.forEach(j => {
          if (j.status !== 'CANCELLED') validMonths.add(format(new Date(j.date), 'yyyy-MM'))
        })
        const sorted = Array.from(validMonths).sort()
        if (sorted.length > 0) month = sorted[sorted.length - 1]
      }
      setActiveMonth(month)
      setShowCustomDates(false)
      const initialJobs = getMonthJobs(month)
      if (month !== 'all') {
        const [year, mo] = month.split('-').map(Number)
        const monthStart = startOfMonth(new Date(year, mo - 1))
        const monthEnd = endOfMonth(new Date(year, mo - 1))
        setDateFrom(format(monthStart, 'yyyy-MM-dd'))
        setDateTo(format(monthEnd, 'yyyy-MM-dd'))
      } else {
        setDateFrom('')
        setDateTo('')
      }
      setSelectedJobIds(new Set(initialJobs.map(j => j.id)))
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 7)
      setDateDue(format(dueDate, 'yyyy-MM-dd'))
      const generatedItems = generateLineItems(initialJobs)
      setLineItems(generatedItems)
      setCreatedInvoiceId(null)
      setPreviewInvoiceId(null)
      setPreviewPdfUrl(null)
      autoPreviewSignature.current = null
      const basePool = mergeUniqueEmails(client.invoicingEmail, client.communicationEmail)
      setRecipientPool(basePool)
      const firstTo = client.invoicingEmail?.trim() || client.communicationEmail?.trim() || basePool[0] || ''
      setSelectedRecipients(firstTo ? [firstTo.trim()] : [])
      setManualEmailInput('')
      setEmailCc('')
      setEmailSubject('Invoice from Clean Freaks')
      const totalAmountStr = formatCurrency(generatedItems.reduce((sum, item) => sum + item.amount, 0))
      const dueDateStr = dueDate ? format(dueDate, 'MMMM d, yyyy') : null
      setEmailMessage(getDefaultEmailMessage({ totalAmount: totalAmountStr, dueDate: dueDateStr }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobs, client.billingType, client.invoicingEmail, client.communicationEmail, client.id, initialMonth, getMonthJobs])

  // Merge saved client contacts into recipient suggestions when the modal opens
  useEffect(() => {
    if (!open || !client.id) return
    let cancelled = false
    fetch(`/api/clients/${client.id}/contacts`)
      .then((r) => (r.ok ? r.json() : { contacts: [] }))
      .then((data: { contacts?: Array<{ email?: string | null }> }) => {
        if (cancelled) return
        const extras = (data.contacts || []).map((c) => c.email).filter(Boolean) as string[]
        setRecipientPool((prev) => mergeUniqueEmails(prev, extras))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, client.id])

  // Regenerate line items when job selection changes (not on initial mount)
  useEffect(() => {
    if (isInitialJobRender.current) {
      isInitialJobRender.current = false
      return
    }
    const filtered = jobs.filter(j => selectedJobIds.has(j.id))
    const items = generateLineItems(filtered)
    setLineItems(items)
    const totalAmountStr = formatCurrency(items.reduce((sum, item) => sum + item.amount, 0))
    const dueDate = dateDue ? new Date(dateDue + 'T12:00:00') : null
    setEmailMessage(getDefaultEmailMessage({
      totalAmount: totalAmountStr,
      dueDate: dueDate ? format(dueDate, 'MMMM d, yyyy') : null,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobIds])

  // Invalidate preview when line items change (after initial load)
  const lineItemsInitialized = useRef(false)
  useEffect(() => {
    if (!lineItemsInitialized.current) {
      lineItemsInitialized.current = true
      return
    }
    // Line items changed — old preview is stale
    if (previewInvoiceId) {
      setPreviewInvoiceId(null)
      setPreviewPdfUrl(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems])

  // Calculate total
  const totalAmount = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.amount, 0)
  }, [lineItems])

  // Handle net terms change
  const handleNetTermsChange = (value: string) => {
    setNetTerms(value)
    const option = netTermsOptions.find(o => o.value === value)
    if (option && option.days !== null) {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + option.days)
      setDateDue(format(dueDate, 'yyyy-MM-dd'))
    }
  }

  // Handle line item edit
  const startEditing = (id: string) => {
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, isEditing: true } : item
    ))
  }

  const saveEdit = (id: string) => {
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, isEditing: false } : item
    ))
  }

  const updateLineItem = (id: string, field: 'description' | 'amount', value: string | number) => {
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ))
  }

  const removeLineItem = (id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id))
  }

  const addLineItem = () => {
    const newItem: LineItemDraft = {
      id: `custom-${Date.now()}`,
      jobId: null,
      description: '',
      amount: 0,
      serviceDate: new Date(),
      isEditing: true,
    }
    setLineItems(prev => [...prev, newItem])
  }

  const getInvoiceJobIds = useCallback(() => {
    const sourceIds = new Set<string>()
    lineItems.forEach((item) => {
      if (!item.jobId) return
      const linkedJob = jobs.find(j => j.id === item.jobId)
      if (client.billingType === 'FLAT_RATE' && linkedJob?.scheduleId) {
        const monthKey = format(new Date(linkedJob.date), 'yyyy-MM')
        jobs.forEach((job) => {
          if (
            job.status !== 'CANCELLED' &&
            selectedJobIds.has(job.id) &&
            job.scheduleId === linkedJob.scheduleId &&
            format(new Date(job.date), 'yyyy-MM') === monthKey
          ) {
            sourceIds.add(job.id)
          }
        })
      } else {
        sourceIds.add(item.jobId)
      }
    })
    return Array.from(sourceIds)
  }, [client.billingType, jobs, lineItems, selectedJobIds])

  const serializeLineItemsForApi = useCallback(() => (
    lineItems.map(item => ({
      description: item.description,
      amount: item.amount,
      jobId: item.jobId,
      serviceDate: item.serviceDate ? item.serviceDate.toISOString() : new Date().toISOString(),
    }))
  ), [lineItems])

  const toggleRecipient = useCallback((email: string) => {
    const low = email.toLowerCase()
    setSelectedRecipients((prev) => {
      if (prev.some((p) => p.toLowerCase() === low)) {
        return prev.filter((p) => p.toLowerCase() !== low)
      }
      return [...prev, email]
    })
  }, [])

  const addManualRecipient = useCallback(() => {
    const t = manualEmailInput.trim()
    if (!t) return
    const low = t.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(low)) return
    setRecipientPool((pool) => mergeUniqueEmails(pool, t))
    setSelectedRecipients((prev) => mergeUniqueEmails(prev, t))
    setManualEmailInput('')
  }, [manualEmailInput])

  // Create invoice
  const handleCreateInvoice = async (sendTest: boolean = false) => {
    if (sendTest) {
      setIsSendingTest(true)
    } else {
      setIsCreating(true)
    }
    try {
      let invoiceId = previewInvoiceId
      let invoice: { id: string; dateDue: string | null; invoiceNumber?: string; totalAmount?: number } | null = null

      if (invoiceId) {
        setProgress(20)
        setProgressStep('Finalizing invoice...')
        await fetch(`/api/invoices/${invoiceId}/finalize`, { method: 'POST' })
        setProgress(30)
        setProgressStep('Using existing invoice...')
        const existingResponse = await fetch(`/api/invoices/${invoiceId}`)
        if (existingResponse.ok) {
          invoice = await existingResponse.json()
        } else {
          invoiceId = null
        }
      }

      if (!invoiceId) {
        setProgress(10)
        setProgressStep('Creating invoice...')
        const response = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            jobIds: getInvoiceJobIds(),
            lineItems: serializeLineItemsForApi(),
            dateDue: dateDue || null,
            notes: notes || null,
            showPaymentOptions: showPaymentOptions,
            previewOnly: true,
          }),
        })
        if (!response.ok) {
          const { showApiError } = await import('@/lib/toast')
          await showApiError(response, 'Failed to create invoice. Please check that all required fields are filled.')
          return
        }
        invoice = await response.json()
        invoiceId = invoice!.id
        await fetch(`/api/invoices/${invoiceId}/finalize`, { method: 'POST' })
      }

      setProgress(40)
      setProgressStep('Generating PDF...')
      setCreatedInvoiceId(invoiceId!)
      setPreviewInvoiceId(invoiceId!)

      if (emailSubject === 'Invoice from Clean Freaks' || !emailSubject) {
        setEmailSubject(generateInvoiceSubject(invoice?.invoiceNumber || 'Invoice'))
      }

      const pdfResponse = await fetch(`/api/invoices/${invoiceId}/generate-pdf`, { method: 'POST' })
      if (pdfResponse.ok) {
        const pdfData = await pdfResponse.json()
        setPreviewPdfUrl(pdfData.pdfDataUrl || pdfData.pdfUrl)
        setProgress(70)
      } else {
        const { showError } = await import('@/lib/toast')
        showError('Invoice created but PDF generation failed. You can generate it later from the invoice page.')
      }

      if (sendTest) {
        setProgress(80)
        setProgressStep('Sending test email...')
        const emailResponse = await fetch(`/api/invoices/${invoiceId}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: selectedRecipients.length > 0 ? selectedRecipients : mergeUniqueEmails(client.invoicingEmail, client.communicationEmail),
            subject: emailSubject || generateInvoiceSubject(invoice?.invoiceNumber || 'Invoice'),
            message: emailMessage || getDefaultEmailMessage({
              totalAmount: formatCurrency(invoice?.totalAmount || totalAmount),
              dueDate: invoice?.dateDue ? format(new Date(invoice.dateDue), 'MMMM d, yyyy') : null,
            }),
            cc: emailCc || undefined,
            isTest: true,
          }),
        })
        if (emailResponse.ok) {
          setProgress(100)
          const emailResult = await emailResponse.json().catch(() => ({}))
          const { showSuccess, showWarning, showInfo } = await import('@/lib/toast')
          if (emailResult.safetyMode === 'FORCED_TEST' || emailResult.warning === 'SENDING_DISABLED') {
            showWarning('⚠️ Email was NOT sent. Set ENABLE_EMAIL_SENDING=true and configure GMAIL credentials in .env.local to enable email delivery.')
          } else if (emailResult.isTest) {
            showInfo(`Test email sent to ${emailResult.testEmail || 'your test address'}`)
          } else {
            showSuccess('Invoice created and test email sent!')
          }
        } else {
          const { showApiError } = await import('@/lib/toast')
          await showApiError(emailResponse, 'Invoice created but test email failed. Check your email settings.')
        }
      } else {
        setProgress(100)
        const { showSuccess } = await import('@/lib/toast')
        showSuccess('Invoice saved as draft!')
      }

      setTimeout(() => {
        onSuccess?.()
        onOpenChange(false)
        router.push(`/invoices/${invoiceId}`)
      }, 500)
    } catch (error) {
      logger.error('Error:', error)
      const { showError } = await import('@/lib/toast')
      showError(error instanceof Error ? error.message : 'Failed to create invoice. Please try again or contact support if the issue persists.')
    } finally {
      setIsCreating(false)
      setIsSendingTest(false)
      setProgress(0)
      setProgressStep('')
    }
  }

  // Send to client (real email)
  const handleSendToClient = async () => {
    if (selectedRecipients.length === 0 || !emailSubject || !emailMessage) {
      const { showError } = await import('@/lib/toast')
      showError('Please select at least one recipient and fill in subject and message')
      return
    }
    const { showInfo } = await import('@/lib/toast')
    showInfo('Note: Real client emails require ALLOW_REAL_CLIENT_EMAILS=true. Otherwise, email will go to test address.')
    setShowSendConfirmation(true)
  }

  // Actually send to client after confirmation
  const handleConfirmSendToClient = async () => {
    setShowSendConfirmation(false)
    setIsSendingTest(true)
    try {
      let invoiceId = previewInvoiceId
      let invoice: { id: string; dateDue: string | null; invoiceNumber?: string; totalAmount?: number } | null = null

      if (invoiceId) {
        setProgress(20)
        setProgressStep('Finalizing invoice...')
        await fetch(`/api/invoices/${invoiceId}/finalize`, { method: 'POST' })
        setProgress(30)
        setProgressStep('Using existing invoice...')
        const existingResponse = await fetch(`/api/invoices/${invoiceId}`)
        if (existingResponse.ok) {
          invoice = await existingResponse.json()
        } else {
          invoiceId = null
        }
      }

      if (!invoiceId) {
        setProgress(10)
        setProgressStep('Creating invoice...')
        const response = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            jobIds: getInvoiceJobIds(),
            lineItems: serializeLineItemsForApi(),
            dateDue: dateDue || null,
            notes: notes || null,
            showPaymentOptions: showPaymentOptions,
            previewOnly: true,
          }),
        })
        if (!response.ok) {
          const { showApiError } = await import('@/lib/toast')
          await showApiError(response, 'Failed to create invoice. Please check that all required fields are filled.')
          return
        }
        invoice = await response.json()
        invoiceId = invoice!.id
        await fetch(`/api/invoices/${invoiceId}/finalize`, { method: 'POST' })
      }

      setProgress(40)
      setProgressStep('Generating PDF...')
      setCreatedInvoiceId(invoiceId!)
      setPreviewInvoiceId(invoiceId!)

      if (emailSubject === 'Invoice from Clean Freaks' || !emailSubject) {
        setEmailSubject(generateInvoiceSubject(invoice?.invoiceNumber || 'Invoice'))
      }

      const pdfResponse = await fetch(`/api/invoices/${invoiceId}/generate-pdf`, { method: 'POST' })
      if (!pdfResponse.ok) {
        const { showError } = await import('@/lib/toast')
        showError('Invoice created but PDF generation failed. You can generate it later from the invoice page.')
        return
      }
      const pdfData = await pdfResponse.json()
      setPreviewPdfUrl(pdfData.pdfDataUrl || pdfData.pdfUrl)
      setProgress(70)

      setProgress(80)
      setProgressStep('Sending email to client...')
      const emailResponse = await fetch(`/api/invoices/${invoiceId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedRecipients,
          subject: emailSubject || generateInvoiceSubject(invoice?.invoiceNumber || 'Invoice'),
          message: emailMessage || getDefaultEmailMessage({
            totalAmount: formatCurrency(invoice?.totalAmount || totalAmount),
            dueDate: invoice?.dateDue ? format(new Date(invoice.dateDue), 'MMMM d, yyyy') : null,
          }),
          cc: emailCc || undefined,
          isTest: false,
        }),
      })

      if (emailResponse.ok) {
        setProgress(100)
        const emailResult = await emailResponse.json().catch(() => ({}))
        const { showSuccess, showWarning, showInfo } = await import('@/lib/toast')
        if (emailResult.safetyMode === 'FORCED_TEST' || emailResult.warning === 'SENDING_DISABLED') {
          showWarning('Email was NOT sent to the client. Email safety mode is on; configure production email settings to send real invoices.')
        } else if (emailResult.isTest) {
          showInfo(`Test email sent to ${emailResult.testEmail || 'your test address'}`)
        } else {
          showSuccess(`Invoice sent to ${selectedRecipients.join(', ')}`)
        }
      } else {
        const { showApiError } = await import('@/lib/toast')
        await showApiError(emailResponse, 'Invoice created but email failed. Check your email settings.')
      }

      setTimeout(() => {
        onSuccess?.()
        onOpenChange(false)
        router.push(`/invoices/${invoiceId}`)
      }, 500)
    } catch (error) {
      logger.error('Error:', error)
      const { showError } = await import('@/lib/toast')
      showError(error instanceof Error ? error.message : 'Failed to send invoice. Please try again or contact support if the issue persists.')
    } finally {
      setIsSendingTest(false)
      setProgress(0)
      setProgressStep('')
    }
  }

  const handleGeneratePreview = async (options?: { silent?: boolean }): Promise<boolean> => {
    if (lineItems.length === 0) {
      const { showError } = await import('@/lib/toast')
      showError('Please add at least one line item')
      return false
    }
    const invoiceJobIds = getInvoiceJobIds()
    if (invoiceJobIds.length === 0) {
      const { showError } = await import('@/lib/toast')
      showError('No jobs selected for this invoice')
      return false
    }
    setIsGeneratingPreview(true)
    try {
      if (previewInvoiceId) {
        await fetch(`/api/invoices/${previewInvoiceId}`, { method: 'DELETE' })
        setPreviewInvoiceId(null)
      }
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          jobIds: invoiceJobIds,
          lineItems: serializeLineItemsForApi(),
          dateDue: dateDue || null,
          notes: notes || null,
          status: 'DRAFT',
          showPaymentOptions: showPaymentOptions,
          previewOnly: true,
        }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        const errorMessage = errorData.error || `Failed to create invoice (${response.status})`
        logger.error('Failed to create preview invoice:', errorMessage)
        throw new Error(errorMessage)
      }
      const invoice = await response.json()
      setPreviewInvoiceId(invoice.id)
      const pdfResponse = await fetch(`/api/invoices/${invoice.id}/generate-pdf`, { method: 'POST' })
      if (!pdfResponse.ok) {
        let errorMessage = `Failed to generate PDF (${pdfResponse.status})`
        try {
          const errorData = await pdfResponse.json()
          errorMessage = errorData.error || errorMessage
          logger.error('PDF generation error response:', errorData)
        } catch (parseError) {
          logger.error('Failed to parse error response:', parseError)
          const text = await pdfResponse.text().catch(() => '')
          errorMessage = text || errorMessage
        }
        throw new Error(errorMessage)
      }
      const pdfData = await pdfResponse.json()
      setPreviewPdfUrl(pdfData.pdfDataUrl || pdfData.pdfUrl)
      if (!options?.silent) {
        const { showSuccess } = await import('@/lib/toast')
        showSuccess('Preview generated!')
      }
      return true
    } catch (error) {
      logger.error('Error generating preview:', error)
      const { showError } = await import('@/lib/toast')
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate preview'
      showError(errorMessage)
      return false
    } finally {
      setIsGeneratingPreview(false)
    }
  }

  useEffect(() => {
    if (!open || lineItems.length === 0 || previewPdfUrl || isGeneratingPreview) return

    const signature = [
      client.id,
      dateDue,
      selectedJobIds.size,
      lineItems.map(item => `${item.jobId || 'custom'}:${item.description}:${item.amount}`).join('|'),
    ].join('::')

    if (autoPreviewSignature.current === signature) return
    autoPreviewSignature.current = signature

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      const generated = await handleGeneratePreview({ silent: true })
      if (!generated && !cancelled) {
        autoPreviewSignature.current = null
      }
    }, 50)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineItems, previewPdfUrl, isGeneratingPreview, client.id, dateDue, selectedJobIds.size])

  const handleBatchApprove = async () => {
    setIsCreating(true)
    try {
      setProgress(10)
      setProgressStep('Creating invoice...')
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          jobIds: getInvoiceJobIds(),
          lineItems: serializeLineItemsForApi(),
          dateDue: dateDue || null,
          notes: notes || null,
          showPaymentOptions: showPaymentOptions,
        }),
      })
      if (!response.ok) {
        const { showApiError } = await import('@/lib/toast')
        await showApiError(response, 'Failed to create invoice')
        return
      }
      const invoice = await response.json()
      setProgress(50)
      setProgressStep('Generating PDF...')
      await fetch(`/api/invoices/${invoice.id}/generate-pdf`, { method: 'POST' })
      setProgress(100)
      const { showSuccess } = await import('@/lib/toast')
      showSuccess(`Draft saved for ${client.name}`)
      setTimeout(() => {
        if (onNext) {
          onNext()
        } else {
          onSuccess?.()
          onOpenChange(false)
        }
      }, 400)
    } catch (error) {
      logger.error('Batch approve error:', error)
      const { showError } = await import('@/lib/toast')
      showError('Failed to create invoice')
    } finally {
      setIsCreating(false)
      setProgress(0)
      setProgressStep('')
    }
  }

  const handleBatchSkip = () => {
    if (onNext) {
      onNext()
    } else {
      onSuccess?.()
      onOpenChange(false)
    }
  }

  return {
    // Props passthrough
    router, client, jobs, open, onOpenChange,
    onSuccess, onNext, onPrevious,
    currentIndex, totalCount, batchMode,

    // State
    isCreating, isSendingTest, isGeneratingPreview,
    previewInvoiceId, previewPdfUrl,
    netTerms, setNetTerms,
    dateDue, setDateDue,
    notes, setNotes,
    lineItems, setLineItems,
    createdInvoiceId,
    progress, progressStep,
    emailCc, setEmailCc,
    recipientPool,
    selectedRecipients,
    manualEmailInput, setManualEmailInput,
    toggleRecipient,
    addManualRecipient,
    emailSubject, setEmailSubject,
    emailMessage, setEmailMessage,
    showPaymentOptions, setShowPaymentOptions,
    showSendConfirmation, setShowSendConfirmation,
    expandedSections, toggleSection, isSectionExpanded,
    selectedJobIds, setSelectedJobIds,
    expandedLocations,
    activeMonthPillRef,
    activeMonth, setActiveMonth,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    showCustomDates, setShowCustomDates,

    // Computed
    availableMonths, filteredJobs,
    flatRateData, recurringLocationGroups, perCleanLocationGroups,
    totalAmount, netTermsOptions,

    // Handlers
    handleMonthSelect, handleCustomDates, clearDateFilter,
    toggleJob, toggleAllJobs,
    toggleLocationExpand, toggleLocationJobs,
    handleNetTermsChange,
    startEditing, saveEdit, updateLineItem, removeLineItem, addLineItem,
    handleCreateInvoice,
    handleSendToClient, handleConfirmSendToClient,
    handleGeneratePreview,
    handleBatchApprove, handleBatchSkip,
  }
}

export type QuickInvoiceState = ReturnType<typeof useQuickInvoice>
