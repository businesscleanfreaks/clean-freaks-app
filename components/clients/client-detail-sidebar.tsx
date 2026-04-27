"use client"

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
    hasDifferentInvoicingEmail,
    upcomingJobs,
    recentJobs,
    displayJobs,
    jobTab,
    setJobTab,
    setEditingContact,
    handleDeleteClient,
  } = state

  return (
    <>
      {/* CONTACT INFORMATION */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.16em]">Contact Information</h2>
          <button onClick={() => setEditingContact(true)} className="text-sm font-medium transition-colors" style={{ color: '#00A896' }}>Edit</button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mb-1">Phone</p>
              <a href={`tel:${client.phone}`} className="text-sm font-medium text-gray-900 hover:text-teal-700 transition-colors">{client.phone || '—'}</a>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mb-1">Communication Contact</p>
              {client.communicationContactName && <p className="text-sm font-medium text-gray-900">{client.communicationContactName}</p>}
              <a href={`mailto:${client.communicationEmail}`} className="text-sm text-slate-700 hover:text-teal-700 transition-colors">{client.communicationEmail || '—'}</a>
              {client.communicationPhone && (
                <a href={`tel:${client.communicationPhone}`} className="block text-sm text-slate-600 hover:text-teal-700 transition-colors mt-0.5">{client.communicationPhone}</a>
              )}
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mb-1">Primary Cleaner</p>
              <p className="text-sm font-medium text-gray-900">{stats.primaryWorker}</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mb-1">Invoicing Contact</p>
              {(client.invoicingContactName || client.communicationContactName) && (
                <p className="text-sm font-medium text-gray-900">{client.invoicingContactName || client.communicationContactName}</p>
              )}
              <a href={`mailto:${client.invoicingEmail || client.communicationEmail}`} className="text-sm text-slate-700 hover:text-teal-700 transition-colors">
                {client.invoicingEmail || client.communicationEmail || '—'}
              </a>
              {(client.invoicingPhone || client.communicationPhone) && (
                <a href={`tel:${client.invoicingPhone || client.communicationPhone}`} className="block text-sm text-slate-600 hover:text-teal-700 transition-colors mt-0.5">
                  {client.invoicingPhone || client.communicationPhone}
                </a>
              )}
              {hasDifferentInvoicingEmail && <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Different</span>}
            </div>
            {client.preferredPaymentMethod && (
              <div>
                <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mb-1">Payment Method</p>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{
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
            )}
          </div>
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

      {/* DELETE CLIENT */}
      <div className="pt-1">
        <button onClick={handleDeleteClient} className="text-sm text-slate-500 hover:text-red-500 transition-colors">
          Delete this client
        </button>
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
  } = state

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
