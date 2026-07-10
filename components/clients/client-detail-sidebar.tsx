"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react"
import { safeFormat } from "./client-detail-helpers"
import { AddContactSheet, type ClientContact } from "@/components/clients/contacts-section"
import { fetcher } from "@/lib/fetcher"
import { formatTime } from "@/lib/utils"
import { parseDateOnly } from "@/lib/date-only"
import type { JobWithLocation } from "./client-detail-types"
import type { ClientDetailState } from "./use-client-detail"

interface ClientDetailSidebarProps {
  state: ClientDetailState
}

export function ClientDetailContactSummary({ state }: ClientDetailSidebarProps) {
  const {
    client,
    hasDifferentInvoicingEmail,
    setEditingContact,
  } = state
  const { data, mutate } = useSWR(`/api/clients/${client.id}/contacts`, fetcher)
  const contacts: ClientContact[] = data?.contacts || []
  const [showAddContact, setShowAddContact] = useState(false)

  const communicationName = client.communicationContactName || client.invoicingContactName || "No contact name"
  const communicationEmail = client.communicationEmail || "No email"
  const invoiceEmail = client.invoicingEmail || client.communicationEmail || "No invoice email"
  const invoiceCc = client.invoicingCcEmail || ""
  const extraContacts = contacts
    .filter((contact) => contact.name && contact.name !== client.communicationContactName && contact.name !== client.invoicingContactName)
    .slice(0, 2)

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
        <span className="font-semibold text-slate-900">{communicationName}</span>
        <span className="text-slate-300">·</span>
        <a href={client.phone ? `tel:${client.phone}` : undefined} className="hover:text-teal-700">{client.phone || "No phone"}</a>
        <span className="text-slate-300">·</span>
        <a href={client.communicationEmail ? `mailto:${client.communicationEmail}` : undefined} className="hover:text-teal-700">{communicationEmail}</a>
        <span className="text-slate-300">·</span>
        <span>
          Invoice to: <a href={invoiceEmail !== "No invoice email" ? `mailto:${invoiceEmail}` : undefined} className="hover:text-teal-700">{invoiceEmail}</a>
        </span>
        {invoiceCc && (
          <>
            <span className="text-slate-300">Â·</span>
            <span>CC: {invoiceCc}</span>
          </>
        )}
        {hasDifferentInvoicingEmail && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">Different</span>
        )}
        {extraContacts.map((contact) => (
          <span key={contact.id} className="contents">
            <span className="text-slate-300">·</span>
            <span>{contact.name}</span>
          </span>
        ))}
        <button onClick={() => setEditingContact(true)} className="ml-auto text-sm font-semibold text-teal-700 hover:text-teal-800">
          Edit
        </button>
        <button onClick={() => setShowAddContact(true)} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
          + Add Contact
        </button>
      </div>
      {showAddContact && (
        <AddContactSheet
          clientId={client.id}
          onSave={() => { mutate(); setShowAddContact(false) }}
          onClose={() => setShowAddContact(false)}
        />
      )}
    </div>
  )
}

export function ClientDetailSidebar({ state }: ClientDetailSidebarProps) {
  const { client } = state
  // Archive / Delete moved to the header "⋯" menu — only the notes strip remains here.
  if (!client.notes) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">Notes</p>
      <p className="text-sm italic text-amber-950">&quot;{client.notes}&quot;</p>
    </div>
  )
}

interface ClientDetailJobFeedProps {
  state: ClientDetailState
}

function getJobTimeLabel(job: JobWithLocation) {
  if (job.startTime) return formatTime(job.startTime)
  if (job.startWindowBegin || job.startWindowEnd) {
    const begin = job.startWindowBegin ? formatTime(job.startWindowBegin) : ""
    const end = job.startWindowEnd ? formatTime(job.startWindowEnd) : ""
    return `${begin}${begin && end ? "-" : ""}${end}`
  }
  return "No time"
}

function getFirstName(name: string | null | undefined) {
  if (!name) return "Unassigned"
  return name.trim().split(/\s+/)[0] || name
}

function compactLocationName(locationName: string, clientName: string) {
  let name = (locationName || "Location").trim()
  const client = clientName.trim()
  if (client && name.toLowerCase().startsWith(client.toLowerCase())) {
    name = name.slice(client.length).trim()
  }
  name = name.replace(/^\((.*)\)$/, "$1").trim()
  return name || locationName || "Location"
}

export function ClientDetailJobFeed({ state }: ClientDetailJobFeedProps) {
  const {
    router,
    upcomingJobs,
    client,
  } = state
  const [locationFilter, setLocationFilter] = useState("all")
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<"list" | "calendar">("list")

  const locationOptions = useMemo(() => {
    return (client.locations || []).map((location) => ({
      id: location.id,
      name: compactLocationName(location.name || "Location", client.name),
    }))
  }, [client.locations, client.name])

  const displayJobs = useMemo(() => {
    if (locationFilter === "all") return upcomingJobs
    return upcomingJobs.filter((job) => job.location.id === locationFilter)
  }, [upcomingJobs, locationFilter])

  const calendarJobs = useMemo(() => {
    const jobs = (client.locations || []).flatMap((location) =>
      (location.jobs || []).map((job) => ({
        ...job,
        location: { id: location.id, name: location.name },
      })),
    )
    if (locationFilter === "all") return jobs
    return jobs.filter((job) => job.location.id === locationFilter)
  }, [client.locations, locationFilter])

  // Show only the next few by default; "Show all" expands (cockpit density, dev-note #13)
  const visibleJobs = showAll ? displayJobs : displayJobs.slice(0, 6)

  const groupedJobs = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    let lastKey = ""
    const groups: Array<
      | { type: "date"; key: string; label: string }
      | { type: "job"; key: string; job: JobWithLocation }
    > = []

    visibleJobs.forEach((job) => {
      const jobDate = new Date(job.date)
      const day = new Date(jobDate)
      day.setHours(0, 0, 0, 0)
      const dayKey = safeFormat(day, "yyyy-MM-dd", "unknown")
      const label =
        day.getTime() === today.getTime()
          ? "Today"
          : day.getTime() === tomorrow.getTime()
            ? "Tomorrow"
            : safeFormat(jobDate, "EEE, MMM d")

      if (dayKey !== lastKey) {
        groups.push({ type: "date", key: dayKey, label })
        lastKey = dayKey
      }
      groups.push({ type: "job", key: job.id, job })
    })

    return groups
  }, [visibleJobs])

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--cf-rule)] bg-[var(--cf-surface)] shadow-[var(--cf-panel-shadow)]">
      <div className="border-b border-[var(--cf-rule-soft)]">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="text-sm font-bold text-[var(--cf-ink)]">
            {view === "list" ? `Upcoming (${upcomingJobs.length})` : `Jobs calendar (${calendarJobs.length})`}
          </div>
          <div className="flex items-center rounded-md bg-[var(--cf-field)] p-0.5" aria-label="Job display">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${view === "list" ? "bg-white text-[var(--cf-ink)] shadow-sm" : "text-[var(--cf-ink-muted)] hover:text-[var(--cf-ink)]"}`}
              aria-label="Show upcoming jobs list"
              title="List"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${view === "calendar" ? "bg-white text-[var(--cf-ink)] shadow-sm" : "text-[var(--cf-ink-muted)] hover:text-[var(--cf-ink)]"}`}
              aria-label="Show all jobs calendar"
              title="Calendar"
            >
              <CalendarDays className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {locationOptions.length > 1 && (
          <div className="px-3 pb-3 pt-2">
            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-teal-500 focus:bg-white"
            >
              <option value="all">All locations</option>
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {view === "calendar" ? (
        <ClientJobsCalendar
          jobs={calendarJobs}
          clientName={client.name}
          onOpen={(jobId) => router.push(`/calendar?jobId=${jobId}`)}
        />
      ) : displayJobs.length > 0 ? (
        <>
        <div className="max-h-[560px] divide-y divide-gray-50 overflow-y-auto">
          {groupedJobs.map((item) => {
            if (item.type === "date") {
              return (
                <div key={item.key} className="bg-gray-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {item.label}
                </div>
              )
            }

            const job = item.job
            const isCancelled = job.status === "CANCELLED"
            return (
              <div
                key={job.id}
                onClick={() => router.push(`/calendar?jobId=${job.id}`)}
                className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                style={isCancelled ? { opacity: 0.45 } : {}}
              >
                <span className="w-[74px] flex-shrink-0 text-slate-500">{getJobTimeLabel(job)}</span>
                <span className="min-w-0 flex-1 text-gray-800">{compactLocationName(job.location.name, client.name)}</span>
                <span className="flex-shrink-0 text-slate-500">{getFirstName(job.subcontractor?.name)}</span>
              </div>
            )
          })}
        </div>
        {displayJobs.length > 6 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="w-full border-t border-gray-100 px-4 py-2 text-[12px] font-semibold text-teal-700 hover:bg-gray-50"
          >
            {showAll ? "Show less" : `Show all ${displayJobs.length}`}
          </button>
        )}
        </>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">
            {locationFilter === "all" ? "No upcoming jobs" : "No upcoming jobs for this location"}
          </p>
        </div>
      )}
    </div>
  )
}

function ClientJobsCalendar({
  jobs,
  clientName,
  onOpen,
}: {
  jobs: JobWithLocation[]
  clientName: string
  onOpen: (jobId: string) => void
}) {
  const initialMonth = useMemo(() => {
    const nextJob = jobs
      .map((job) => parseDateOnly(job.date))
      .filter((date): date is Date => !!date)
      .sort((a, b) => a.getTime() - b.getTime())
      .find((date) => date >= startOfMonth(new Date()))
    return startOfMonth(nextJob || new Date())
  }, [jobs])
  const [month, setMonth] = useState(initialMonth)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const datedJobs = useMemo(() => jobs.flatMap((job) => {
    const date = parseDateOnly(job.date)
    return date ? [{ job, date }] : []
  }), [jobs])

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  }), [month])

  const jobsForDate = (date: Date) => datedJobs
    .filter((item) => isSameDay(item.date, date))
    .map((item) => item.job)
    .sort((a, b) => getJobTimeLabel(a).localeCompare(getJobTimeLabel(b)))

  const selectedJobs = selectedDate ? jobsForDate(selectedDate) : []

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setMonth((current) => subMonths(current, 1)); setSelectedDate(null) }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cf-rule)] text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="text-[13px] font-extrabold text-[var(--cf-ink)]">{format(month, "MMMM yyyy")}</div>
        <button
          type="button"
          onClick={() => { setMonth((current) => addMonths(current, 1)); setSelectedDate(null) }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cf-rule)] text-[var(--cf-ink-secondary)] hover:bg-[var(--cf-field)]"
          aria-label="Next month"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[9px] font-extrabold uppercase tracking-[0.04em] text-[var(--cf-ink-muted)]">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <div key={`${label}-${index}`} className="py-1">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-[var(--cf-rule-soft)] bg-[var(--cf-rule-soft)] gap-px">
        {days.map((day) => {
          const dayJobs = jobsForDate(day)
          const selected = selectedDate ? isSameDay(selectedDate, day) : false
          const recurringCount = dayJobs.filter((job) => !!job.scheduleId && job.status !== 'CANCELLED').length
          const oneTimeCount = dayJobs.filter((job) => !job.scheduleId && job.status !== 'CANCELLED').length
          const cancelledCount = dayJobs.filter((job) => job.status === 'CANCELLED').length
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setSelectedDate(day)}
              className={`relative aspect-square min-h-[38px] bg-white p-1 text-left transition-colors hover:bg-[var(--cf-surface-hover)] ${selected ? 'ring-2 ring-inset ring-[var(--cf-green)]' : ''}`}
              aria-label={`${format(day, 'MMMM d')}, ${dayJobs.length} job${dayJobs.length === 1 ? '' : 's'}`}
            >
              <span className={`text-[10px] font-bold ${isSameMonth(day, month) ? 'text-[var(--cf-ink-secondary)]' : 'text-stone-300'}`}>{format(day, 'd')}</span>
              {dayJobs.length > 0 && (
                <span className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-0.5" aria-hidden="true">
                  {recurringCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--cf-green)]" />}
                  {oneTimeCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  {cancelledCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] font-bold text-[var(--cf-ink-muted)]">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--cf-green)]" />Recurring</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />One-time</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-stone-400" />Cancelled</span>
      </div>

      {selectedDate && (
        <div className="mt-3 border-t border-[var(--cf-rule-soft)] pt-3">
          <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.05em] text-[var(--cf-ink-muted)]">
            {format(selectedDate, 'EEE, MMM d')} / {selectedJobs.length} job{selectedJobs.length === 1 ? '' : 's'}
          </div>
          {selectedJobs.length > 0 ? (
            <div className="space-y-1">
              {selectedJobs.map((job) => {
                const cancelled = job.status === 'CANCELLED'
                const kind = job.scheduleId ? 'Recurring' : job.vendorId ? 'Vendor' : 'One-time'
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onOpen(job.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-[var(--cf-rule-soft)] bg-[var(--cf-surface-soft)] px-2.5 py-2 text-left hover:bg-[var(--cf-surface-hover)]"
                  >
                    <span className={`h-2 w-2 flex-none rounded-full ${cancelled ? 'bg-stone-400' : job.scheduleId ? 'bg-[var(--cf-green)]' : 'bg-amber-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[11px] font-bold text-[var(--cf-ink)] ${cancelled ? 'line-through opacity-60' : ''}`}>{compactLocationName(job.location.name, clientName)}</span>
                      <span className="block truncate text-[10px] text-[var(--cf-ink-muted)]">{getJobTimeLabel(job)} / {kind}{job.subcontractor?.name ? ` / ${getFirstName(job.subcontractor.name)}` : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md bg-[var(--cf-field)] px-3 py-4 text-center text-[11px] text-[var(--cf-ink-muted)]">No jobs on this date</div>
          )}
        </div>
      )}
    </div>
  )
}
