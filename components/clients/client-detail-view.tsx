"use client"

import { useState } from "react"
import { useClientDetail } from "./use-client-detail"
import { ClientDetailHeader } from "./client-detail-header"
import { ClientDetailLocations } from "./client-detail-locations"
import { ClientDetailContactSummary, ClientDetailSidebar, ClientDetailJobFeed } from "./client-detail-sidebar"
import { ClientDetailModals } from "./client-detail-modals"
import { format } from "date-fns"
import { formatCurrency } from "@/lib/utils"
import type { ClientWithDetails } from "@/lib/types"

interface ClientDetailViewProps {
  client: ClientWithDetails
  onDataChange?: () => void
}

type CockpitTab = 'overview' | 'schedule' | 'billing' | 'contacts' | 'access' | 'history'

const TABS: { key: CockpitTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'billing', label: 'Billing' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'access', label: 'Access' },
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
      <ConfirmDialog />
      <ClientDetailModals state={state} />

      <div style={{ minHeight: '100vh', background: '#FAFAF9', overscrollBehavior: 'none' }}>
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
                    className={`relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
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
          {activeTab === 'billing' && <PlaceholderTab label="Billing" hint="Rate breakdown and recent invoices will live here. For now, edit rates from the Schedule tab." onJump={() => setActiveTab('schedule')} jumpLabel="Open Schedule tab" />}
          {activeTab === 'contacts' && <PlaceholderTab label="Contacts" hint="Manage all contacts associated with this client. For now, the primary contact is editable in the contact bar on the Schedule tab." onJump={() => setActiveTab('schedule')} jumpLabel="Open Schedule tab" />}
          {activeTab === 'access' && <PlaceholderTab label="Access" hint="Entry codes, alarm codes, and gate access info per location. For now, edit access info inline on each location card under the Schedule tab." onJump={() => setActiveTab('schedule')} jumpLabel="Open Schedule tab" />}
          {activeTab === 'history' && <PlaceholderTab label="History" hint="Timeline of every event for this client — invoices, notes, status changes. For now, see recent jobs in the sidebar." onJump={() => setActiveTab('overview')} jumpLabel="Back to Overview" />}
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
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">Client overview</span>
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
          <div className="px-5 pb-4" />
        </section>

        {/* Quick links into existing experience */}
        <section className="rounded-[10px] bg-white p-4" style={{ border: '1px solid #E4E4E7' }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400 mb-3">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onJumpToTab('schedule')}
              className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Edit locations / schedule
            </button>
            <button
              onClick={() => onJumpToTab('billing')}
              className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              View billing
            </button>
            <button
              onClick={() => onJumpToTab('access')}
              className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Access info
            </button>
            <button
              onClick={() => onJumpToTab('history')}
              className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              History
            </button>
          </div>
        </section>
      </div>

      {/* Right rail: existing job feed */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <ClientDetailJobFeed state={state} />
      </div>
    </div>
  )
}

function SnapRow({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center px-5 py-2.5 border-b border-slate-100 last:border-b-0">
      <span className="text-[12px] text-slate-400 w-[130px] flex-shrink-0">{label}</span>
      <span
        className="text-[13px] font-medium truncate"
        style={{ color: muted ? '#9CA3AF' : highlight ? '#0F766E' : '#0F172A', fontWeight: highlight ? 600 : 500 }}
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
