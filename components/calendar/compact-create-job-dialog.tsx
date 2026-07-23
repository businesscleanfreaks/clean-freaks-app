"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { Check, ChevronDown, ChevronUp, Clock, DollarSign, FileText, MapPin, Plus, Repeat, Search, Sparkles, X } from "lucide-react"
import { refreshCalendarData } from "./calendar-client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TimePicker } from "@/components/ui/time-picker"
import { showError, showSuccess } from "@/lib/toast"
import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"
import type { ClientListItem, SubcontractorSummary } from "@/lib/types"

interface CompactCreateJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDate: Date | null
  selectedTime?: string
  clients: ClientListItem[]
  subcontractors: SubcontractorSummary[]
  preSelectedClientId?: string
  anchor?: { left: number; top: number } | null
}

type ClientMode = "existing" | "one-time"
type TimeMode = "specific" | "window" | "tbd"
type ServiceType = "cleaning" | "addon"
type JobType = "regular" | "deep_clean" | "post_construction" | "move_in_out" | "event"
type ClientLocation = ClientListItem["locations"][number]
type ClientSchedule = ClientLocation["schedules"][number]

const jobTypes: Array<{ value: JobType; label: string }> = [
  { value: "regular", label: "Standard" },
  { value: "deep_clean", label: "Deep" },
  { value: "post_construction", label: "Post-construction" },
  { value: "move_in_out", label: "Move-out" },
  { value: "event", label: "Event" },
]

const jobTypeDescriptions: Record<JobType, string> = {
  regular: "Regular upkeep clean",
  deep_clean: "Top-to-bottom detail clean",
  post_construction: "Debris and dust after a build",
  move_in_out: "Empty home, inside cabinets and appliances",
  event: "Event setup or cleanup",
}

const addOnServiceOptions = [
  "Window Cleaning",
  "Carpet Cleaning",
  "Pressure Washing",
  "Fridge Deep Clean",
] as const

const customAddOnServiceValue = "custom"

// Trials are short recurring runs, so only weekly-based cadences make sense here.
type TrialDuration = "1wk" | "2wk" | "3wk" | "1mo"
const trialFrequencies: Array<{ value: string; label: string }> = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BI_WEEKLY", label: "Every 2 wks" },
  { value: "EVERY_3_WEEKS", label: "Every 3 wks" },
  { value: "EVERY_4_WEEKS", label: "Every 4 wks" },
]
const trialDurations: Array<{ value: TrialDuration; label: string }> = [
  { value: "1wk", label: "1 week" },
  { value: "2wk", label: "2 weeks" },
  { value: "3wk", label: "3 weeks" },
  { value: "1mo", label: "1 month" },
]
// getUTCDay() order: 0 = Sunday … 6 = Saturday (matches calculateScheduleDates)
const dayLetters = ["S", "M", "T", "W", "T", "F", "S"]

function addTrialDuration(start: Date, duration: TrialDuration): Date {
  const end = new Date(start)
  if (duration === "1wk") end.setDate(end.getDate() + 7)
  else if (duration === "2wk") end.setDate(end.getDate() + 14)
  else if (duration === "3wk") end.setDate(end.getDate() + 21)
  else end.setMonth(end.getMonth() + 1)
  return end
}

function initialLocationIds(client?: ClientListItem) {
  return client?.locations?.length === 1 ? [client.locations[0].id] : []
}

function primaryScheduleForLocation(location?: ClientLocation): ClientSchedule | undefined {
  return location?.schedules
    ?.filter(schedule => schedule.isActive !== false)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0]
}

function toInputDate(date: Date | null) {
  return date ? format(date, "yyyy-MM-dd") : ""
}

export function CompactCreateJobDialog({
  open,
  onOpenChange,
  selectedDate,
  selectedTime,
  clients,
  subcontractors,
  preSelectedClientId,
  anchor,
}: CompactCreateJobDialogProps) {
  const initialClient = clients.find(client => client.id === preSelectedClientId)
  const [clientMode, setClientMode] = useState<ClientMode>(preSelectedClientId ? "existing" : "existing")
  const [search, setSearch] = useState("")
  const [selectedClientId, setSelectedClientId] = useState(preSelectedClientId || "")
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>(initialLocationIds(initialClient))
  const [oneTimeName, setOneTimeName] = useState("")
  const [oneTimeAddress, setOneTimeAddress] = useState("")
  const [oneTimePhone, setOneTimePhone] = useState("")
  const [oneTimeEmail, setOneTimeEmail] = useState("")
  const [jobType, setJobType] = useState<JobType>("regular")
  const [serviceType, setServiceType] = useState<ServiceType>("cleaning")
  const [addOnServiceChoice, setAddOnServiceChoice] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [isTrial, setIsTrial] = useState(false)
  const [jobDate, setJobDate] = useState<Date | null>(selectedDate)
  const [timeMode, setTimeMode] = useState<TimeMode>(selectedTime ? "specific" : "window")
  const [startTime, setStartTime] = useState(selectedTime || "")
  const [startWindowBegin, setStartWindowBegin] = useState("")
  const [startWindowEnd, setStartWindowEnd] = useState("")
  const [subcontractorId, setSubcontractorId] = useState("unassigned")
  const [clientRate, setClientRate] = useState("")
  const [cleanerPay, setCleanerPay] = useState("")
  const [showNotes, setShowNotes] = useState(false)
  // Date+time collapse to a one-line summary (mockup) to cut whitespace; expands to edit.
  const [dateTimeOpen, setDateTimeOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [trialNotes, setTrialNotes] = useState("")
  const [trialFrequency, setTrialFrequency] = useState("WEEKLY")
  const [trialDaysOfWeek, setTrialDaysOfWeek] = useState<number[]>([])
  const [trialDuration, setTrialDuration] = useState<TrialDuration>("2wk")
  const [loading, setLoading] = useState(false)
  // Dropdown stays hidden until the user clicks/types in the search input — matches the JSX
  // mockup so the form doesn't feel cluttered when no client is selected yet.
  const [dropOpen, setDropOpen] = useState(false)
  const clientPickerRef = useRef<HTMLDivElement | null>(null)

  // Add-ons attached to this job on creation (e.g. a vendor-performed window clean)
  const [addOns, setAddOns] = useState<Array<{ description: string; vendorId: string; clientRate: string; subcontractorRate: string }>>([])
  const [addingAddOn, setAddingAddOn] = useState(false)
  const [addOnDraft, setAddOnDraft] = useState({ description: '', vendorId: '', clientRate: '', subcontractorRate: '' })
  // Whether the add-on service dropdown is on "Custom service" (reveals a name field).
  const [addOnDraftCustom, setAddOnDraftCustom] = useState(false)

  const activeCleaners = useMemo(
    () => subcontractors.filter(subcontractor => subcontractor.isActive !== false),
    [subcontractors]
  )
  // Vendors for the add-on "Performed by" selector (vendor add-ons are payable via the vendor list)
  const { data: vendorData } = useSWR<Array<{ id: string; name: string; isActive?: boolean }>>(open ? '/api/vendors' : null, fetcher)
  const addOnVendors = useMemo(() => vendorData || [], [vendorData])
  const activeVendors = useMemo(() => addOnVendors.filter(v => v.isActive !== false), [addOnVendors])
  const selectedClient = clients.find(client => client.id === selectedClientId)
  const locations = selectedClient?.locations || []
  // Compact "Sat, Jun 20 · 3:30pm – 5:30pm" summary for the collapsed date/time row.
  const fmt12 = (t: string) => {
    if (!t) return ""
    const [h, m] = t.split(":").map(Number)
    const ap = h >= 12 ? "pm" : "am"
    const hh = h % 12 || 12
    return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`
  }
  const addMin = (t: string, mins: number) => {
    if (!t) return ""
    const [h, m] = t.split(":").map(Number)
    const total = h * 60 + m + mins
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  }
  // Default cleaning block is 2h (matches the ghost preview card, draftStart + 120).
  const timeRangeSummary =
    timeMode === "tbd"
      ? "Time TBD"
      : timeMode === "window"
        ? (startWindowBegin && startWindowEnd ? `${fmt12(startWindowBegin)} – ${fmt12(startWindowEnd)}` : "Arrival window")
        : (startTime ? `${fmt12(startTime)} – ${fmt12(addMin(startTime, 120))}` : "Pick a time")
  // One-time shows the date; recurring is simpler — the day pills carry the "when", so just the time.
  const dateTimeSummary = isRecurring
    ? timeRangeSummary
    : `${jobDate ? format(jobDate, "EEE, MMM d") : "Pick a date"} · ${timeRangeSummary}`
  const typedClientName = search.trim()
  const exactClientMatch = useMemo(
    () => clients.some(client => client.name.toLowerCase() === typedClientName.toLowerCase()),
    [clients, typedClientName]
  )

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    return [...clients]
      .filter(client => !query || client.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [clients, search])

  const hasValidTime =
    timeMode === "tbd" ||
    (timeMode === "specific" ? !!startTime : !!startWindowBegin && !!startWindowEnd)

  const profit = (Number(clientRate) || 0) - (Number(cleanerPay) || 0)
  // Trials become a short recurring schedule, so they need at least one weekday picked.
  const trialReady = !isTrial || trialDaysOfWeek.length > 0
  const canCreate =
    !!jobDate &&
    hasValidTime &&
    (!isRecurring || timeMode !== "tbd") &&
    trialReady &&
    (!isRecurring || trialDaysOfWeek.length > 0) &&
    Number(clientRate) >= 0 &&
    Number(cleanerPay) >= 0 &&
    clientRate !== "" &&
    cleanerPay !== "" &&
    (clientMode === "one-time"
      ? !!oneTimeName.trim() && !!oneTimeAddress.trim()
      : !!selectedClientId && selectedLocationIds.length > 0) &&
    (serviceType === "cleaning" || !!addOnDraft.description.trim())

  useEffect(() => {
    if (!open) return
    const preselected = clients.find(client => client.id === preSelectedClientId)
    setClientMode("existing")
    setSearch("")
    setSelectedClientId(preSelectedClientId || "")
    setSelectedLocationIds(initialLocationIds(preselected))
    setOneTimeName("")
    setOneTimeAddress("")
    setOneTimePhone("")
    setOneTimeEmail("")
    setJobType("regular")
    setServiceType("cleaning")
    setAddOnServiceChoice("")
    setIsRecurring(false)
    setIsTrial(false)
    setJobDate(selectedDate)
    setTimeMode(selectedTime ? "specific" : "window")
    setStartTime(selectedTime || "")
    setStartWindowBegin("")
    setStartWindowEnd("")
    setSubcontractorId("unassigned")
    setClientRate("")
    setCleanerPay("")
    setShowNotes(false)
    setNotes("")
    setTrialNotes("")
    setTrialFrequency("WEEKLY")
    setTrialDaysOfWeek([])
    setTrialDuration("2wk")
    setAddOns([])
    setAddingAddOn(false)
    setAddOnDraft({ description: '', vendorId: '', clientRate: '', subcontractorRate: '' })
    setDropOpen(false)
  }, [clients, open, preSelectedClientId, selectedDate, selectedTime])

  useEffect(() => {
    if ((isTrial || (isRecurring && serviceType === "cleaning")) && subcontractorId.startsWith("vendor:")) {
      setSubcontractorId("unassigned")
    }
  }, [isRecurring, isTrial, serviceType, subcontractorId])

  // Close the client dropdown when clicking outside the picker container.
  useEffect(() => {
    if (!dropOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (clientPickerRef.current && !clientPickerRef.current.contains(event.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [dropOpen])

  const applyScheduleDefaults = (
    locationIds: string[],
    options?: { force?: boolean; sourceLocations?: ClientLocation[] }
  ) => {
    if (locationIds.length !== 1) return
    const location = (options?.sourceLocations || locations).find(item => item.id === locationIds[0])
    const schedule = primaryScheduleForLocation(location)
    if (!schedule) return

    const shouldSet = (value: string) => options?.force || value === ""
    const shouldSetAssignee = options?.force || subcontractorId === "" || subcontractorId === "unassigned"

    if (shouldSet(clientRate) && schedule.defaultClientRate != null) setClientRate(String(schedule.defaultClientRate))
    if (shouldSet(cleanerPay) && schedule.defaultSubcontractorRate != null) setCleanerPay(String(schedule.defaultSubcontractorRate))
    if (shouldSetAssignee && schedule.subcontractorId) setSubcontractorId(schedule.subcontractorId)

    if (selectedTime) return
    if (schedule.timeType === "SPECIFIC" && schedule.startTime) {
      setTimeMode("specific")
      setStartTime(schedule.startTime)
      setStartWindowBegin("")
      setStartWindowEnd("")
    } else if (schedule.startWindowBegin && schedule.startWindowEnd) {
      setTimeMode("window")
      setStartTime("")
      setStartWindowBegin(schedule.startWindowBegin)
      setStartWindowEnd(schedule.startWindowEnd)
    }
  }

  const chooseClient = (client: ClientListItem) => {
    setClientMode("existing")
    setSelectedClientId(client.id)
    const nextLocationIds = initialLocationIds(client)
    setSelectedLocationIds(nextLocationIds)
    applyScheduleDefaults(nextLocationIds, { sourceLocations: client.locations })
    setSearch("")
    setDropOpen(false)
  }

  const useTypedClientAsOneTime = () => {
    if (!typedClientName) return
    setClientMode("one-time")
    setOneTimeName(typedClientName)
    setSelectedClientId("")
    setSelectedLocationIds([])
    setSearch("")
    setDropOpen(false)
  }

  const resetClientChoice = () => {
    const nameToSearch = clientMode === "one-time" ? oneTimeName : ""
    setClientMode("existing")
    setSearch(nameToSearch)
    setSelectedClientId("")
    setSelectedLocationIds([])
    setOneTimeName("")
    setOneTimeAddress("")
    setOneTimePhone("")
    setOneTimeEmail("")
  }

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds(current => {
      const next = current.includes(locationId)
        ? current.filter(id => id !== locationId)
        : [...current, locationId]
      applyScheduleDefaults(next)
      return next
    })
  }

  const close = () => onOpenChange(false)

  const createJob = async () => {
    if (!jobDate) {
      showError("Choose a job date")
      return
    }
    if (!canCreate) {
      showError("Choose a client, location, time, and rates before creating the job")
      return
    }
    if (isTrial && subcontractorId.startsWith("vendor:")) {
      showError("Trials need a cleaner assignment. Vendors can perform standalone one-time jobs.")
      return
    }
    if (serviceType === "addon" && isRecurring && clientMode === "one-time") {
      showError("Choose an existing client schedule for a recurring add-on")
      return
    }

    setLoading(true)
    try {
      let locationIds = selectedLocationIds

      if (clientMode === "one-time") {
        const cleanLabel = jobTypes.find(type => type.value === jobType)?.label || "clean"
        const trialLabel = trialDurations.find(option => option.value === trialDuration)?.label || trialDuration
        // Mark trial clients in notes so the clients list classifies them into the Trial bucket.
        const oneTimeNotes = isTrial
          ? `TRIAL CLIENT — ${trialLabel} trial${trialNotes.trim() ? `\n${trialNotes.trim()}` : ""}`
          : `One-time ${cleanLabel} job`

        const clientResponse = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: oneTimeName.trim(),
            phone: oneTimePhone.trim() || null,
            communicationEmail: oneTimeEmail.trim() || null,
            invoicingEmail: oneTimeEmail.trim() || null,
            billingType: "PER_CLEAN",
            cleanerPayType: "PER_CLEAN",
            notes: oneTimeNotes,
            locations: [{ name: "Primary", address: oneTimeAddress.trim() }],
          }),
        })

        if (!clientResponse.ok) throw new Error((await clientResponse.json()).error || "Failed to add one-time client")
        const newClient = await clientResponse.json()
        locationIds = [newClient.locations[0].id]
      }

      if (serviceType === "addon" && isRecurring) {
        const location = selectedClient?.locations.find(item => item.id === locationIds[0])
        const schedule = primaryScheduleForLocation(location)
        if (!schedule) throw new Error("This location needs an active recurring cleaning schedule before adding a recurring service")
        const response = await fetch("/api/add-on-services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleId: schedule.id,
            description: addOnDraft.description.trim(),
            clientRate: Number(clientRate),
            subcontractorRate: Number(cleanerPay),
            frequency: trialFrequency,
            isRecurring: true,
            vendorId: subcontractorId.startsWith("vendor:") ? subcontractorId.replace("vendor:", "") : null,
            subcontractorId: !subcontractorId.startsWith("vendor:") && subcontractorId !== "unassigned" ? subcontractorId : null,
            dayOfWeek: trialDaysOfWeek[0] ?? jobDate.getDay(),
          }),
        })
        if (!response.ok) throw new Error((await response.json()).error || "Failed to add recurring service")
        showSuccess("Recurring service added")
        refreshCalendarData()
        close()
        return
      }

      if (isTrial) {
        // A trial is a short recurring schedule with a hard endDate so jobs don't project past
        // the trial window (the bug Modern Animal hit). The schedule POST auto-generates its jobs.
        const endDate = format(addTrialDuration(jobDate, trialDuration), "yyyy-MM-dd")
        await Promise.all(locationIds.map(async locationId => {
          const response = await fetch("/api/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              locationId,
              frequency: trialFrequency,
              daysOfWeek: JSON.stringify(trialDaysOfWeek),
              startDate: format(jobDate, "yyyy-MM-dd"),
              endDate,
              defaultClientRate: Number(clientRate),
              defaultSubcontractorRate: Number(cleanerPay),
              clientPayType: "PER_CLEAN",
              subcontractorPayType: "PER_CLEAN",
              subcontractorId: subcontractorId === "unassigned" ? null : subcontractorId,
              timeType: timeMode === "specific" ? "SPECIFIC" : "WINDOW",
              startTime: timeMode === "specific" ? startTime || null : null,
              startWindowBegin: timeMode === "window" ? startWindowBegin || null : null,
              startWindowEnd: timeMode === "window" ? startWindowEnd || null : null,
            }),
          })

          if (!response.ok) throw new Error((await response.json()).error || "Failed to create trial schedule")
        }))

        showSuccess(locationIds.length > 1 ? `${locationIds.length} trials scheduled` : "Trial scheduled")
        refreshCalendarData()
        close()
        return
      }

      if (isRecurring) {
        await Promise.all(locationIds.map(async locationId => {
          const response = await fetch("/api/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              locationId,
              frequency: trialFrequency,
              daysOfWeek: JSON.stringify(trialDaysOfWeek),
              startDate: format(jobDate, "yyyy-MM-dd"),
              endDate: null,
              defaultClientRate: Number(clientRate),
              defaultSubcontractorRate: Number(cleanerPay),
              clientPayType: "PER_CLEAN",
              subcontractorPayType: "PER_CLEAN",
              subcontractorId: subcontractorId === "unassigned" || subcontractorId.startsWith("vendor:") ? null : subcontractorId,
              timeType: timeMode === "specific" ? "SPECIFIC" : "WINDOW",
              startTime: timeMode === "specific" ? startTime || null : null,
              startWindowBegin: timeMode === "window" ? startWindowBegin || null : null,
              startWindowEnd: timeMode === "window" ? startWindowEnd || null : null,
            }),
          })
          if (!response.ok) throw new Error((await response.json()).error || "Failed to create recurring schedule")
        }))
        showSuccess(locationIds.length > 1 ? `${locationIds.length} recurring schedules added` : "Recurring schedule added")
        refreshCalendarData()
        close()
        return
      }

      await Promise.all(locationIds.map(async locationId => {
        const isVendorAssignment = subcontractorId.startsWith("vendor:")
        const response = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            subcontractorId: subcontractorId === "unassigned" || isVendorAssignment ? null : subcontractorId,
            vendorId: isVendorAssignment ? subcontractorId.replace("vendor:", "") : null,
            date: format(jobDate, "yyyy-MM-dd"),
            startTime: timeMode === "specific" ? startTime || null : null,
            startWindowBegin: timeMode === "window" ? startWindowBegin || null : null,
            startWindowEnd: timeMode === "window" ? startWindowEnd || null : null,
            clientRate: serviceType === "addon" ? 0 : Number(clientRate),
            subcontractorRate: serviceType === "addon" ? 0 : Number(cleanerPay),
            notes: notes.trim() || null,
            isTrial,
            trialNotes: isTrial ? trialNotes.trim() || null : null,
          }),
        })

        if (!response.ok) throw new Error((await response.json()).error || "Failed to create job")

        // Attach any add-ons to the created job. A vendor add-on becomes payable via the vendor list.
        const servicesToAttach = serviceType === "addon"
          ? [{
              description: addOnDraft.description.trim(),
              vendorId: isVendorAssignment ? subcontractorId.replace("vendor:", "") : "",
              clientRate,
              subcontractorRate: cleanerPay,
            }]
          : addOns
        if (servicesToAttach.length > 0) {
          const createdJob = await response.json()
          for (const ao of servicesToAttach) {
            await fetch("/api/add-on-services", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: createdJob.id,
                description: ao.description,
                clientRate: parseFloat(ao.clientRate) || 0,
                subcontractorRate: parseFloat(ao.subcontractorRate) || 0,
                vendorId: ao.vendorId || null,
              }),
            })
          }
        }
      }))

      showSuccess(locationIds.length > 1 ? `${locationIds.length} jobs added` : "Job added")
      refreshCalendarData()
      close()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to create job")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && close()}>
      <DialogContent
        data-calendar-create-editor
        hideClose
        overlayClassName={anchor ? "bg-transparent" : undefined}
        className={`flex max-h-[94vh] w-[min(94vw,372px)] max-w-[372px] flex-col overflow-hidden rounded-2xl border border-[#e8ebef] p-0 shadow-[0_1px_1px_rgba(16,24,40,0.04),0_28px_64px_-12px_rgba(16,24,40,0.28)] ${anchor ? "sm:translate-x-0 sm:translate-y-0 [animation:none]" : ""}`}
        style={anchor ? {
          left: anchor.left,
          top: anchor.top,
          maxHeight: `calc(100vh - ${anchor.top + 12}px)`,
          transform: "none",
          animation: "none",
        } : undefined}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2"><DialogTitle className="text-[15px] font-extrabold tracking-tight text-slate-950">New booking</DialogTitle></div>
          <DialogDescription className="sr-only">Add a new job: pick client, schedule, rates, and notes in one quick pass.</DialogDescription>
          <button aria-label="Close add job" onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <section className="space-y-2">
            {clientMode === "existing" ? (
              <>
                {selectedClient ? (
                  <div className="flex items-center justify-between gap-2 border-b border-[#dfe5eb] px-1 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[21px] font-extrabold leading-tight tracking-[-0.02em] text-[#263246]">{selectedClient.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {locations[0]?.address || `${locations.length} location${locations.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Clear selected client"
                      onClick={resetClientChoice}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-teal-700 hover:bg-teal-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div ref={clientPickerRef} className="relative">
                    {/* Mockup client typeahead: a clean underlined field (no search
                        icon) with an avatar-row dropdown; "Create <name>" is a row
                        inside the same menu rather than a separate yellow box. */}
                    <Input
                      value={search}
                      onClick={() => setDropOpen(current => !current)}
                      onChange={event => {
                        setSearch(event.target.value)
                        setDropOpen(true)
                      }}
                      placeholder="Client name"
                      className="h-11 border-x-0 border-t-0 border-b-[1.5px] border-[#dfe5eb] px-1 text-[21px] font-bold tracking-[-0.02em] shadow-none placeholder:text-[#9aa6b2] focus-visible:border-[var(--cf-green)] focus-visible:ring-0"
                    />
                    {dropOpen && (filteredClients.length > 0 || (typedClientName && !exactClientMatch)) && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[230px] overflow-y-auto rounded-[11px] border border-[#e6e9ee] bg-white p-1.5 shadow-[0_14px_36px_rgba(16,24,40,0.18)]">
                        {filteredClients.map(client => {
                          const firstLoc = client.locations?.[0]
                          const subline = firstLoc?.address || client.phone || ""
                          const initials = (client.name.split(/\s+/).slice(0, 2).map(w => w[0]).join("") || "?").toUpperCase()
                          return (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => chooseClient(client)}
                              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#f1f5f9]"
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#eef1f4] text-[10px] font-extrabold text-[#64748b]">{initials}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-[#1e293b]">{client.name}</span>
                                {subline && <span className="block truncate text-[11px] text-[#9aa6b2]">{subline}</span>}
                              </span>
                            </button>
                          )
                        })}
                        {typedClientName && !exactClientMatch && (
                          <button
                            type="button"
                            onClick={useTypedClientAsOneTime}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[#eafaf5]"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#ecfdf9] text-[13px] font-bold text-[#0f766e]">+</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0f766e]">Create &quot;{typedClientName}&quot;</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedClient && locations.length > 0 && (
                  <div className="space-y-1">
                    <Label className="block text-[10px] font-bold uppercase tracking-[0.05em] text-[#9aa6b2]">Location</Label>
                    <div className="space-y-1">
                      {locations.map(location => {
                        const selected = selectedLocationIds.includes(location.id)
                        return (
                          <button
                            key={location.id}
                            type="button"
                            onClick={() => toggleLocation(location.id)}
                            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left ${selected ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}
                          >
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300"}`}>
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 leading-tight">
                              <span className="block truncate text-[13px] font-semibold text-slate-900">{location.name}</span>
                              <span className="block truncate text-[10.5px] text-slate-400">{location.address}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-950">{oneTimeName || "One-time client"}</div>
                    <div className="text-[11px] text-amber-800">This creates a one-time client record and job.</div>
                  </div>
                  <button type="button" onClick={resetClientChoice} className="shrink-0 text-xs font-semibold text-amber-800">
                    Change
                  </button>
                </div>
                <Input value={oneTimeName} onChange={event => setOneTimeName(event.target.value)} placeholder="Client name *" className="h-9 bg-white" />
                <Input value={oneTimeAddress} onChange={event => setOneTimeAddress(event.target.value)} placeholder="Full address *" className="h-9" />
                <div className="grid grid-cols-2 gap-1.5">
                  <Input value={oneTimePhone} onChange={event => setOneTimePhone(event.target.value)} placeholder="Phone" className="h-9" />
                  <Input value={oneTimeEmail} onChange={event => setOneTimeEmail(event.target.value)} placeholder="Email" className="h-9" />
                </div>
              </div>
            )}
          </section>

          <div className="h-px bg-slate-100" />

          <section className="space-y-2">
            <div>
              <Label className="mb-1 block text-[11px] font-bold text-[#7f8ea3]">Service type</Label>
              <div className="flex h-9 w-[190px] rounded-lg bg-[#e9edf2] p-1 text-[12px] font-bold">
                {([['cleaning', 'Cleaning'], ['addon', 'Add-on']] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => { setServiceType(value); if (value === 'addon') setIsTrial(false) }} className={`flex-1 rounded-md transition-colors ${serviceType === value ? 'bg-white text-[#172033] shadow-sm' : 'text-[#66758b]'}`}>{label}</button>
                ))}
              </div>
            </div>

            {serviceType === 'cleaning' ? (
              <div>
                <Label className="mb-1 block text-[11px] font-bold text-[#7f8ea3]">Type of clean</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {jobTypes.filter(type => type.value !== 'event').map(type => (
                    <button key={type.value} type="button" onClick={() => setJobType(type.value)} className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${jobType === type.value ? 'border-[#0b8557] bg-[#eaf5f0]' : 'border-[#d9e1ea] bg-white hover:border-[#a9cfc6]'}`}>
                      <span className="block text-[12px] font-extrabold text-[#263246]">{type.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] leading-tight text-[#718096]">{jobTypeDescriptions[type.value]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Select
                  value={addOnServiceChoice}
                  onValueChange={value => {
                    setAddOnServiceChoice(value)
                    setAddOnDraft(current => ({
                      ...current,
                      description: value === customAddOnServiceValue ? "" : value,
                    }))
                  }}
                >
                  <SelectTrigger className="h-10 rounded-lg border-[#d9e1ea] bg-[#f8fafc] px-4 text-[13.5px] text-[#52637a] focus:ring-[#38bfae]">
                    <SelectValue placeholder="Choose a service..." />
                  </SelectTrigger>
                  <SelectContent>
                    {addOnServiceOptions.map(option => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                    <SelectItem value={customAddOnServiceValue}>Custom service...</SelectItem>
                  </SelectContent>
                </Select>
                {addOnServiceChoice === customAddOnServiceValue && (
                  <Input
                    autoFocus
                    value={addOnDraft.description}
                    onChange={event => setAddOnDraft(current => ({ ...current, description: event.target.value }))}
                    placeholder="Name the custom service"
                    className="h-11 rounded-lg border-[#d9e1ea] bg-white"
                  />
                )}
              </div>
            )}


            <div>
              <Label className="mb-1 block text-[11px] font-bold text-[#7f8ea3]">When</Label>
              <div className="flex h-9 w-[200px] rounded-lg bg-[#e9edf2] p-1 text-[12px] font-bold">
                <button type="button" onClick={() => { setIsRecurring(false); setIsTrial(false) }} className={`flex-1 rounded-md ${!isRecurring ? 'bg-white text-[#172033] shadow-sm' : 'text-[#66758b]'}`}>One-time</button>
                <button type="button" onClick={() => setIsRecurring(true)} className={`flex-1 rounded-md ${isRecurring ? 'bg-white text-[#172033] shadow-sm' : 'text-[#66758b]'}`}>Recurring</button>
              </div>
            </div>

            {/* Collapsed one-line date+time summary (mockup: "🕐 Sat, Jun 20 · 11am");
                click to expand the full date + arrival editor. Cuts the whitespace of
                three stacked rows down to one line. */}
            <div>
              <button type="button" onClick={() => setDateTimeOpen(open => !open)} className="flex w-full items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-left hover:border-[#cbd5e1]">
                <Clock className="h-4 w-4 shrink-0 text-[#64748b]" />
                <span className="flex-1 truncate text-[13px] font-semibold text-[#172033]">{dateTimeSummary}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#94a3b8] transition-transform ${dateTimeOpen ? "rotate-180" : ""}`} />
              </button>
              {dateTimeOpen && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <div>
                      <Label className="mb-1 block text-[11px] text-slate-500">Date</Label>
                      <Input
                        type="date"
                        value={toInputDate(jobDate)}
                        onChange={event => setJobDate(event.target.value ? new Date(`${event.target.value}T12:00:00`) : null)}
                        className="h-[34px] text-sm"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block text-[11px] text-slate-500">{timeMode === "specific" ? "Time" : "Arrival"}</Label>
                      {timeMode === "specific"
                        ? <TimePicker value={startTime} onChange={setStartTime} />
                        : (
                          <div className="flex h-[34px] rounded-md bg-slate-100 p-0.5 text-[11px] font-semibold">
                            {(["specific", "window", "tbd"] as TimeMode[]).map(mode => (
                              <button key={mode} type="button" onClick={() => setTimeMode(mode)} className={`flex-1 rounded capitalize ${timeMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{mode === "specific" ? "Exact" : mode}</button>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                  {timeMode === "specific" && (
                    <div className="flex h-7 rounded-md bg-slate-100 p-0.5 text-[11px] font-semibold">
                      {(["specific", "window", "tbd"] as TimeMode[]).map(mode => (
                        <button key={mode} type="button" onClick={() => setTimeMode(mode)} className={`flex-1 rounded capitalize ${timeMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{mode === "specific" ? "Exact" : mode}</button>
                      ))}
                    </div>
                  )}
                  {timeMode === "window" && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><TimePicker value={startWindowBegin} onChange={setStartWindowBegin} /></div>
                      <span className="text-xs text-slate-400">to</span>
                      <div className="flex-1"><TimePicker value={startWindowEnd} onChange={setStartWindowEnd} /></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mockup order: frequency pills + day circles + repeats chip sit right
                under the time row for any recurring booking (clean or add-on). */}
            {isRecurring && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  {trialFrequencies.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTrialFrequency(option.value)}
                      className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                        trialFrequency === option.value
                          ? "border-[#9fd6c2] bg-[#e7f4ee] text-[#0b6b45]"
                          : "border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f6f8fa]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {dayLetters.map((letter, index) => {
                    const selected = trialDaysOfWeek.includes(index)
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() =>
                          setTrialDaysOfWeek(current =>
                            current.includes(index)
                              ? current.filter(day => day !== index)
                              : [...current, index].sort((a, b) => a - b)
                          )
                        }
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold transition-colors ${
                          selected ? "bg-[#0B7A4E] text-white" : "border border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f6f8fa]"
                        }`}
                      >
                        {letter}
                      </button>
                    )
                  })}
                </div>
                {trialDaysOfWeek.length === 0 ? (
                  <p className="text-[10.5px] font-medium text-[#7f8ea3]">Pick at least one service day.</p>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#dff0e9] px-2.5 py-1 text-[11px] font-bold text-[#075f40]">
                    <Repeat className="h-3 w-3" />
                    Repeats {trialFrequency === 'WEEKLY' ? 'weekly' : trialFrequency === 'BI_WEEKLY' ? 'every 2 weeks' : trialFrequency === 'EVERY_3_WEEKS' ? 'every 3 weeks' : 'every 4 weeks'} on {trialDaysOfWeek.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}
                  </div>
                )}
              </div>
            )}

            {serviceType === 'cleaning' && (
              <button type="button" onClick={() => { const next = !isTrial; setIsTrial(next); if (next) setIsRecurring(true) }} className="flex w-full items-center gap-2 border-t border-[#edf0f3] pt-3 text-left">
                <span className={`relative h-6 w-10 rounded-full transition-colors ${isTrial ? 'bg-[#0d9488]' : 'bg-[#cbd5e1]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isTrial ? 'translate-x-5' : 'translate-x-1'}`} /></span>
                <span><span className="block text-[13px] font-bold text-[#263246]">Trial</span><span className="block text-[10px] text-[#7f8ea3]">Probationary period at a trial rate</span></span>
              </button>
            )}
          </section>

          <section className="space-y-2">
            <div>
              <Label className="mb-1 block text-[11px] text-slate-500">Assigned cleaner</Label>
              {/* Avatar sits beside the select (leading) — matches the mockup without
                  making the control taller. */}
              <div className="flex items-center gap-2">
                {(() => {
                  const assignedName = subcontractorId === "unassigned" ? "" : (activeCleaners.find(c => c.id === subcontractorId)?.name || activeVendors.find(v => `vendor:${v.id}` === subcontractorId)?.name || "")
                  const initials = assignedName ? assignedName.split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase() : ""
                  return assignedName
                    ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0d9488] text-[10px] font-bold text-white">{initials}</span>
                    : <span className="h-7 w-7 shrink-0 rounded-full border-2 border-dashed border-[#cbd5e1]" aria-hidden="true" />
                })()}
                <Select value={subcontractorId} onValueChange={setSubcontractorId}>
                  <SelectTrigger className={`h-[34px] flex-1 text-sm ${subcontractorId === "unassigned" ? "text-amber-700" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned"><span className="text-amber-700">Assign cleaner</span></SelectItem>
                    {activeCleaners.map(cleaner => <SelectItem key={cleaner.id} value={cleaner.id}>{cleaner.name}</SelectItem>)}
                    {!isTrial && (!isRecurring || serviceType === 'addon') && activeVendors.length > 0 && (
                      <>
                        <div className="mt-1 border-t border-slate-100 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Vendors</div>
                        {activeVendors.map(vendor => <SelectItem key={`vendor:${vendor.id}`} value={`vendor:${vendor.id}`}>{vendor.name}</SelectItem>)}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Client charged</Label>
                <div className="relative">
                  <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input type="number" min="0" step="0.01" value={clientRate} onChange={event => setClientRate(event.target.value)} className="h-9 pl-7" placeholder="0" />
                </div>
              </div>
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">{subcontractorId.startsWith("vendor:") ? "Vendor paid" : "Cleaner paid"}</Label>
                <div className="relative">
                  <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input type="number" min="0" step="0.01" value={cleanerPay} onChange={event => setCleanerPay(event.target.value)} className="h-9 pl-7" placeholder="0" />
                </div>
              </div>
            </div>
          </section>

          {!isTrial && serviceType === 'cleaning' && (
            <section className="space-y-2">
              <Label className="block text-[11px] font-bold uppercase tracking-[0.06em] text-[#9aa6b2]">Add-on services</Label>
              {addOns.map((ao, i) => {
                const m = (parseFloat(ao.clientRate) || 0) - (parseFloat(ao.subcontractorRate) || 0)
                const perf = ao.vendorId ? (addOnVendors.find(v => v.id === ao.vendorId)?.name || 'Vendor') : 'Cleaner (same as job)'
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-[#e6e9ee] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eef2f7] text-[#64748b]"><Sparkles className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold text-[#1f2937]">{ao.description}</div>
                      <div className="truncate text-[10.5px] text-[#9aa6b2]">{perf}</div>
                    </div>
                    <span className={`shrink-0 text-[12px] font-bold ${m >= 0 ? 'text-[#0f766e]' : 'text-red-600'}`}>${m.toFixed(0)}</span>
                    <button type="button" aria-label="Remove add-on" onClick={() => setAddOns(addOns.filter((_, idx) => idx !== i))} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#aeb7c3] hover:bg-[#fdecec] hover:text-[#c11f1f]"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )
              })}
              {addingAddOn ? (
                <div className="space-y-2 rounded-xl border border-[#b9d8cd] bg-[#f1f8f5] p-3">
                  {/* Pick from a preset list (mockup) instead of typing the name by hand. */}
                  <select
                    value={addOnDraftCustom ? customAddOnServiceValue : addOnDraft.description}
                    onChange={e => {
                      const v = e.target.value
                      if (v === customAddOnServiceValue) { setAddOnDraftCustom(true); setAddOnDraft({ ...addOnDraft, description: '' }) }
                      else { setAddOnDraftCustom(false); setAddOnDraft({ ...addOnDraft, description: v }) }
                    }}
                    className="h-10 w-full rounded-lg border border-[#c9d8d2] bg-white px-3 text-[13.5px] text-[#263246] outline-none focus:border-[#0b8557]"
                  >
                    <option value="" disabled>Choose a service…</option>
                    {addOnServiceOptions.map(option => <option key={option} value={option}>{option}</option>)}
                    <option value={customAddOnServiceValue}>Custom service…</option>
                  </select>
                  {addOnDraftCustom && (
                    <Input value={addOnDraft.description} onChange={e => setAddOnDraft({ ...addOnDraft, description: e.target.value })} placeholder="Service name" className="h-9 text-sm" autoFocus />
                  )}
                  <div>
                    <Label className="mb-1 block text-[9px] font-extrabold uppercase tracking-wide text-[#08744f]">Performed by</Label>
                    <select
                      value={addOnDraft.vendorId}
                      onChange={e => setAddOnDraft({ ...addOnDraft, vendorId: e.target.value })}
                      className="h-9 w-full rounded-lg border border-[#c9d8d2] bg-white px-2.5 text-[13px] text-[#263246] outline-none focus:border-[#0b8557]"
                    >
                      <option value="">Cleaner (same as job)</option>
                      {addOnVendors.map(v => <option key={v.id} value={v.id}>{v.name} · vendor</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[9px] font-bold text-[#718096]">Client charged<Input type="number" min="0" step="0.01" value={addOnDraft.clientRate} onChange={e => setAddOnDraft({ ...addOnDraft, clientRate: e.target.value })} placeholder="0" className="mt-1 h-9 text-sm" /></label>
                    <label className="text-[9px] font-bold text-[#718096]">We pay<Input type="number" min="0" step="0.01" value={addOnDraft.subcontractorRate} onChange={e => setAddOnDraft({ ...addOnDraft, subcontractorRate: e.target.value })} placeholder="0" className="mt-1 h-9 text-sm" /></label>
                  </div>
                  <div className="flex justify-end gap-2 pt-0.5">
                    <button type="button" onClick={() => { setAddingAddOn(false); setAddOnDraftCustom(false) }} className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-[#66758b]">Cancel</button>
                    <button
                      type="button"
                      disabled={!addOnDraft.description.trim() || !addOnDraft.clientRate}
                      onClick={() => { setAddOns([...addOns, addOnDraft]); setAddingAddOn(false); setAddOnDraftCustom(false) }}
                      className="rounded-lg bg-[#0B7A4E] px-4 py-1.5 text-[11px] font-extrabold text-white disabled:bg-[#a8cbbf]"
                    >
                      Add service
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAddOnDraft({ description: '', vendorId: '', clientRate: '', subcontractorRate: '' }); setAddOnDraftCustom(false); setAddingAddOn(true) }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#b9d8cd] bg-[#f1f8f5] px-3 py-2.5 text-[13px] font-bold text-[#0b7a4e] hover:bg-[#e7f4ee]"
                >
                  <Plus className="h-4 w-4" /> Add-on service
                </button>
              )}
            </section>
          )}

          {isTrial && (
            <section className="space-y-3 rounded-lg border border-[#cce4db] bg-[#f1f8f5] p-3">
              {isTrial && <div>
                <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-amber-800">Trial length</Label>
                <div className="flex gap-1.5">
                  {trialDurations.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTrialDuration(option.value)}
                      className={`flex-1 rounded-md border px-1 py-1.5 text-[12px] font-semibold transition-colors ${
                        trialDuration === option.value
                          ? "border-amber-500 bg-amber-100 text-amber-900"
                          : "border-amber-200 bg-white text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {jobDate && (
                  <p className="mt-1 text-[10.5px] font-medium text-amber-700">
                    Runs {format(jobDate, "MMM d")} → {format(addTrialDuration(jobDate, trialDuration), "MMM d")}
                  </p>
                )}
              </div>}

              {isTrial && <div>
                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-amber-800">Trial notes</Label>
                <textarea
                  value={trialNotes}
                  onChange={event => setTrialNotes(event.target.value)}
                  placeholder="Entry details, expectations, special prep..."
                  rows={2}
                  className="w-full resize-none rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none"
                />
              </div>}
            </section>
          )}

          <section className="border-t border-[#edf0f3] pt-1">
            <button
              type="button"
              aria-expanded={showNotes}
              onClick={() => setShowNotes(current => !current)}
              className="flex min-h-11 w-full items-center gap-3 py-2 text-left text-[#738299] transition-colors hover:text-[#0b8557]"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-[14px] font-bold">Add note</span>
              {showNotes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showNotes && (
              <textarea
                autoFocus
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Gate codes, alarm, parking, contact, pets..."
                rows={3}
                className="mb-1 w-full resize-y rounded-lg border border-[#d9e1ea] bg-white px-3 py-2.5 text-sm text-[#263246] outline-none transition-colors placeholder:text-[#8a8f98] focus:border-[#38bfae] focus:ring-2 focus:ring-[#38bfae]/15"
              />
            )}
          </section>

          {selectedClient && selectedLocationIds.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-teal-700">
              <MapPin className="h-3 w-3" />
              {selectedLocationIds.length === 1 ? "1 selected location" : `${selectedLocationIds.length} selected locations`}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end border-t border-slate-100 bg-white px-4 pb-4 pt-3 shadow-[0_-5px_14px_rgba(16,24,40,0.05)]">
          <button
            type="button"
            disabled={!canCreate || loading}
            onClick={createJob}
            className={`h-11 min-w-[150px] rounded-lg px-5 text-[14px] font-bold transition-colors ${
              canCreate && !loading
                ? "bg-[#078556] text-white hover:bg-[#067348]"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {loading ? "Saving..." : "Save booking"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
