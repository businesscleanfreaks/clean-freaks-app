"use client"

import { useMemo } from "react"
import { formatCurrency, formatTime } from "@/lib/utils"
import { format } from "date-fns"
import { ContactsSection } from "@/components/clients/contacts-section"
import type { JobWithLocation } from "./client-detail-types"
import type { ClientDetailState } from "./use-client-detail"

interface ClientDetailSidebarProps {
  state: ClientDetailState
}

export function ClientDetailSidebar({ state }: ClientDetailSidebarProps) {
  const {
    router,
    client,
    stats,
    isActive,
    hasDifferentInvoicingEmail,
    upcomingJobs,
    recentJobs,
    displayJobs,
    jobTab,
    setJobTab,
    setEditingContact,
  } = state

  return (
    <>
      {/* CONTACT INFORMATION — iOS-style rows */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.16em]">Contact Information</h2>
          <button onClick={() => setEditingContact(true)} className="text-sm font-medium transition-colors" style={{ color: '#00A896' }}>Edit</button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {/* Phone */}
          <a
            href={client.phone ? `tel:${client.phone}` : undefined}
            className="flex items-center px-4 py-3 hover:bg-gray-50 transition-colors group"
          >
            <span className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 mr-3">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Phone</p>
              <p className="text-sm font-medium text-gray-900 truncate">{client.phone || '—'}</p>
            </div>
            <svg className="w-4 h-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </a>

          {/* Communication Contact */}
          <a
            href={client.communicationEmail ? `mailto:${client.communicationEmail}` : undefined}
            className="flex items-center px-4 py-3 hover:bg-gray-50 transition-colors group"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mr-3">
              <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Communication</p>
              {client.communicationContactName && <p className="text-sm font-medium text-gray-900">{client.communicationContactName}</p>}
              <p className="text-sm text-slate-700 truncate">{client.communicationEmail || '—'}</p>
              {client.communicationPhone && <p className="text-xs text-slate-500 mt-0.5">{client.communicationPhone}</p>}
            </div>
            <svg className="w-4 h-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </a>

          {/* Invoicing Contact */}
          <a
            href={`mailto:${client.invoicingEmail || client.communicationEmail || ''}`}
            className="flex items-center px-4 py-3 hover:bg-gray-50 transition-colors group"
          >
            <span className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mr-3">
              <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                Invoicing
                {hasDifferentInvoicingEmail && <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-semibold normal-case tracking-normal">Different</span>}
              </p>
              {(client.invoicingContactName || client.communicationContactName) && (
                <p className="text-sm font-medium text-gray-900">{client.invoicingContactName || client.communicationContactName}</p>
              )}
              <p className="text-sm text-slate-700 truncate">{client.invoicingEmail || client.communicationEmail || '—'}</p>
            </div>
            <svg className="w-4 h-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </a>

          {/* Primary Cleaner */}
          <div className="flex items-center px-4 py-3">
            <span className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0 mr-3">
              <svg className="w-3.5 h-3.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Primary Cleaner</p>
              <p className="text-sm font-medium text-gray-900">{stats.primaryWorker}</p>
            </div>
          </div>

          {/* Payment Method */}
          {client.preferredPaymentMethod && (
            <div className="flex items-center px-4 py-3">
              <span className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0 mr-3">
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider">Payment Method</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold mt-0.5" style={{
                  background: client.preferredPaymentMethod === 'ZELLE' ? '#EFF6FF' :
                    client.preferredPaymentMethod === 'DIRECT_DEPOSIT' ? '#F0FDF4' :
                    client.preferredPaymentMethod === 'CHECK' ? '#FEF3C7' : '#F3F4F6',
                  color: client.preferredPaymentMethod === 'ZELLE' ? '#2563EB' :
                    client.preferredPaymentMethod === 'DIRECT_DEPOSIT' ? '#059669' :
                    client.preferredPaymentMethod === 'CHECK' ? '#D97706' : '#6B7280',
                }}>
                  {client.preferredPaymentMethod === 'ZELLE' ? 'Zelle' :
                   client.preferredPaymentMethod === 'DIRECT_DEPOSIT' ? 'Direct Deposit' :
                   client.preferredPaymentMethod === 'CHECK' ? 'Check' : 'Other'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONTACTS */}
      <ContactsSection clientId={client.id} />

      {/* NOTES */}
      {client.notes && (
        <div className="rounded-xl p-4" style={{ background: '#FFFBEF', border: '1px solid #FDE68A' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#92400E' }}>Notes</p>
          <p className="text-sm italic" style={{ color: '#78350F' }}>&quot;{client.notes}&quot;</p>
        </div>
      )}

      {/* ARCHIVE / DELETE CLIENT */}
      <div id="client-remove-section" className="pt-1 flex flex-col gap-2 scroll-mt-28">
        {state.clientHasHistory ? (
          <button
            onClick={state.handleArchiveClient}
            disabled={!isActive}
            className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-700 transition-colors"
            style={!isActive ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
            Archive Client
          </button>
        ) : (
          <button
            onClick={state.handleDeleteClient}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete Permanently
          </button>
        )}
      </div>
    </>
  )
}

interface ClientDetailJobFeedProps {
  state: ClientDetailState
}

export function ClientDetailJobFeed({ state }: ClientDetailJobFeedProps) {
  const {
    router,
    upcomingJobs,
    recentJobs,
    displayJobs,
    jobTab,
    setJobTab,
    client,
  } = state

  const jobRateOverrideNotes = useMemo(() => {
    const scheduleById = new Map<string, { defaultClientRate: number }>()
    client.locations?.forEach((loc) => {
      loc.schedules?.forEach((s) => {
        scheduleById.set(s.id, { defaultClientRate: s.defaultClientRate ?? 0 })
      })
    })
    const lines: string[] = []
    client.locations?.forEach((loc) => {
      loc.jobs?.forEach((job) => {
        if (!job.scheduleId || job.status === 'CANCELLED' || job.invoiced) return
        const def = scheduleById.get(job.scheduleId)
        if (!def) return
        if (Math.abs((job.clientRate || 0) - def.defaultClientRate) > 0.009) {
          lines.push(
            `${format(new Date(job.date), 'MMM d')}: ${formatCurrency(job.clientRate)} billed vs schedule ${formatCurrency(def.defaultClientRate)}`
          )
        }
      })
    })
    return [...new Set(lines)].slice(0, 10)
  }, [client])

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {jobRateOverrideNotes.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/80">
          <p className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide mb-1.5">Billing notes</p>
          <ul className="text-xs text-amber-950 space-y-1 list-disc pl-4">
            {jobRateOverrideNotes.map((line) => (
              <li key={line}>Per-clean rate override — {line}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setJobTab('upcoming')}
          className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${jobTab === 'upcoming' ? 'text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          style={jobTab === 'upcoming' ? { borderBottomColor: '#00A896' } : {}}
        >
          Upcoming ({upcomingJobs.length})
        </button>
        <button
          onClick={() => setJobTab('recent')}
          className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${jobTab === 'recent' ? 'text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          style={jobTab === 'recent' ? { borderBottomColor: '#00A896' } : {}}
        >
          Recent ({recentJobs.length})
        </button>
      </div>

      {/* Job rows — compact single-line */}
      {displayJobs.length > 0 ? (
        <div className="divide-y divide-gray-50 max-h-[640px] overflow-y-auto">
          {displayJobs.map((job: JobWithLocation) => {
            const jobDate = new Date(job.date)
            const dateStr = format(jobDate, 'EEE, MMM d')
            const timeStr = job.startTime ? formatTime(job.startTime) : null
            const isCancelled = job.status === 'CANCELLED'
            return (
              <div
                key={job.id}
                onClick={() => router.push(`/calendar?jobId=${job.id}`)}
                className="flex items-center px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors gap-3"
                style={isCancelled ? { opacity: 0.45 } : {}}
              >
                <span className="text-sm text-slate-600 flex-shrink-0" style={{ width: 88 }}>{dateStr}</span>
                {timeStr && <span className="text-sm text-slate-500 flex-shrink-0" style={{ width: 60 }}>{timeStr}</span>}
                <span className="text-sm text-gray-800 flex-1 truncate">{job.location.name}</span>
                <span className="text-sm text-slate-500 flex-shrink-0 truncate" style={{ maxWidth: 80 }}>{job.subcontractor?.name || '—'}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-500">{jobTab === 'upcoming' ? 'No upcoming jobs' : 'No recent activity'}</p>
        </div>
      )}
    </div>
  )
}
