"use client"

import { useEffect, useMemo, useState } from "react"
import { mutate as globalMutate } from "swr"
import { useClientDetail } from "../use-client-detail"
import { ClientDetailModals } from "../client-detail-modals"
import { PauseServiceModal } from "../cockpit/pause-service-modal"
import { TrialStatusPanel } from "../cockpit/trial-status-panel"
import type { ClientWithDetails } from "@/lib/types"
import type { ClientListFactResult } from "@/lib/client-listing-facts"
import { deriveClientStatus, STATUS_META } from "@/lib/client-listing"
import { businessDayKey } from "@/lib/business-time"
import {
  arrivalInfo,
  billingStatus,
  descriptorLine,
  headerFigures,
  money,
  monthMoney,
  scheduleHeadline,
  type MonthMoneyLocation,
  type ProfileInvoice,
} from "@/lib/client-profile"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { AddButton, C, Card, Field, Modal, PROFILE_STYLES } from "./ui"
import { LocationsCard, cleanerHex } from "./profile-locations"
import { ContactsCard, NotesCard } from "./profile-people"
import { BillingTab } from "./profile-billing"
import { HistoryTab } from "./profile-history"

/**
 * The client profile (Client Profile Main.dc.html): Overview · Billing ·
 * History. The editing logic is the existing profile's (useClientDetail, the
 * schedule form, the pause flow); this is its new layout.
 */

type Tab = "overview" | "billing" | "history"
type ProfileClient = ClientWithDetails & { listing?: ClientListFactResult }

// Old deep links (?tab=schedule, ?tab=invoices…) land on the tab that now holds them.
const TAB_ALIAS: Record<string, Tab> = {
  overview: "overview", schedule: "overview", contacts: "overview", access: "overview", notes: "overview", scope: "overview",
  billing: "billing", invoices: "billing",
  history: "history",
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dayOf = (v: Date | string) => new Date(v)
const calendarHref = (job: { id: string; date: Date | string }) =>
  `/calendar?month=${dayOf(job.date).toISOString().slice(0, 7)}&jobId=${job.id}`

type ProfileJob = ClientWithDetails["locations"][number]["jobs"][number] & {
  startWindowBegin?: string | null
  startWindowEnd?: string | null
  locationName: string
}

function jobTime(job: ProfileJob): string {
  const a = arrivalInfo({
    timeType: job.startWindowBegin ? "WINDOW" : "SPECIFIC",
    startTime: job.startTime,
    startWindowBegin: job.startWindowBegin,
    startWindowEnd: job.startWindowEnd,
  })
  return a.tag === "Flexible" ? "Anytime" : a.line.replace(/^Arrives at /, "").replace(/^Anytime /, "")
}

function toMoneyLocations(client: ClientWithDetails): MonthMoneyLocation[] {
  const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null)
  return client.locations.map(loc => ({
    schedules: (loc.schedules || []).filter(s => s.isActive).map(s => ({
      id: s.id,
      startDate: new Date(s.startDate),
      endDate: d(s.endDate),
      cadenceAnchor: d(s.cadenceAnchor),
      pauseFrom: d(s.pauseFrom),
      pauseTo: d(s.pauseTo),
      frequency: s.frequency,
      daysOfWeek: s.daysOfWeek,
      monthlyPattern: s.monthlyPattern,
      customDates: s.customDates,
      defaultClientRate: s.defaultClientRate,
      defaultSubcontractorRate: s.defaultSubcontractorRate,
      clientPayType: s.clientPayType,
      subcontractorPayType: s.subcontractorPayType,
    })),
    jobs: (loc.jobs || []).map(j => ({ date: j.date, status: j.status, scheduleId: j.scheduleId, clientRate: j.clientRate, subcontractorRate: j.subcontractorRate })),
  }))
}

export function ProfileView({ client: initialClient, onDataChange }: { client: ClientWithDetails; onDataChange?: () => void }) {
  const state = useClientDetail({ client: initialClient, onDataChange })
  const client = state.client as ProfileClient
  const { mounted, ConfirmDialog } = state

  const today = useMemo(() => new Date(`${businessDayKey(new Date())}T12:00:00.000Z`), [])
  const [tab, setTab] = useState<Tab>("overview")
  const [autoBook, setAutoBook] = useState(false)
  const [breakFor, setBreakFor] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)

  // Deep links: ?tab=billing, and ?book=1 from the Add Client modal's "Book first clean".
  useEffect(() => {
    const url = new URL(window.location.href)
    const wanted = TAB_ALIAS[url.searchParams.get("tab") ?? ""]
    if (wanted) setTab(wanted)
    if (url.searchParams.get("book") === "1") {
      setTab("overview")
      setAutoBook(true)
      url.searchParams.delete("book")
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])

  const listing = client.listing
  const status = listing ? deriveClientStatus(listing.facts, today) : client.isActive ? "recurring" : "inactive"
  const meta = STATUS_META[status]
  const month = useMemo(() => monthMoney(toMoneyLocations(client), today), [client, today])
  const figures = listing ? headerFigures(status, listing.facts, month) : null
  const descriptor = listing ? descriptorLine(status, listing.facts, client.locations.length, client.startDate ?? client.createdAt) : ""
  const invoices = (client.invoices || []) as ProfileInvoice[]
  const account = billingStatus(status, invoices, client.billingDelivery)

  const jobs: ProfileJob[] = client.locations.flatMap(loc => (loc.jobs || []).map(j => ({ ...(j as ProfileJob), locationName: loc.name })))
  const startOfToday = new Date(today.getTime() - 12 * 3600e3)
  const upcoming = jobs
    .filter(j => j.status !== "CANCELLED" && dayOf(j.date) >= startOfToday)
    .sort((a, b) => dayOf(a.date).getTime() - dayOf(b.date).getTime())
  const next = upcoming[0]

  const pausable = client.locations.flatMap(loc =>
    (loc.schedules || []).filter(s => s.isActive).map(s => ({ id: s.id, locationName: loc.name, cadence: scheduleHeadline(s) })),
  )

  const reactivate = async () => {
    const res = await fetch(`/api/clients/${client.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: true }) })
    if (!res.ok) return showApiError(res, "Couldn't reactivate the client")
    showSuccess("Client reactivated")
    globalMutate("/api/clients/data")
    state.onDataChange?.()
  }

  if (!mounted) {
    return (
      <div className="cfp-page" style={{ maxWidth: 1560, margin: "0 auto", padding: "18px 38px 48px" }}>
        <div style={{ height: 58, width: 360, borderRadius: 14, background: "#ece7dd" }} />
        <div style={{ height: 320, marginTop: 40, borderRadius: 14, background: "#fff", border: `1px solid ${C.border}` }} />
      </div>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <ClientDetailModals state={state} onOpenRecurringSchedule={() => { setTab("overview"); setAutoBook(true) }} />
      {breakFor && (
        <PauseServiceModal
          schedules={[...pausable.filter(s => s.id === breakFor), ...pausable.filter(s => s.id !== breakFor)]}
          onClose={() => setBreakFor(null)}
          onDone={() => { setBreakFor(null); state.onDataChange?.() }}
        />
      )}
      {renaming && <RenameModal state={state} onClose={() => setRenaming(false)} />}

      <div className="cfp cfp-page" style={{ width: "100%", maxWidth: 1560, margin: "0 auto", padding: "18px 38px 48px" }}>
        <style>{PROFILE_STYLES}</style>

        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.muted, marginBottom: 12 }}>
          <span onClick={() => state.router.push("/clients")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Clients
          </span>
        </div>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 14 }}>
            <div aria-hidden style={{ width: 58, height: 58, borderRadius: 14, flex: "none", background: C.mint, border: `1px solid ${C.mintBorder}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#0b7a4e" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3.2" /><path d="M8 5l1-2h6l1 2" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{client.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, flexWrap: "wrap", fontSize: 12.5, color: C.muted }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, padding: "3px 9px", borderRadius: 7, background: meta.bg, color: meta.color }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} /> {meta.label}
                </span>
                <span>{descriptor}</span>
              </div>
            </div>
          </div>

          <div className="cfp-head-right" style={{ display: "flex", alignItems: "center", gap: 18, flex: "none", flexWrap: "wrap" }}>
            {figures && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted }}>{figures.label}</div>
                <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{figures.value}</div>
                {figures.sub && <div style={{ fontSize: 12, fontWeight: 700, color: figures.subColor, fontVariantNumeric: "tabular-nums" }}>{figures.sub}</div>}
              </div>
            )}
            <div style={{ width: 1, height: 42, background: "#e6e0d4" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {client.isActive && (
                <button className="cfp-btn primary" style={{ padding: "9px 18px" }} onClick={() => state.setShowOneTimeServiceDialog(true)}>
                  Schedule One-Time Service
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button className="cfp-btn ghost" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => setMenuOpen(o => !o)}>
                  Edit
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menuOpen && (
                  <>
                    <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 190, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 11, boxShadow: "0 14px 40px rgba(40,30,10,0.18)", padding: 5, zIndex: 56 }}>
                      <div className="cfp-menu-item" onClick={() => { setMenuOpen(false); setRenaming(true) }}>Rename</div>
                      {client.isActive
                        ? <div className="cfp-menu-item" style={{ color: "#b4413a" }} onClick={() => { setMenuOpen(false); state.handleArchiveClient() }}>Cancel client</div>
                        : <div className="cfp-menu-item" onClick={() => { setMenuOpen(false); reactivate() }}>Reactivate client</div>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="cfp-tabs" style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 18, borderBottom: "1px solid #e9e3d7" }}>
          {([["overview", "Overview"], ["billing", "Billing"], ["history", "History"]] as const).map(([key, label]) => (
            <div
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={{ fontSize: 13.5, fontWeight: 700, padding: "11px 0", cursor: "pointer", borderBottom: `2px solid ${tab === key ? C.primary : "transparent"}`, color: tab === key ? C.text : C.muted, marginBottom: -1, whiteSpace: "nowrap" }}
            >
              {label}
            </div>
          ))}
        </div>

        {tab === "overview" && (
          <div className="cfp-overview">
            {status === "trial" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <TrialStatusPanel client={client} onDone={() => state.onDataChange?.()} />
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <div
                  className="cfp-next"
                  onClick={() => (next ? state.router.push(calendarHref(next)) : state.setShowOneTimeServiceDialog(true))}
                  style={{ flex: "1 1 200px", borderRadius: 14, padding: "16px 18px", color: "#fff", cursor: "pointer", minWidth: 0 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#9fd4b8" }}>Next clean</span>
                    {next && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#9fd4b8" }}>Edit visit</span>}
                  </div>
                  {next ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                        {SHORT_DAYS[dayOf(next.date).getUTCDay()]}, {SHORT_MONTHS[dayOf(next.date).getUTCMonth()]} {dayOf(next.date).getUTCDate()}
                      </div>
                      <div style={{ fontSize: 13, color: "#bcd8c8", marginTop: 3 }}>{jobTime(next)} · {next.locationName}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12 }}>
                        <span style={{ width: 20, height: 20, borderRadius: "50%", background: cleanerHex(next.subcontractor?.name), color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                          {(next.subcontractor?.name ?? next.vendor?.name ?? "?").trim()[0]?.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{next.subcontractor?.name ?? next.vendor?.name ?? "Unassigned"}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#5eead4" }}>Open →</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>Nothing booked</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#5eead4", marginTop: 12 }}>Schedule a Service →</div>
                    </>
                  )}
                </div>

                <Card title="Billing" style={{ flex: "1 1 200px" }}>
                  <div style={{ padding: "12px 18px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: account.color, flex: "none" }} />
                      <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>{account.value}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{account.sub}</div>
                    <div onClick={() => setTab("billing")} style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginTop: 10, cursor: "pointer" }}>Invoice History →</div>
                  </div>
                </Card>

                <ContactsCard clientId={client.id} onChanged={() => state.onDataChange?.()} />
              </div>

              <LocationsCard state={state} today={today} onAddBreak={setBreakFor} autoBook={autoBook} />

              <OneTimeServices jobs={jobs} today={today} onOpen={job => state.router.push(calendarHref(job))} onSchedule={() => state.setShowOneTimeServiceDialog(true)} onHistory={() => setTab("history")} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <Card
                title="Upcoming"
                action={
                  <AddButton
                    small
                    label="Open Calendar"
                    onClick={() => state.router.push(`/calendar?clientId=${client.id}`)}
                    icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>}
                  />
                }
              >
                <div style={{ padding: "0 16px 8px" }}>
                  {upcoming.slice(0, 5).map((u, i) => (
                    <div
                      key={u.id}
                      className="cfp-row"
                      onClick={() => state.router.push(calendarHref(u))}
                      title="Open clean"
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 6px", margin: "0 -6px", borderTop: `1px solid ${i === 0 ? "transparent" : C.hair}` }}
                    >
                      <div style={{ width: 40, flex: "none" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: C.muted }}>{SHORT_DAYS[dayOf(u.date).getUTCDay()]}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{String(dayOf(u.date).getUTCDate()).padStart(2, "0")}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.locationName}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{jobTime(u)}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flex: "none", width: 84 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: cleanerHex(u.subcontractor?.name), flex: "none" }} />
                        <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.subcontractor?.name ?? u.vendor?.name ?? "Unassigned"}</span>
                      </div>
                    </div>
                  ))}
                  {upcoming.length === 0 && (
                    <div style={{ padding: "12px 0 4px" }}>
                      <div style={{ fontSize: 12.5, color: C.muted }}>{status === "paused" ? "Schedule paused." : status === "trial" ? "Trial clean not booked yet." : "Nothing booked."}</div>
                      <div onClick={() => state.setShowOneTimeServiceDialog(true)} style={{ fontSize: 11.5, fontWeight: 700, color: C.teal, marginTop: 6, cursor: "pointer" }}>Schedule a Service →</div>
                    </div>
                  )}
                </div>
              </Card>

              <NotesCard clientId={client.id} legacyNote={legacyNote(client.notes)} />
            </div>
          </div>
        )}

        {tab === "billing" && <BillingTab state={state} />}
        {tab === "history" && <HistoryTab clientId={client.id} />}
      </div>
    </>
  )
}

/** The old free-text notes on the client record, without the trial marker. */
function legacyNote(notes: string | null | undefined): string | null {
  const text = (notes ?? "")
    .split("\n")
    .filter(line => !line.trim().toUpperCase().startsWith("TRIAL CLIENT"))
    .join("\n")
    .trim()
  return text || null
}

function OneTimeServices({
  jobs,
  today,
  onOpen,
  onSchedule,
  onHistory,
}: {
  jobs: ProfileJob[]
  today: Date
  onOpen: (job: ProfileJob) => void
  onSchedule: () => void
  onHistory: () => void
}) {
  // The profile holds cleans from two months back to six ahead.
  const options = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2 + i, 1, 12))
    return { value: d.toISOString().slice(0, 7), label: `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
  })
  const [monthKey, setMonthKey] = useState(today.toISOString().slice(0, 7))
  const index = options.findIndex(o => o.value === monthKey)
  const rows = jobs
    .filter(j => !j.scheduleId && dayOf(j.date).toISOString().slice(0, 7) === monthKey)
    .sort((a, b) => dayOf(a.date).getTime() - dayOf(b.date).getTime())
  const live = rows.filter(r => r.status !== "CANCELLED")
  const label = options[index]?.label ?? monthKey

  const stepper = (delta: number) => {
    const nextOpt = options[index + delta]
    if (nextOpt) setMonthKey(nextOpt.value)
  }
  const arrow = (delta: number, glyph: string) => (
    <span
      onClick={() => stepper(delta)}
      style={{ width: 24, height: 24, borderRadius: 7, border: "1px solid #e6e0d4", display: "flex", alignItems: "center", justifyContent: "center", cursor: options[index + delta] ? "pointer" : "default", color: options[index + delta] ? C.sub : "#d6cfc0", fontSize: 13, background: "#fff" }}
    >
      {glyph}
    </span>
  )

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.mintBorder}`, borderRadius: 14, paddingBottom: 10, marginTop: 6, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: C.mint, borderBottom: `1px solid ${C.mintBorder}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", color: C.mintTitle, whiteSpace: "nowrap" }}>One-time services</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {arrow(-1, "‹")}
            <select
              value={monthKey}
              onChange={e => setMonthKey(e.target.value)}
              style={{ fontSize: 12.5, fontWeight: 800, color: C.text, background: "transparent", border: "none", padding: "2px 4px", cursor: "pointer", textAlignLast: "center", fontFamily: "inherit", appearance: "none", WebkitAppearance: "none" }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {arrow(1, "›")}
          </div>
          <AddButton label="Schedule Service" onClick={onSchedule} />
        </div>
      </div>
      <div style={{ padding: "0 20px" }}>
        {rows.map((x, i) => {
          const done = x.status !== "CANCELLED" && dayOf(x.date) < new Date(today.getTime() - 12 * 3600e3)
          const chip = x.status === "CANCELLED"
            ? { label: "Cancelled", bg: "#f0eee8", fg: C.faint }
            : done ? { label: "Done", bg: "#e7f6ee", fg: "#1f8a5b" } : { label: "Scheduled", bg: "#eef2fb", fg: "#3b5bdb" }
          return (
            <div
              key={x.id}
              className="cfp-row"
              onClick={() => onOpen(x)}
              title="Open clean"
              style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) auto auto", gap: 12, alignItems: "center", padding: "10px 8px", margin: "0 -8px", borderTop: `1px solid ${i === 0 ? "transparent" : C.hair}` }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: C.muted }}>{SHORT_DAYS[dayOf(x.date).getUTCDay()]}</div>
                <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{dayOf(x.date).getUTCDate()}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.addOnServices?.[0]?.description ?? "One-time clean"}</div>
                <div style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.locationName}{x.subcontractor?.name || x.vendor?.name ? ` · ${x.subcontractor?.name ?? x.vendor?.name}` : ""}
                </div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: chip.bg, color: chip.fg }}>{chip.label}</span>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "1px 8px", alignItems: "baseline", justifyContent: "end" }}>
                <span style={{ fontSize: 10.5, color: C.muted }}>Client</span>
                <span style={{ fontSize: 13, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(x.clientRate)}</span>
                <span style={{ fontSize: 10.5, color: C.muted }}>Cleaner</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.sub, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(x.subcontractorRate)}</span>
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: "12px 0 6px" }}>No one-time services in {label}.</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0 4px", borderTop: `1px solid ${C.hair}`, fontSize: 11.5, color: C.muted }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {live.length > 0 ? `${label} · ${live.length} service${live.length === 1 ? "" : "s"} · ${money(live.reduce((s, x) => s + (x.clientRate || 0), 0))}` : ""}
          </span>
          <span onClick={onHistory} style={{ marginLeft: "auto", fontWeight: 800, color: C.teal, cursor: "pointer" }}>Full History →</span>
        </div>
      </div>
    </div>
  )
}

function RenameModal({ state, onClose }: { state: ReturnType<typeof useClientDetail>; onClose: () => void }) {
  const [name, setName] = useState(state.client.name)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${state.client.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) })
      if (!res.ok) return showApiError(res, "Couldn't rename the client")
      showSuccess("Client renamed")
      globalMutate("/api/clients/data")
      state.onDataChange?.()
      onClose()
    } catch {
      showError("Couldn't rename the client")
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      title="Rename client"
      onClose={onClose}
      footer={
        <>
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={!name.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <Field label="Name">
        <input autoFocus className="cfp-input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
      </Field>
    </Modal>
  )
}
