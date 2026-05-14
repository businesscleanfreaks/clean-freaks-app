"use client"

import { useMemo, useState } from "react"
import { formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { ContactsSection } from "@/components/clients/contacts-section"
import type { JobWithLocation } from "./client-detail-types"
import type { ClientDetailState } from "./use-client-detail"

interface ClientDetailSidebarProps {
  state: ClientDetailState
}

export function ClientDetailContactSummary({ state }: ClientDetailSidebarProps) {
  const {
    client,
    stats,
    hasDifferentInvoicingEmail,
    setEditingContact,
  } = state

  const communicationName = client.communicationContactName || client.invoicingContactName || "No contact name"
  const communicationEmail = client.communicationEmail || "No email"
  const invoiceEmail = client.invoicingEmail || client.communicationEmail || "No invoice email"

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
        {hasDifferentInvoicingEmail && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">Different</span>
        )}
        <span className="text-slate-300">·</span>
        <span>Cleaner: {stats.primaryWorker}</span>
        <button onClick={() => setEditingContact(true)} className="ml-auto text-sm font-semibold text-teal-700 hover:text-teal-800">
          Edit
        </button>
      </div>
    </div>
  )
}

export function ClientDetailSidebar({ state }: ClientDetailSidebarProps) {
  const { client, isActive } = state

  return (
    <>
      <ContactsSection clientId={client.id} title="Additional Contacts" emptyText="No additional contacts yet" />

      {client.notes && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800">Notes</p>
          <p className="text-sm italic text-amber-950">&quot;{client.notes}&quot;</p>
        </div>
      )}

      <div id="client-remove-section" className="pt-1 flex flex-col gap-2 scroll-mt-28">
        {state.clientHasHistory ? (
          <button
            onClick={state.handleArchiveClient}
            disabled={!isActive || state.isArchivingClient}
            className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
            {state.isArchivingClient ? "Archiving..." : "Archive Client"}
          </button>
        ) : (
          <button
            onClick={state.handleDeleteClient}
            disabled={state.isDeletingClient}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            {state.isDeletingClient ? "Deleting..." : "Delete Permanently"}
          </button>
        )}
      </div>
    </>
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

export function ClientDetailJobFeed({ state }: ClientDetailJobFeedProps) {
  const {
    router,
    upcomingJobs,
    recentJobs,
    jobTab,
    setJobTab,
    client,
  } = state
  const [locationFilter, setLocationFilter] = useState("all")

  const locationOptions = useMemo(() => {
    return (client.locations || []).map((location) => ({
      id: location.id,
      name: location.name || "Location",
    }))
  }, [client.locations])

  const displayJobs = useMemo(() => {
    const jobs = jobTab === "upcoming" ? upcomingJobs : recentJobs
    if (locationFilter === "all") return jobs
    return jobs.filter((job) => job.location.id === locationFilter)
  }, [jobTab, upcomingJobs, recentJobs, locationFilter])

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

    displayJobs.forEach((job) => {
      const jobDate = new Date(job.date)
      const day = new Date(jobDate)
      day.setHours(0, 0, 0, 0)
      const dayKey = format(day, "yyyy-MM-dd")
      const label =
        day.getTime() === today.getTime()
          ? "Today"
          : day.getTime() === tomorrow.getTime()
            ? "Tomorrow"
            : format(jobDate, "EEE, MMM d")

      if (dayKey !== lastKey) {
        groups.push({ type: "date", key: dayKey, label })
        lastKey = dayKey
      }
      groups.push({ type: "job", key: job.id, job })
    })

    return groups
  }, [displayJobs])

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100">
        <div className="flex">
          <button
            onClick={() => setJobTab("upcoming")}
            className={`flex-1 border-b-2 py-2.5 text-sm font-medium transition-colors ${jobTab === "upcoming" ? "text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            style={jobTab === "upcoming" ? { borderBottomColor: "#00A896" } : {}}
          >
            Upcoming ({upcomingJobs.length})
          </button>
          <button
            onClick={() => setJobTab("recent")}
            className={`flex-1 border-b-2 py-2.5 text-sm font-medium transition-colors ${jobTab === "recent" ? "text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            style={jobTab === "recent" ? { borderBottomColor: "#00A896" } : {}}
          >
            Recent ({recentJobs.length})
          </button>
        </div>
        {locationOptions.length > 1 && (
          <div className="px-3 pb-3">
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

      {displayJobs.length > 0 ? (
        <div className="max-h-[640px] divide-y divide-gray-50 overflow-y-auto">
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
                <span className="min-w-0 flex-1 text-gray-800">{job.location.name}</span>
                <span className="flex-shrink-0 text-slate-500">{getFirstName(job.subcontractor?.name)}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">
            {locationFilter === "all"
              ? jobTab === "upcoming" ? "No upcoming jobs" : "No recent activity"
              : `No ${jobTab === "upcoming" ? "upcoming jobs" : "recent activity"} for this location`}
          </p>
        </div>
      )}
    </div>
  )
}
