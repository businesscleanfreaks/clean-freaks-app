"use client"

import { useState } from "react"
import useSWR from "swr"
import { useClientDetail } from "./use-client-detail"
import { ClientDetailHeader } from "./client-detail-header"
import { ClientDetailLocations } from "./client-detail-locations"
import { ClientDetailSidebar, ClientDetailJobFeed } from "./client-detail-sidebar"
import { ClientDetailModals } from "./client-detail-modals"
import { safeFormat } from "./client-detail-helpers"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import type { ClientWithDetails } from "@/lib/types"
import { ClientNotesPanel, OpenIssuesEditor, WhatToKnow, type ClientNote } from "./client-notes-panel"
import { ContactsSection } from "./contacts-section"
import { AtAGlanceStrip, type CockpitTab } from "./cockpit/at-a-glance-strip"
import { PauseServiceModal } from "./cockpit/pause-service-modal"
import { ProrationCard } from "./cockpit/proration-card"
import { TrialStatusPanel } from "./cockpit/trial-status-panel"
import { Pause } from "lucide-react"

const notesFetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

const TRIAL_DURATION_LABEL: Record<string, string> = { '1wk': '1 week', '2wk': '2 weeks', '3wk': '3 weeks', '1mo': '1 month' }

// Trial clients store their parameters as a "TRIAL CLIENT" note block from the Add Client wizard.
function parseTrialDetails(notes: string | null | undefined): { duration?: string; proposedRate?: string } | null {
  if (!notes || !notes.toUpperCase().includes('TRIAL CLIENT')) return null
  const out: { duration?: string; proposedRate?: string } = {}
  for (const raw of notes.split('\n')) {
    const l = raw.trim()
    if (/^duration:/i.test(l)) out.duration = l.replace(/^duration:/i, '').trim()
    else if (/^proposed rate/i.test(l)) out.proposedRate = l.replace(/^proposed rate[^:]*:/i, '').trim()
  }
  return out
}

interface ClientDetailViewProps {
  client: ClientWithDetails
  onDataChange?: () => void
}

const TABS: { key: CockpitTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'billing', label: 'Billing' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'access', label: 'Access' },
  { key: 'scope', label: 'Scope' },
  { key: 'history', label: 'History' },
]

export function ClientDetailView({ client: initialClient, onDataChange }: ClientDetailViewProps) {
  const state = useClientDetail({ client: initialClient, onDataChange })
  const { mounted, ConfirmDialog } = state
  const [activeTab, setActiveTab] = useState<CockpitTab>('overview')
  const [pauseOpen, setPauseOpen] = useState(false)

  const activeSchedules = state.client.locations.flatMap(loc =>
    (loc.schedules || []).filter(s => s.isActive).map(s => ({
      id: s.id,
      locationName: loc.name || loc.address?.split(',')[0] || 'Location',
      cadence: s.frequency.toLowerCase().replace(/_/g, ' '),
    }))
  )

  if (!mounted) {
    return (
      <>
        <ConfirmDialog />
        <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>
          <div className="bg-white border-b border-gray-200">
            <div className="px-4 sm:px-6 py-4">
              <div className="h-5 w-28 rounded bg-gray-100 mb-4" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
                  <div className="space-y-2 min-w-0">
                    <div className="h-6 w-48 rounded bg-gray-100" />
                    <div className="h-4 w-64 rounded bg-gray-100" />
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-gray-100" />
                    <div className="h-5 w-24 rounded bg-gray-100" />
                  </div>
                  <div className="w-px h-8 bg-gray-200" />
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-gray-100" />
                    <div className="h-5 w-24 rounded bg-gray-100" />
                  </div>
                  <div className="h-8 w-20 rounded-full bg-gray-100" />
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-6 py-6 space-y-4">
            <div className="h-24 rounded-2xl bg-white border border-gray-200/60" />
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="h-72 rounded-2xl bg-white border border-gray-200/60" />
              <div className="h-72 rounded-2xl bg-white border border-gray-200/60" />
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <ClientDetailModals
        state={state}
        onOpenRecurringSchedule={(locationId) => {
          state.setExpandedLocation(locationId)
          state.setAddingScheduleToLocation(locationId)
          setActiveTab('schedule')
        }}
      />
      {pauseOpen && (
        <PauseServiceModal
          schedules={activeSchedules}
          onClose={() => setPauseOpen(false)}
          onDone={() => state.router.refresh()}
        />
      )}

      <div className="min-h-screen bg-[var(--cf-canvas)]" style={{ overscrollBehavior: 'none' }}>
        <ClientDetailHeader state={state} />

        {/* At-a-glance strip — visible above every tab */}
        <AtAGlanceStrip client={state.client} nextClean={state.nextClean} onJumpTo={setActiveTab} />

        {/* Cockpit Tabs */}
        <div className="bg-white border-b border-gray-200">
          <div className="px-4 sm:px-7">
            <div className="flex items-center gap-1 overflow-x-auto">
              {TABS.map(tab => {
                const isActive = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative px-4 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                      isActive ? 'text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'
                    }`}
                  >
                    {tab.label}
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-0 bottom-0 h-0.5 bg-slate-900"
                      style={{ opacity: isActive ? 1 : 0, transition: 'opacity 120ms' }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Main Body */}
        <div className="px-4 sm:px-7 py-5">
          {activeTab === 'overview' && <OverviewTab state={state} onJumpToTab={setActiveTab} />}
          {activeTab === 'schedule' && (
            <div className="space-y-3">
              {activeSchedules.length > 0 && (
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setPauseOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    <Pause size={13} /> Pause service
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4">
                <div className="space-y-4 order-2 lg:order-1">
                  <ClientDetailLocations state={state} />
                  <ClientDetailSidebar state={state} />
                </div>
                <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start">
                  <ClientDetailJobFeed state={state} />
                </div>
              </div>
            </div>
          )}
          {activeTab === 'billing' && <BillingTab state={state} onJumpToTab={setActiveTab} />}
          {activeTab === 'contacts' && <ContactsTab state={state} />}
          {activeTab === 'access' && <AccessTab state={state} />}
          {activeTab === 'scope' && <ScopeTab state={state} />}
          {activeTab === 'history' && <HistoryTab state={state} />}
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Overview tab: snapshot card on the left, notes + upcoming on the right
// ────────────────────────────────────────────────────────────────────────────

type ClientDetailState = ReturnType<typeof useClientDetail>

function OverviewTab({ state, onJumpToTab }: { state: ClientDetailState; onJumpToTab: (tab: CockpitTab) => void }) {
  const { client, nextClean, locationCount } = state
  const { data: notesData, mutate: mutateNotes } = useSWR<ClientNote[]>(`/api/clients/${client.id}/notes`, notesFetcher, { revalidateOnFocus: false })
  const notes = notesData || []
  const pinnedNotes = notes.filter(n => n.isPinned)
  const trial = parseTrialDetails(client.notes)
  const primaryLocation = client.locations[0]
  const primarySchedule = primaryLocation?.schedules?.find(s => s.isActive)
  const cleanerName = primarySchedule?.subcontractor?.name || 'Unassigned'
  const primaryContact = client.communicationContactName || '—'
  const primaryPhone = client.phone || ''
  const invoiceEmail = client.invoicingEmail || client.communicationEmail || '—'
  const billing = client.billingType === 'FLAT_RATE' ? 'Flat rate' : 'Per clean'
  const billingRateLine = primarySchedule?.defaultClientRate
    ? `${billing} · ${formatCurrency(primarySchedule.defaultClientRate)}${client.billingType === 'FLAT_RATE' ? '/mo' : '/clean'}`
    : billing
  const locationsLine = client.locations.length === 0
    ? 'No locations yet'
    : client.locations.map(l => l.name || l.address?.split(',')[0] || 'Location').join(', ')
  const hasAccessInfo = client.locations.some(l => l.accessInfo && l.accessInfo.trim().length > 0)
  // nextClean.date is already a display string ('Today' / 'Tomorrow' / 'Wed, Jun 3'),
  // so render it as-is. Do NOT new Date()/format() it — new Date('Today') is Invalid
  // and format() then throws "Invalid time value", crashing the whole cockpit.
  const nextCleanLabel = nextClean
    ? `${nextClean.date}${nextClean.time ? ' · ' + nextClean.time : ''}`
    : 'No upcoming cleans'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
      <div className="space-y-4">
        {trial && (
          <TrialStatusPanel client={client} proposedRate={trial.proposedRate} onDone={() => state.router.refresh()} />
        )}
        {/* Snapshot card */}
        <section className="rounded-[10px] bg-white" style={{ border: '1px solid #E4E4E7' }}>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Client overview</span>
            <button
              onClick={() => onJumpToTab('schedule')}
              className="text-[11px] font-semibold text-teal-700 hover:text-teal-800"
            >
              Edit on Schedule →
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <SnapRow label="Primary contact" value={primaryContact + (primaryPhone ? ` · ${primaryPhone}` : '')} />
            <SnapRow label="Next clean" value={nextCleanLabel} highlight />
            <SnapRow label="Schedule" value={primarySchedule ? buildScheduleLine(primarySchedule) : 'No active schedule'} />
            <SnapRow label="Assigned cleaner" value={cleanerName} muted={cleanerName === 'Unassigned'} />
            <SnapRow label="Billing" value={billingRateLine} />
            <SnapRow label="Invoice email" value={invoiceEmail} />
            <SnapRow label="Locations" value={`${locationCount} · ${locationsLine}`} />
            <SnapRow label="Access info" value={hasAccessInfo ? '✓ Saved' : '— Not set'} muted={!hasAccessInfo} />
          </div>
          <div className="px-5 pb-4">
            {trial && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8 }}>
                <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#2563EB', marginBottom: 6 }}>Trial Details</div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[12px]">
                  {trial.duration && <div><span className="text-slate-400">Duration </span><span className="font-medium text-slate-900">{TRIAL_DURATION_LABEL[trial.duration] || trial.duration}</span></div>}
                  {trial.proposedRate && <div><span className="text-slate-400">Proposed rate </span><span className="font-medium text-slate-900">{trial.proposedRate}</span></div>}
                  {!trial.duration && !trial.proposedRate && <div className="text-slate-500">Trial in progress</div>}
                </div>
              </div>
            )}
            <OpenIssuesEditor clientId={client.id} initial={client.openIssues || []} />
            <WhatToKnow pinned={pinnedNotes} />
          </div>
        </section>

        <OverviewJobHistory client={client} />

      </div>

      {/* Right rail: notes + job feed */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <ClientNotesPanel clientId={client.id} notes={notes} onChange={mutateNotes} />
        <ClientDetailJobFeed state={state} />
      </div>
    </div>
  )
}

// One-Time Services & Job History — recent standalone (non-recurring) cleans for this client.
function OverviewJobHistory({ client }: { client: ClientWithDetails }) {
  const [showAll, setShowAll] = useState(false)
  const jobs = client.locations
    .flatMap(loc => (loc.jobs || []).map(j => ({ ...j, locationName: loc.name || loc.address?.split(',')[0] || 'Location' })))
    .filter(j => !j.scheduleId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (jobs.length === 0) return null
  const visible = showAll ? jobs : jobs.slice(0, 3)

  return (
    <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">One-Time Services &amp; Job History</span>
        <span className="text-[11px] text-zinc-400">{jobs.length}</span>
      </div>
      <div className="space-y-1.5">
        {visible.map(j => {
          const margin = (j.clientRate ?? 0) - (j.subcontractorRate ?? 0)
          const sc = j.status === 'COMPLETED'
            ? { bg: '#DCFCE7', text: '#15803D' }
            : j.status === 'CANCELLED'
              ? { bg: '#FEE2E2', text: '#B91C1C' }
              : { bg: '#F1F5F9', text: '#475569' }
          return (
            <div key={j.id} className="flex items-center gap-2.5 rounded-md px-2.5 py-2" style={{ border: '1px solid #F1F5F9' }}>
              <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: '#EFF6FF', color: '#2563EB' }}>One-Time</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-zinc-800">{j.locationName}</div>
                <div className="truncate text-[11px] text-zinc-400">{safeFormat(j.date, 'MMM d, yyyy')}{j.subcontractor?.name ? ' · ' + j.subcontractor.name : ''}</div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="font-mono text-[12.5px] font-semibold text-zinc-800">{formatCurrency(j.clientRate ?? 0)}</div>
                <div className="font-mono text-[10.5px]" style={{ color: margin >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(margin)}</div>
              </div>
              <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase" style={{ background: sc.bg, color: sc.text }}>{j.status.toLowerCase()}</span>
            </div>
          )
        })}
      </div>
      {jobs.length > 3 && (
        <button onClick={() => setShowAll(s => !s)} className="mt-2 text-[11px] font-semibold text-teal-700 hover:text-teal-800">
          {showAll ? 'Show less' : `Show all ${jobs.length}`}
        </button>
      )}
    </section>
  )
}

function SnapRow({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-start px-5 py-1.5 border-b last:border-b-0" style={{ borderColor: '#F4F4F5' }}>
      <span className="text-[12px] text-zinc-400 w-[140px] flex-shrink-0 pt-px">{label}</span>
      <span
        className="text-[13px] font-semibold"
        style={{ color: muted ? '#A1A1AA' : highlight ? '#0D9488' : '#18181B' }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function PlaceholderTab({ label, hint, onJump, jumpLabel }: { label: string; hint: string; onJump: () => void; jumpLabel: string }) {
  return (
    <div className="rounded-[10px] bg-white p-8 text-center" style={{ border: '1px solid #E4E4E7' }}>
      <p className="text-base font-semibold text-slate-900 mb-1">{label}</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">{hint}</p>
      <button
        onClick={onJump}
        className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
      >
        {jumpLabel}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Billing tab: per-location rate breakdown + recurring add-ons + recent invoices
// ────────────────────────────────────────────────────────────────────────────

function BillingTab({ state, onJumpToTab }: { state: ClientDetailState; onJumpToTab: (tab: CockpitTab) => void }) {
  const { client } = state
  const isFlat = client.billingType === 'FLAT_RATE'
  const invoices = (client.invoices || []).slice().sort((a, b) =>
    new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
  )

  const markInvoicePaid = async (id: string) => {
    try {
      const res = await fetch(`/api/invoices/${id}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: 'MANUAL', paymentNotes: 'Marked paid from client profile' }),
      })
      if (!res.ok) { await showApiError(res, 'Failed to mark invoice paid'); return }
      showSuccess('Invoice marked as paid')
      state.router.refresh()
    } catch { showError('Failed to mark invoice paid') }
  }

  return (
    <div className="space-y-4">
      <ProrationCard clientId={client.id} />
      <section className="rounded-[10px] bg-white" style={{ border: '1px solid #E4E4E7' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">
            Billing type · {isFlat ? 'Flat monthly rate' : 'Per clean'}
          </span>
          <button
            onClick={() => onJumpToTab('schedule')}
            className="text-[11px] font-semibold text-teal-700 hover:text-teal-800"
          >
            Edit on Schedule →
          </button>
        </div>
        <div className="px-5 pb-4 space-y-2">
          {client.locations.length === 0 && (
            <p className="text-sm text-slate-500">No locations yet.</p>
          )}
          {client.locations.map(loc => {
            const activeSchedules = (loc.schedules || []).filter(s => s.isActive)
            const hasSchedule = activeSchedules.length > 0
            return (
              <div key={loc.id} className="rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-semibold text-slate-900 truncate">{loc.name || loc.address?.split(',')[0] || 'Location'}</span>
                  {!hasSchedule && <span className="text-[11px] text-slate-400">No active schedule</span>}
                </div>
                {activeSchedules.map(s => {
                  const clientRate = s.defaultClientRate ?? 0
                  const subRate = s.defaultSubcontractorRate ?? 0
                  const margin = clientRate - subRate
                  const suffix = s.clientPayType === 'FLAT_RATE' ? '/mo' : '/clean'
                  const paySuffix = s.subcontractorPayType === 'FLAT_RATE' ? '/mo' : '/clean'
                  return (
                    <div key={s.id} className="grid grid-cols-3 gap-2 text-[12px] py-1">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wide text-slate-400">Client charge</span>
                        <span className="font-mono font-semibold text-slate-900">{formatCurrency(clientRate)}{suffix}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wide text-slate-400">Cleaner pay</span>
                        <span className="font-mono font-semibold text-slate-900">{formatCurrency(subRate)}{paySuffix}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wide text-slate-400">Margin</span>
                        <span className={`font-mono font-semibold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatCurrency(margin)}</span>
                      </div>
                    </div>
                  )
                })}
                {/* Recurring add-ons under this location's schedules */}
                {activeSchedules.flatMap(s => (s.recurringAddOnServices || []).map(a => ({ ...a, scheduleId: s.id }))).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200/70">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 block">Recurring add-ons</span>
                    {activeSchedules.flatMap(s => (s.recurringAddOnServices || []).map(a => ({ ...a, scheduleId: s.id }))).map(addon => (
                      <div key={addon.id} className="flex items-center justify-between text-[12px] py-0.5">
                        <span className="truncate text-slate-700">{addon.description}</span>
                        <span className="font-mono text-slate-600">+{formatCurrency(addon.clientRate)} / {addon.frequency?.toLowerCase().replace(/_/g, ' ') || 'each'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-[10px] bg-white" style={{ border: '1px solid #E4E4E7' }}>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Recent invoices</span>
          <span className="text-[11px] text-slate-400">{invoices.length} total</span>
        </div>
        <div className="px-5 pb-4">
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices yet.</p>
          ) : (
            <div className="space-y-1">
              {invoices.slice(0, 10).map(inv => (
                <div key={inv.id} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-b-0">
                  <span className="text-[12px] text-slate-600 w-[104px] flex-shrink-0">{safeFormat(inv.dateCreated, 'MMM d, yyyy')}</span>
                  <span className="text-[12px] font-mono font-semibold text-slate-900 flex-1">{formatCurrency(inv.totalAmount)}</span>
                  {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                    <button
                      onClick={() => markInvoicePaid(inv.id)}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-md text-white hover:opacity-90 transition-opacity flex-shrink-0"
                      style={{ background: '#16A34A' }}
                    >
                      Mark Paid
                    </button>
                  )}
                  <span
                    className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: inv.status === 'PAID' ? '#DCFCE7' : inv.status === 'SENT' ? '#DBEAFE' : inv.status === 'VOID' ? '#F1F5F9' : '#FEF3C7',
                      color: inv.status === 'PAID' ? '#15803D' : inv.status === 'SENT' ? '#1D4ED8' : inv.status === 'VOID' ? '#64748B' : '#92400E',
                    }}
                  >
                    {inv.status.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Contacts tab: communication + invoicing contacts
// ────────────────────────────────────────────────────────────────────────────

function ContactsTab({ state }: { state: ClientDetailState }) {
  const { client } = state
  const ccEmails = client.invoicingCcEmail || ''
  return (
    <div className="space-y-4">
      <ContactsSection clientId={client.id} />
      {ccEmails && (
        <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400 mb-1">CC on invoices</span>
          <p className="text-[13px] text-slate-700 break-words">{ccEmails}</p>
        </section>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Access tab: entry codes / access notes per location
// ────────────────────────────────────────────────────────────────────────────

function AccessTab({ state }: { state: ClientDetailState }) {
  const { client } = state
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Access info · {client.locations.length} location{client.locations.length === 1 ? '' : 's'}</span>
      </div>
      {client.locations.length === 0 && (
        <p className="text-sm text-slate-500">No locations yet.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {client.locations.map(loc => (
          <AccessLocationCard key={loc.id} location={loc} onSaved={() => state.router.refresh()} />
        ))}
      </div>
    </div>
  )
}

const ACCESS_FIELDS: Array<{ key: string; label: string; sensitive?: boolean }> = [
  { key: 'entry', label: 'Entry' },
  { key: 'alarm', label: 'Alarm Code', sensitive: true },
  { key: 'gate', label: 'Gate Code', sensitive: true },
  { key: 'lockbox', label: 'Lockbox', sensitive: true },
  { key: 'parking', label: 'Parking' },
  { key: 'notes', label: 'Notes' },
]

function AccessLocationCard({ location, onSaved }: { location: ClientWithDetails['locations'][number]; onSaved: () => void }) {
  const stored = (location.accessFields as unknown as Record<string, string> | null) || {}
  const hasStructured = Object.values(stored).some(v => (v || '').trim())
  // Backward-compat: if no structured fields yet but legacy free-text accessInfo exists, surface it as Notes.
  const initial: Record<string, string> = {
    entry: stored.entry || '', alarm: stored.alarm || '', gate: stored.gate || '',
    lockbox: stored.lockbox || '', parking: stored.parking || '',
    notes: stored.notes || (!hasStructured ? (location.accessInfo || '') : ''),
  }
  const [revealed, setRevealed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState(false)
  const hasAccess = ACCESS_FIELDS.some(f => (initial[f.key] || '').trim())

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/locations/${location.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessFields: fields }),
      })
      if (!res.ok) { await showApiError(res, 'Failed to save access info'); return }
      showSuccess('Access info saved')
      setEditing(false)
      onSaved()
    } catch { showError('Failed to save access info') } finally { setSaving(false) }
  }

  return (
    <div className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-slate-900">{location.name || location.address?.split(',')[0] || 'Location'}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{location.address || 'No address'}</p>
        </div>
        {!editing && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {hasAccess && <button onClick={() => setRevealed(r => !r)} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">{revealed ? 'Hide' : 'Reveal'}</button>}
            <button onClick={() => { setFields(initial); setRevealed(true); setEditing(true) }} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Edit</button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {ACCESS_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{f.label}</label>
              <input value={fields[f.key]} onChange={e => setFields(s => ({ ...s, [f.key]: e.target.value }))} className="mt-0.5 w-full rounded-md px-2 py-1.5 text-[13px] text-slate-900 outline-none" style={{ border: '1px solid #E4E4E7' }} />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setEditing(false); setFields(initial) }} className="text-[11px] font-semibold text-slate-500 px-2 py-1">Cancel</button>
            <button onClick={save} disabled={saving} className="text-[11px] font-semibold text-white px-3 py-1 rounded-md disabled:opacity-60" style={{ background: '#0D9488' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : hasAccess ? (
        <div className="rounded-md px-3 py-2.5 space-y-1.5" style={{ background: '#F0FDFA', border: '1px solid #99F6E4' }}>
          {ACCESS_FIELDS.filter(f => (initial[f.key] || '').trim()).map(f => (
            <div key={f.key} className="flex gap-2">
              <span className="w-[80px] flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 pt-0.5">{f.label}</span>
              <span className="flex-1 text-[13px] text-slate-800 break-words transition-all" style={f.sensitive && !revealed ? { filter: 'blur(5px)', userSelect: 'none' } : undefined}>{initial[f.key]}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md px-3 py-2.5" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#92400E' }}>⚠ No access info yet</span>
          <p className="text-[12px] text-amber-800 mt-1.5">
            Add entry, alarm, gate, lockbox, parking, and any notes the cleaner needs.{' '}
            <button onClick={() => { setFields(initial); setEditing(true) }} className="font-semibold underline">Add now</button>
          </p>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Scope tab: scope document link + quick scope notes
// ────────────────────────────────────────────────────────────────────────────

const SCOPE_SECTIONS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: 'tasks', label: 'Tasks', placeholder: 'One task per line — e.g.\nVacuum all carpets\nWipe counters & sinks\nEmpty all trash' },
  { key: 'frequency', label: 'Frequency', placeholder: 'One per line — e.g.\nRestrooms: every visit\nFridge interior: monthly' },
  { key: 'exclusions', label: 'Exclusions', placeholder: 'One per line — e.g.\nExterior windows\nDishes / laundry' },
  { key: 'preferences', label: 'Preferences', placeholder: 'One per line — e.g.\nUse unscented products\nText when finished' },
]

function ScopeTab({ state }: { state: ClientDetailState }) {
  const { client } = state
  const stored = (client.scopeStructured as unknown as Record<string, string> | null) || {}
  const hasStructured = SCOPE_SECTIONS.some(s => (stored[s.key] || '').trim())
  // Backward-compat: if no structured scope yet but a legacy free-text note exists, seed Tasks with it.
  const buildInitial = (): Record<string, string> => ({
    tasks: stored.tasks || (!hasStructured ? (client.scopeNotes || '') : ''),
    frequency: stored.frequency || '',
    exclusions: stored.exclusions || '',
    preferences: stored.preferences || '',
  })

  const [editing, setEditing] = useState(false)
  const [docUrl, setDocUrl] = useState(client.scopeDocUrl || '')
  const [fields, setFields] = useState<Record<string, string>>(buildInitial())
  const [saving, setSaving] = useState(false)

  const reset = () => { setDocUrl(client.scopeDocUrl || ''); setFields(buildInitial()) }
  const startEdit = () => { reset(); setEditing(true) }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeDocUrl: docUrl || null, scopeStructured: fields }),
      })
      if (!res.ok) { await showApiError(res, 'Failed to save scope'); return }
      showSuccess('Scope saved')
      setEditing(false)
      state.router.refresh()
    } catch { showError('Failed to save scope') } finally { setSaving(false) }
  }

  const initialView = buildInitial()
  const anyContent = SCOPE_SECTIONS.some(s => (initialView[s.key] || '').trim())

  return (
    <div className="space-y-4">
      {/* Scope document link */}
      <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Scope Document</span>
          {!editing && <button onClick={startEdit} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Edit</button>}
        </div>
        {editing ? (
          <input value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="Paste a link to the scope PDF (Canva, Drive, …)" className="mt-2 w-full rounded-md px-3 py-2 text-[13px] text-slate-900 outline-none" style={{ border: '1px solid #E4E4E7' }} />
        ) : client.scopeDocUrl ? (
          <a href={client.scopeDocUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-[13px] font-medium text-teal-700 hover:text-teal-800 break-all">Open scope document →</a>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-400">No scope document linked.</p>
        )}
      </section>

      {/* Structured scope sections */}
      <section className="rounded-[10px] bg-white p-4 space-y-4" style={{ border: '1px solid #E4E4E7' }}>
        {SCOPE_SECTIONS.map(s => {
          const lines = (initialView[s.key] || '').split('\n').map(l => l.trim()).filter(Boolean)
          return (
            <div key={s.key}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400 mb-1.5">{s.label}</div>
              {editing ? (
                <textarea value={fields[s.key]} onChange={e => setFields(f => ({ ...f, [s.key]: e.target.value }))} rows={3} placeholder={s.placeholder} className="w-full rounded-md px-3 py-2 text-[13px] text-slate-900 outline-none resize-y" style={{ border: '1px solid #E4E4E7', lineHeight: 1.5 }} />
              ) : lines.length > 0 ? (
                <ul className="space-y-1">
                  {lines.map((line, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-slate-800"><span className="text-zinc-300 leading-5">•</span><span className="leading-5">{line}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-zinc-400">—</p>
              )}
            </div>
          )
        })}
        {!editing && !anyContent && (
          <button onClick={startEdit} className="text-[12px] font-semibold text-teal-700">+ Add scope details</button>
        )}
      </section>

      {editing && (
        <div className="flex justify-end gap-2">
          <button onClick={() => { setEditing(false); reset() }} className="px-4 py-1.5 text-[12px] font-semibold rounded-md text-zinc-500" style={{ border: '1px solid #E4E4E7' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-[12px] font-semibold rounded-md text-white disabled:opacity-60" style={{ background: '#0D9488' }}>{saving ? 'Saving…' : 'Save scope'}</button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// History tab: combined timeline of invoices + recent jobs
// ────────────────────────────────────────────────────────────────────────────

type HistoryEvent = { date: Date; kind: 'invoice' | 'job'; label: string; sub: string; statusColor: string; statusBg: string; statusLabel: string; isVoid: boolean }

function HistoryTab({ state }: { state: ClientDetailState }) {
  const { client, recentJobs } = state
  const events: HistoryEvent[] = []
  for (const inv of client.invoices || []) {
    const status = inv.status
    events.push({
      date: new Date(inv.dateCreated),
      kind: 'invoice',
      label: `Invoice ${status === 'PAID' ? 'paid' : status === 'SENT' ? 'sent' : status === 'VOID' ? 'voided' : 'created'}`,
      sub: formatCurrency(inv.totalAmount),
      statusColor: status === 'PAID' ? '#15803D' : status === 'SENT' ? '#1D4ED8' : status === 'VOID' ? '#6B7280' : '#92400E',
      statusBg: status === 'PAID' ? '#DCFCE7' : status === 'SENT' ? '#DBEAFE' : status === 'VOID' ? '#F1F5F9' : '#FEF3C7',
      statusLabel: status.toLowerCase(),
      isVoid: status === 'VOID',
    })
  }
  for (const job of recentJobs || []) {
    const status = job.status
    events.push({
      date: new Date(job.date),
      kind: 'job',
      label: `Clean ${status.toLowerCase()}`,
      sub: job.location?.name || '',
      statusColor: status === 'COMPLETED' ? '#15803D' : status === 'CANCELLED' ? '#B91C1C' : '#475569',
      statusBg: status === 'COMPLETED' ? '#DCFCE7' : status === 'CANCELLED' ? '#FEE2E2' : '#F1F5F9',
      statusLabel: status.toLowerCase(),
      isVoid: false,
    })
  }
  events.sort((a, b) => b.date.getTime() - a.date.getTime())

  // Group same-day events under one date header
  const groups: Array<{ key: string; date: Date; events: HistoryEvent[] }> = []
  for (const ev of events) {
    const key = safeFormat(ev.date, 'yyyy-MM-dd', 'unknown')
    const g = groups.find(x => x.key === key)
    if (g) g.events.push(ev)
    else groups.push({ key, date: ev.date, events: [ev] })
  }

  return (
    <section className="rounded-[10px] bg-white" style={{ border: '1px solid #E4E4E7' }}>
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">History · {events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
      <div className="px-5 pb-4">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No history yet. Once you send invoices or jobs run, they&apos;ll show up here.</p>
        ) : (
          <div className="space-y-3">
            {groups.slice(0, 30).map(g => <HistoryDay key={g.key} date={g.date} events={g.events} />)}
            {groups.length > 30 && (
              <p className="text-[11px] text-slate-400 text-center pt-1">+{groups.length - 30} earlier day{groups.length - 30 === 1 ? '' : 's'}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function HistoryDay({ date, events }: { date: Date; events: HistoryEvent[] }) {
  const [expandVoid, setExpandVoid] = useState(false)
  const voided = events.filter(e => e.isVoid)
  const collapseVoid = voided.length >= 3 && !expandVoid
  const rows = collapseVoid ? events.filter(e => !e.isVoid) : events

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-zinc-500">{safeFormat(date, 'EEE, MMM d, yyyy')}</p>
      <div className="space-y-1">
        {rows.map((ev, i) => {
          const t = ev.kind === 'invoice'
            ? { bg: '#FEF3C7', color: '#92400E', label: 'INV' }
            : { bg: '#CCFBF1', color: '#0F766E', label: 'JOB' }
          return (
            <div key={i} className="flex items-center gap-3 py-1">
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: t.bg, color: t.color }}>{t.label}</span>
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-slate-900">{ev.label}</span>
                {ev.sub && <span className="text-[11px] text-slate-500"> · {ev.sub}</span>}
              </div>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: ev.statusBg, color: ev.statusColor }}>{ev.statusLabel}</span>
            </div>
          )
        })}
        {collapseVoid && (
          <button onClick={() => setExpandVoid(true)} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">
            + Show {voided.length} voided invoices
          </button>
        )}
      </div>
    </div>
  )
}

function buildScheduleLine(schedule: { frequency: string; daysOfWeek?: string | null; startTime?: string | null }): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let dayPart = ''
  if (schedule.daysOfWeek) {
    try {
      const arr = JSON.parse(schedule.daysOfWeek)
      if (Array.isArray(arr) && arr.length > 0) {
        dayPart = arr.map(d => dayNames[d]).join(', ')
      }
    } catch {
      // ignore
    }
  }
  const freqLabel = schedule.frequency.toLowerCase().replace(/_/g, ' ')
  const base = dayPart ? `${freqLabel}: ${dayPart}` : freqLabel
  return schedule.startTime ? `${base} · ${schedule.startTime}` : base
}
