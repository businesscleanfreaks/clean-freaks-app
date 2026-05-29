"use client"

import { useState } from "react"
import useSWR from "swr"
import { useClientDetail } from "./use-client-detail"
import { ClientDetailHeader } from "./client-detail-header"
import { ClientDetailLocations } from "./client-detail-locations"
import { ClientDetailContactSummary, ClientDetailSidebar, ClientDetailJobFeed } from "./client-detail-sidebar"
import { ClientDetailModals } from "./client-detail-modals"
import { format } from "date-fns"
import { formatCurrency } from "@/lib/utils"
import { showSuccess, showError, showApiError } from "@/lib/toast"
import type { ClientWithDetails } from "@/lib/types"
import { ClientNotesPanel, OpenIssuesEditor, WhatToKnow, type ClientNote } from "./client-notes-panel"

const notesFetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("Failed"); return r.json() })

interface ClientDetailViewProps {
  client: ClientWithDetails
  onDataChange?: () => void
}

type CockpitTab = 'overview' | 'schedule' | 'billing' | 'contacts' | 'access' | 'scope' | 'history'

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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');`}</style>
      <ConfirmDialog />
      <ClientDetailModals state={state} />

      <div style={{ minHeight: '100vh', background: '#FAFAF9', overscrollBehavior: 'none', fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <ClientDetailHeader state={state} />

        {/* Cockpit Tabs */}
        <div className="bg-white border-b border-gray-200">
          <div className="mx-auto w-full max-w-[1080px] px-3 sm:px-5">
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
        <div className="mx-auto w-full max-w-[1080px] px-3 sm:px-5 py-5">
          {activeTab === 'overview' && <OverviewTab state={state} onJumpToTab={setActiveTab} />}
          {activeTab === 'schedule' && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4">
              <div className="space-y-4 order-2 lg:order-1">
                <ClientDetailContactSummary state={state} />
                <ClientDetailLocations state={state} />
                <ClientDetailSidebar state={state} />
              </div>
              <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start">
                <ClientDetailJobFeed state={state} />
              </div>
            </div>
          )}
          {activeTab === 'billing' && <BillingTab state={state} onJumpToTab={setActiveTab} />}
          {activeTab === 'contacts' && <ContactsTab state={state} onJumpToTab={setActiveTab} />}
          {activeTab === 'access' && <AccessTab state={state} onJumpToTab={setActiveTab} />}
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
  const nextCleanLabel = nextClean
    ? `${format(new Date(nextClean.date), 'EEE, MMM d')}${nextClean.time ? ' · ' + nextClean.time : ''}`
    : 'No upcoming cleans'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
      <div className="space-y-4">
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
            <OpenIssuesEditor clientId={client.id} initial={client.openIssues || []} />
            <WhatToKnow pinned={pinnedNotes} />
          </div>
        </section>

      </div>

      {/* Right rail: notes + job feed */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <ClientNotesPanel clientId={client.id} notes={notes} onChange={mutateNotes} />
        <ClientDetailJobFeed state={state} />
      </div>
    </div>
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
                  <span className="text-[12px] text-slate-600 w-[104px] flex-shrink-0">{format(new Date(inv.dateCreated), 'MMM d, yyyy')}</span>
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

function ContactsTab({ state, onJumpToTab }: { state: ClientDetailState; onJumpToTab: (tab: CockpitTab) => void }) {
  const { client } = state
  const commName = client.communicationContactName || ''
  const commPhone = client.communicationPhone || client.phone || ''
  const commEmail = client.communicationEmail || ''
  const invName = client.invoicingContactName || ''
  const invPhone = client.invoicingPhone || ''
  const invEmail = client.invoicingEmail || ''
  const ccEmails = client.invoicingCcEmail || ''
  const showInvoicingSeparately = !!(invEmail && invEmail !== commEmail) || !!(invName && invName !== commName)

  const ContactCard = ({ title, name, phone, email, accentColor, hint }: { title: string; name: string; phone: string; email: string; accentColor: string; hint?: string }) => (
    <div className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex h-2 w-2 rounded-full" style={{ background: accentColor }} />
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">{title}</span>
      </div>
      {hint && <p className="text-[11px] text-slate-400 mb-2">{hint}</p>}
      <div className="space-y-1.5">
        <div className="text-[14px] font-semibold text-slate-900">{name || <span className="text-slate-400 font-normal italic">No name set</span>}</div>
        <div className="text-[12px] text-slate-600">{phone || <span className="text-slate-300">— phone</span>}</div>
        <div className="text-[12px] text-slate-600 break-all">{email || <span className="text-slate-300">— email</span>}</div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Contacts</span>
        <button onClick={() => onJumpToTab('schedule')} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Edit →</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ContactCard
          title="Primary contact"
          name={commName}
          phone={commPhone}
          email={commEmail}
          accentColor="#0D9488"
          hint="Day-to-day point of contact for scheduling and questions."
        />
        {showInvoicingSeparately ? (
          <ContactCard
            title="Invoicing contact"
            name={invName || commName}
            phone={invPhone}
            email={invEmail}
            accentColor="#7C3AED"
            hint="Used for invoice emails and billing matters."
          />
        ) : (
          <div className="rounded-[10px] bg-slate-50 p-4 text-[12px] text-slate-500" style={{ border: '1px dashed #CBD5E1' }}>
            <p className="font-semibold text-slate-600 mb-1">Invoicing uses the primary contact</p>
            <p>No separate billing contact set. Edit on the Schedule tab to add a different invoicing email.</p>
          </div>
        )}
      </div>

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

function AccessTab({ state, onJumpToTab }: { state: ClientDetailState; onJumpToTab: (tab: CockpitTab) => void }) {
  const { client } = state
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Access info · {client.locations.length} location{client.locations.length === 1 ? '' : 's'}</span>
        <button onClick={() => onJumpToTab('schedule')} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Edit on Schedule →</button>
      </div>
      {client.locations.length === 0 && (
        <p className="text-sm text-slate-500">No locations yet.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {client.locations.map(loc => {
          const hasAccess = loc.accessInfo && loc.accessInfo.trim().length > 0
          return (
            <div key={loc.id} className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
              <div className="mb-2">
                <p className="text-[14px] font-semibold text-slate-900">{loc.name || loc.address?.split(',')[0] || 'Location'}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{loc.address || 'No address'}</p>
              </div>
              <div className="rounded-md px-3 py-2.5" style={{ background: hasAccess ? '#F0FDFA' : '#FFFBEB', border: `1px solid ${hasAccess ? '#99F6E4' : '#FDE68A'}` }}>
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: hasAccess ? '#0F766E' : '#92400E' }}>
                  {hasAccess ? '🔑 Access info' : '⚠ No access info yet'}
                </span>
                {hasAccess ? (
                  <p className="text-[13px] text-slate-700 mt-1.5 whitespace-pre-wrap break-words">{loc.accessInfo}</p>
                ) : (
                  <p className="text-[12px] text-amber-800 mt-1.5">Add gate codes, key locations, alarm info, or any other instructions the cleaner needs.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Scope tab: scope document link + quick scope notes
// ────────────────────────────────────────────────────────────────────────────

function ScopeTab({ state }: { state: ClientDetailState }) {
  const { client } = state
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(client.scopeNotes || '')
  const [docUrl, setDocUrl] = useState(client.scopeDocUrl || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeNotes: notes || null, scopeDocUrl: docUrl || null }),
      })
      if (!res.ok) { await showApiError(res, 'Failed to save scope'); return }
      showSuccess('Scope saved')
      setEditing(false)
      state.router.refresh()
    } catch { showError('Failed to save scope') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Scope Document</span>
        {client.scopeDocUrl && !editing ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <a href={client.scopeDocUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-teal-700 hover:text-teal-800 break-all">Open scope document →</a>
            <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-600 flex-shrink-0">Edit</button>
          </div>
        ) : editing ? (
          <input value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="Paste a link to the scope PDF (Canva, Drive, …)" className="mt-2 w-full rounded-md px-3 py-2 text-[13px] outline-none" style={{ border: '1px solid #E4E4E7' }} />
        ) : (
          <p className="mt-2 text-[13px] text-zinc-400">No scope document linked. <button onClick={() => setEditing(true)} className="font-semibold text-teal-700">Add a link</button></p>
        )}
      </section>

      <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Quick Scope Notes</span>
          {!editing && <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Edit</button>}
        </div>
        {editing ? (
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6} placeholder="Tasks, frequency, exclusions, preferences…" className="mt-2 w-full rounded-md px-3 py-2 text-[13px] outline-none resize-y" style={{ border: '1px solid #E4E4E7', minHeight: 120, lineHeight: 1.5 }} />
        ) : (
          <p className="mt-2 text-[13px] whitespace-pre-wrap" style={{ color: client.scopeNotes ? '#18181B' : '#A1A1AA', lineHeight: 1.6 }}>{client.scopeNotes || 'No scope notes yet. Click Edit to add cleaning tasks, frequency, exclusions, and preferences.'}</p>
        )}
      </section>

      {editing && (
        <div className="flex justify-end gap-2">
          <button onClick={() => { setEditing(false); setNotes(client.scopeNotes || ''); setDocUrl(client.scopeDocUrl || '') }} className="px-4 py-1.5 text-[12px] font-semibold rounded-md text-zinc-500" style={{ border: '1px solid #E4E4E7' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-[12px] font-semibold rounded-md text-white disabled:opacity-60" style={{ background: '#0D9488' }}>{saving ? 'Saving…' : 'Save scope'}</button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// History tab: combined timeline of invoices + recent jobs
// ────────────────────────────────────────────────────────────────────────────

function HistoryTab({ state }: { state: ClientDetailState }) {
  const { client, recentJobs } = state
  type Event = { date: Date; kind: 'invoice' | 'job'; label: string; sub: string; statusColor: string; statusBg: string; statusLabel: string }
  const events: Event[] = []
  for (const inv of client.invoices || []) {
    const date = new Date(inv.dateCreated)
    const status = inv.status
    events.push({
      date,
      kind: 'invoice',
      label: `Invoice ${status === 'PAID' ? 'paid' : status === 'SENT' ? 'sent' : 'created'}`,
      sub: formatCurrency(inv.totalAmount),
      statusColor: status === 'PAID' ? '#15803D' : status === 'SENT' ? '#1D4ED8' : '#92400E',
      statusBg: status === 'PAID' ? '#DCFCE7' : status === 'SENT' ? '#DBEAFE' : '#FEF3C7',
      statusLabel: status.toLowerCase(),
    })
  }
  for (const job of recentJobs || []) {
    const date = new Date(job.date)
    const status = job.status
    events.push({
      date,
      kind: 'job',
      label: `Clean ${status.toLowerCase()}`,
      sub: job.location?.name || '',
      statusColor: status === 'COMPLETED' ? '#15803D' : status === 'CANCELLED' ? '#B91C1C' : '#475569',
      statusBg: status === 'COMPLETED' ? '#DCFCE7' : status === 'CANCELLED' ? '#FEE2E2' : '#F1F5F9',
      statusLabel: status.toLowerCase(),
    })
  }
  events.sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <section className="rounded-[10px] bg-white" style={{ border: '1px solid #E4E4E7' }}>
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">History · {events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
      <div className="px-5 pb-4">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No history yet. Once you send invoices or jobs run, they'll show up here.</p>
        ) : (
          <div className="space-y-2">
            {events.slice(0, 50).map((ev, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-b-0">
                <span className="text-[11px] text-slate-400 font-mono w-[78px] flex-shrink-0 pt-0.5">{format(ev.date, 'MMM d')}</span>
                <span
                  className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                  style={{ background: ev.statusBg, color: ev.statusColor }}
                >
                  {ev.kind === 'invoice' ? 'INV' : 'JOB'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-900">{ev.label}</p>
                  {ev.sub && <p className="text-[11px] text-slate-500 truncate">{ev.sub}</p>}
                </div>
                <span
                  className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: ev.statusBg, color: ev.statusColor }}
                >
                  {ev.statusLabel}
                </span>
              </div>
            ))}
            {events.length > 50 && (
              <p className="text-[11px] text-slate-400 text-center pt-2">+{events.length - 50} older event{events.length - 50 === 1 ? '' : 's'}</p>
            )}
          </div>
        )}
      </div>
    </section>
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
