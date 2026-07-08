"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { CalendarDays, Check, DollarSign, MapPin, Search, X } from "lucide-react"
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
}

type ClientMode = "existing" | "one-time"
type TimeMode = "specific" | "window" | "tbd"
type JobType = "regular" | "deep_clean" | "post_construction" | "move_in_out" | "event"
type ClientLocation = ClientListItem["locations"][number]
type ClientSchedule = ClientLocation["schedules"][number]

const jobTypes: Array<{ value: JobType; label: string }> = [
  { value: "regular", label: "Regular clean" },
  { value: "deep_clean", label: "Deep clean" },
  { value: "post_construction", label: "Post-construction" },
  { value: "move_in_out", label: "Move in/out" },
  { value: "event", label: "Event" },
]

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

  const activeCleaners = useMemo(
    () => subcontractors.filter(subcontractor => subcontractor.isActive !== false),
    [subcontractors]
  )
  // Vendors for the add-on "Performed by" selector (vendor add-ons are payable via the vendor list)
  const { data: vendorData } = useSWR<Array<{ id: string; name: string; isActive?: boolean }>>(open ? '/api/vendors' : null, fetcher)
  const addOnVendors = vendorData || []
  const activeVendors = useMemo(() => addOnVendors.filter(v => v.isActive !== false), [addOnVendors])
  const selectedClient = clients.find(client => client.id === selectedClientId)
  const locations = selectedClient?.locations || []
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
    trialReady &&
    Number(clientRate) >= 0 &&
    Number(cleanerPay) >= 0 &&
    clientRate !== "" &&
    cleanerPay !== "" &&
    (clientMode === "one-time"
      ? !!oneTimeName.trim() && !!oneTimeAddress.trim()
      : !!selectedClientId && selectedLocationIds.length > 0)

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
    if (isTrial && subcontractorId.startsWith("vendor:")) {
      setSubcontractorId("unassigned")
    }
  }, [isTrial, subcontractorId])

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
            clientRate: Number(clientRate),
            subcontractorRate: Number(cleanerPay),
            notes: notes.trim() || null,
            isTrial,
            trialNotes: isTrial ? trialNotes.trim() || null : null,
          }),
        })

        if (!response.ok) throw new Error((await response.json()).error || "Failed to create job")

        // Attach any add-ons to the created job. A vendor add-on becomes payable via the vendor list.
        if (addOns.length > 0) {
          const createdJob = await response.json()
          for (const ao of addOns) {
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
      <DialogContent hideClose className="flex flex-col max-h-[92vh] max-w-[400px] overflow-hidden p-0">
        <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <DialogTitle className="text-[19px] font-bold tracking-tight text-slate-950">Add Job</DialogTitle>
          <DialogDescription className="sr-only">Add a new job: pick client, schedule, rates, and notes in one quick pass.</DialogDescription>
          <button aria-label="Close add job" onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Client</Label>
              <span className="text-[11px] font-medium text-slate-400">
                Search existing, or type a one-time job
              </span>
            </div>

            {clientMode === "existing" ? (
              <>
                {selectedClient ? (
                  <div className="flex items-start justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{selectedClient.name}</div>
                      <div className="truncate text-xs text-slate-500">
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
                  <div ref={clientPickerRef} className="relative space-y-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={search}
                        onClick={() => setDropOpen(true)}
                        onChange={event => {
                          setSearch(event.target.value)
                          setDropOpen(true)
                        }}
                        placeholder="Search or type new client name..."
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                    {dropOpen && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 space-y-1.5">
                        <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-md">
                          {filteredClients.map(client => {
                            const firstLoc = client.locations?.[0]
                            const subline = firstLoc?.address || client.phone || ""
                            return (
                              <button
                                key={client.id}
                                type="button"
                                onClick={() => chooseClient(client)}
                                className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-slate-950">{client.name}</span>
                                  {subline && <span className="block truncate text-xs text-slate-400">{subline}</span>}
                                </span>
                                <Check className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                              </button>
                            )
                          })}
                          {filteredClients.length === 0 && <div className="px-3 py-3 text-xs text-slate-400">No matching clients.</div>}
                        </div>
                        {typedClientName && !exactClientMatch && (
                          <button
                            type="button"
                            onClick={useTypedClientAsOneTime}
                            className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-900 shadow-sm hover:bg-amber-100"
                          >
                            <span className="min-w-0 truncate">Use &quot;{typedClientName}&quot; as a one-time client</span>
                            <Check className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedClient && locations.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Location</Label>
                    <div className="space-y-1">
                      {locations.map(location => {
                        const selected = selectedLocationIds.includes(location.id)
                        return (
                          <button
                            key={location.id}
                            type="button"
                            onClick={() => toggleLocation(location.id)}
                            className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${selected ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}
                          >
                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300"}`}>
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-900">{location.name}</span>
                              <span className="block truncate text-[11px] text-slate-400">{location.address}</span>
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
                <div className="grid grid-cols-2 gap-2">
                  <Input value={oneTimePhone} onChange={event => setOneTimePhone(event.target.value)} placeholder="Phone" className="h-9" />
                  <Input value={oneTimeEmail} onChange={event => setOneTimeEmail(event.target.value)} placeholder="Email" className="h-9" />
                </div>
              </div>
            )}
          </section>

          <div className="h-px bg-slate-100" />

          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Job type</Label>
                <div className="flex h-9 rounded-md bg-slate-100 p-0.5 text-[11px] font-semibold">
                  {([
                    { trial: false, label: "One-Time" },
                    { trial: true, label: "Trial" },
                  ] as const).map(option => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setIsTrial(option.trial)}
                      className={`flex-1 rounded transition-colors ${isTrial === option.trial ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Clean type</Label>
                <Select value={jobType} onValueChange={value => setJobType(value as JobType)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {jobTypes.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Date</Label>
                <Input
                  type="date"
                  value={toInputDate(jobDate)}
                  onChange={event => setJobDate(event.target.value ? new Date(`${event.target.value}T12:00:00`) : null)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Arrival</Label>
                <div className="flex h-9 rounded-md bg-slate-100 p-0.5 text-[11px] font-semibold">
                  {(["specific", "window", "tbd"] as TimeMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTimeMode(mode)}
                      className={`flex-1 rounded capitalize ${timeMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                    >
                      {mode === "specific" ? "Exact" : mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {timeMode === "specific" && <TimePicker value={startTime} onChange={setStartTime} />}
            {timeMode === "window" && (
              <div className="flex items-center gap-2">
                <div className="flex-1"><TimePicker value={startWindowBegin} onChange={setStartWindowBegin} /></div>
                <span className="text-xs text-slate-400">to</span>
                <div className="flex-1"><TimePicker value={startWindowEnd} onChange={setStartWindowEnd} /></div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div>
              <Label className="mb-1 block text-[11px] text-slate-500">Performed by</Label>
              <Select value={subcontractorId} onValueChange={setSubcontractorId}>
                <SelectTrigger className={`h-9 text-sm ${subcontractorId === "unassigned" ? "text-amber-700" : ""}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned"><span className="text-amber-700">Unassigned</span></SelectItem>
                  {activeCleaners.map(cleaner => <SelectItem key={cleaner.id} value={cleaner.id}>{cleaner.name}</SelectItem>)}
                  {!isTrial && activeVendors.length > 0 && (
                    <>
                      <div className="mt-1 border-t border-slate-100 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Vendors</div>
                      {activeVendors.map(vendor => <SelectItem key={`vendor:${vendor.id}`} value={`vendor:${vendor.id}`}>{vendor.name}</SelectItem>)}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">Client rate *</Label>
                <div className="relative">
                  <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input type="number" min="0" step="0.01" value={clientRate} onChange={event => setClientRate(event.target.value)} className="h-9 pl-7" placeholder="0.00" />
                </div>
              </div>
              <div>
                <Label className="mb-1 block text-[11px] text-slate-500">{subcontractorId.startsWith("vendor:") ? "Vendor pay *" : "Cleaner pay *"}</Label>
                <div className="relative">
                  <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input type="number" min="0" step="0.01" value={cleanerPay} onChange={event => setCleanerPay(event.target.value)} className="h-9 pl-7" placeholder="0.00" />
                </div>
              </div>
            </div>
            {(Number(clientRate) > 0 || Number(cleanerPay) > 0) && (
              <div className="text-right text-[11px]">
                <span className="text-slate-400">Margin: </span>
                <span className={`font-mono font-bold ${profit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  ${profit.toFixed(2)}
                </span>
              </div>
            )}
          </section>

          {!isTrial && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-slate-500">Add-ons</Label>
                {!addingAddOn && (
                  <button
                    type="button"
                    onClick={() => { setAddOnDraft({ description: '', vendorId: '', clientRate: '', subcontractorRate: '' }); setAddingAddOn(true) }}
                    className="text-[11px] font-semibold text-teal-700 hover:text-teal-800"
                  >
                    + Add
                  </button>
                )}
              </div>
              {addOns.map((ao, i) => {
                const m = (parseFloat(ao.clientRate) || 0) - (parseFloat(ao.subcontractorRate) || 0)
                const perf = ao.vendorId ? (addOnVendors.find(v => v.id === ao.vendorId)?.name || 'Vendor') : 'Cleaner (same as job)'
                return (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-slate-800">{ao.description}</div>
                      <div className="truncate text-[10.5px] text-slate-400">{perf}</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2 font-mono text-[11px]">
                      <span className={m >= 0 ? 'text-emerald-700' : 'text-red-600'}>${m.toFixed(0)}</span>
                      <button type="button" aria-label="Remove add-on" onClick={() => setAddOns(addOns.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500">×</button>
                    </div>
                  </div>
                )
              })}
              {addingAddOn && (
                <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50/60 p-2.5">
                  <Input value={addOnDraft.description} onChange={e => setAddOnDraft({ ...addOnDraft, description: e.target.value })} placeholder="Add-on name (e.g. Window cleaning)" className="h-8 text-sm" />
                  <select
                    value={addOnDraft.vendorId}
                    onChange={e => setAddOnDraft({ ...addOnDraft, vendorId: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-teal-500"
                  >
                    <option value="">Performed by: Cleaner (same as job)</option>
                    {addOnVendors.map(v => <option key={v.id} value={v.id}>Performed by: {v.name}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min="0" step="0.01" value={addOnDraft.clientRate} onChange={e => setAddOnDraft({ ...addOnDraft, clientRate: e.target.value })} placeholder="We charge" className="h-8 text-sm" />
                    <Input type="number" min="0" step="0.01" value={addOnDraft.subcontractorRate} onChange={e => setAddOnDraft({ ...addOnDraft, subcontractorRate: e.target.value })} placeholder="We pay" className="h-8 text-sm" />
                  </div>
                  <div className="flex justify-end gap-3 pt-0.5">
                    <button type="button" onClick={() => setAddingAddOn(false)} className="text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
                    <button
                      type="button"
                      disabled={!addOnDraft.description.trim() || !addOnDraft.clientRate}
                      onClick={() => { setAddOns([...addOns, addOnDraft]); setAddingAddOn(false) }}
                      className="rounded-md bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {isTrial && (
            <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div>
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
              </div>

              <div>
                <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-amber-800">Frequency</Label>
                <div className="flex flex-wrap gap-1.5">
                  {trialFrequencies.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTrialFrequency(option.value)}
                      className={`rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                        trialFrequency === option.value
                          ? "border-amber-500 bg-amber-100 text-amber-900"
                          : "border-amber-200 bg-white text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-amber-800">Days</Label>
                <div className="flex gap-1">
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
                        className={`flex h-8 flex-1 items-center justify-center rounded-md text-[12px] font-bold transition-colors ${
                          selected ? "bg-amber-500 text-white" : "border border-amber-200 bg-white text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        {letter}
                      </button>
                    )
                  })}
                </div>
                {trialDaysOfWeek.length === 0 && (
                  <p className="mt-1 text-[10.5px] font-medium text-amber-700">Pick at least one day for the trial visits.</p>
                )}
              </div>

              <div>
                <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-amber-800">Trial notes</Label>
                <textarea
                  value={trialNotes}
                  onChange={event => setTrialNotes(event.target.value)}
                  placeholder="Entry details, expectations, special prep..."
                  rows={2}
                  className="w-full resize-none rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
            </section>
          )}

          {!showNotes ? (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs font-semibold text-slate-400 hover:text-teal-700"
            >
              + Add notes
            </button>
          ) : (
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</Label>
                <button
                  type="button"
                  onClick={() => {
                    setShowNotes(false)
                    setNotes("")
                  }}
                  className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                >
                  Remove
                </button>
              </div>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Gate codes, parking, special instructions..."
                rows={2}
                className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </section>
          )}

          {selectedClient && selectedLocationIds.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-teal-700">
              <MapPin className="h-3 w-3" />
              {selectedLocationIds.length === 1 ? "1 selected location" : `${selectedLocationIds.length} selected locations`}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-slate-100 bg-white px-5 py-3">
          <button
            type="button"
            disabled={!canCreate || loading}
            onClick={createJob}
            className={`w-full h-11 rounded-md text-[14px] font-bold transition-colors ${
              canCreate && !loading
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {loading ? "Adding..." : isTrial ? "Schedule Trial" : "Schedule Job"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
