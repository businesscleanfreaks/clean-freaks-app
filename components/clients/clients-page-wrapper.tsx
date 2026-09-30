"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { mutate } from "swr"
import { useRouter } from "next/navigation"
import { AddClientModal, type AddClientPrefill } from "./add-client-modal"
import dynamic from "next/dynamic"
import { MapPin } from "lucide-react"
import { placeOnMap } from "@/lib/client-map"
import type { ClientMapPin } from "./clients-map"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { businessDayKey } from "@/lib/business-time"
import {
  clientListDisplay,
  cleanerGroupMeta,
  listInitials,
  sortCleanerGroups,
  statusInTab,
  STATUS_META,
  type ClientListFacts,
  type ClientListStatus,
  type ClientListTab,
} from "@/lib/client-listing"

/**
 * The Clients page, built from `design_handoff_clients/source/Clients Main.dc.html`.
 *
 * Status, the schedule line and the money column all come from the facts the
 * API works out (see lib/client-listing-facts.ts) · this component only lays
 * them out. Nothing here decides what a client is.
 */

// Leaflet only loads when the Map view is opened.
const ClientsMap = dynamic(() => import("./clients-map"), {
  ssr: false,
  loading: () => <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "#8a857a" }}>Loading map…</div>,
})

interface ClientLocation {
  id: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  area?: string
}

interface ClientData {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  communicationContactName: string | null
  invoicingEmail: string | null
  isActive: boolean
  locations: ClientLocation[]
  primaryArea: string
  listing: {
    facts: ClientListFacts
    cleaner: string
    contactName: string | null
    contactRole: string | null
    photoUrl: string | null
    contactPhotoUrl: string | null
  }
}

interface ClientsPageWrapperProps {
  clients: ClientData[]
  prefillProspect?: {
    id: string
    businessName: string
    contactName: string | null
    phone: string | null
    email: string | null
    notes: string | null
  } | null
}

type ViewMode = "az" | "cleaner" | "cards" | "map"

const TABS: { key: ClientListTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "recurring", label: "Recurring" },
  { key: "asneeded", label: "As-needed" },
  { key: "trial", label: "Trial" },
  { key: "inactive", label: "Inactive" },
]

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "az", label: "A–Z" },
  { key: "cleaner", label: "Cleaner" },
  { key: "cards", label: "Cards" },
  { key: "map", label: "Map" },
]

/** One row, ready to draw in any of the views. */
interface ListRow {
  id: string
  name: string
  subLine: string
  initials: string
  status: ClientListStatus
  statusLabel: string
  inactive: boolean
  cleaner: string
  cleanerColor: string
  schedule: string
  money: string
  moneyMuted: boolean
  rateSub: string
  /** Committed monthly revenue, for the cleaner group totals. */
  monthly: number
  contactName: string
  contactRole: string
  photoUrl: string | null
  contactPhotoUrl: string | null
  area: string
  locations: ClientLocation[]
  haystack: string
}

const cleanerHex = (name: string) =>
  getCleanerColorInfo(name && name !== "Unassigned" && name !== "Mixed" ? name : null).hex

function toRow(client: ClientData, today: Date): ListRow {
  const { facts, cleaner, contactName, contactRole, photoUrl, contactPhotoUrl } = client.listing
  const display = clientListDisplay(facts, today)
  const locationCount = client.locations.length
  const area = client.primaryArea || ""
  const subLine = [locationCount > 1 ? `${locationCount} locations` : "", area].filter(Boolean).join(" · ")

  return {
    id: client.id,
    name: client.name,
    subLine,
    initials: listInitials(client.name),
    status: display.status,
    statusLabel: display.statusLabel,
    inactive: display.status === "inactive",
    cleaner,
    cleanerColor: cleanerHex(cleaner),
    schedule: display.scheduleLine,
    money: display.money,
    moneyMuted: display.moneyMuted,
    rateSub: display.rateSub,
    monthly: display.status === "recurring" ? facts.monthlyRecurring : 0,
    contactName: contactName || "–",
    contactRole: contactRole || "",
    photoUrl: photoUrl ?? null,
    contactPhotoUrl: contactPhotoUrl ?? null,
    area,
    locations: client.locations,
    haystack: [
      client.name,
      contactName,
      cleaner,
      area,
      client.communicationEmail,
      client.invoicingEmail,
      client.phone,
    ].filter(Boolean).join(" ").toLowerCase(),
  }
}

// ── Pieces ────────────────────────────────────────────────────────────────

function StatusChip({ row, floating = false }: { row: ListRow; floating?: boolean }) {
  const meta = STATUS_META[row.status]
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.02em", padding: "2px 8px", borderRadius: 6,
        flex: "none", background: meta.bg, color: meta.color,
        ...(floating ? { position: "absolute", top: 10, right: 10 } : {}),
      }}
    >
      {row.statusLabel}
    </span>
  )
}

function Avatar({ row, size = 32 }: { row: ListRow; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: size >= 44 ? 12 : 9, flex: "none",
        background: row.inactive ? "#c4bdae" : "#0d9488", color: "#fff",
        fontSize: size >= 44 ? 14 : 11.5, fontWeight: 800, letterSpacing: "0.02em",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {row.initials}
    </span>
  )
}

/**
 * On a phone the cleaner and schedule columns do not fit, so they fold into a
 * line under the name (see the 760px rule in the page styles).
 */
function NameBlock({ row, showCleaner = true }: { row: ListRow; showCleaner?: boolean }) {
  return (
    <div className="cfcl-c-name" style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <Avatar row={row} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span className="cfcl-ellipsis" style={{ fontSize: 14, fontWeight: 700, color: row.inactive ? "#8a857a" : "#1a1a1a" }}>
            {row.name}
          </span>
          <StatusChip row={row} />
        </div>
        {row.subLine && (
          <div className="cfcl-ellipsis cfcl-wide-only" style={{ fontSize: 11.5, color: "#8a857a", marginTop: 1 }}>{row.subLine}</div>
        )}
        <div className="cfcl-narrow-only" style={{ alignItems: "center", gap: 6, marginTop: 2, minWidth: 0, fontSize: 12, color: "#5c574e" }}>
          {showCleaner && <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: row.cleanerColor }} />}
          <span className="cfcl-ellipsis">{showCleaner ? `${row.cleaner} · ${row.schedule}` : row.schedule}</span>
        </div>
      </div>
    </div>
  )
}

function Revenue({ row, size = 14 }: { row: ListRow; size?: number }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: size, fontWeight: 800, color: row.moneyMuted ? "#bdb7ab" : "#1a1a1a", fontVariantNumeric: "tabular-nums" }}>
        {row.money}
      </div>
      <div style={{ fontSize: 10.5, color: "#8a857a", marginTop: 1, whiteSpace: "nowrap" }}>{row.rateSub}</div>
    </div>
  )
}

const AZ_COLUMNS = "minmax(200px,1fr) 158px 152px 116px"
const GROUP_COLUMNS = "minmax(200px,1fr) 168px 116px"
const COLUMN_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a857a",
}

function AzView({ rows, onOpen }: { rows: ListRow[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="cfcl-wide-grid" style={{ gridTemplateColumns: AZ_COLUMNS, gap: 14, padding: "11px 18px", position: "sticky", top: 0, background: "var(--cf-canvas, #f3f0e9)", zIndex: 2 }}>
        <span style={COLUMN_LABEL}>Client</span>
        <span style={COLUMN_LABEL}>Cleaner</span>
        <span style={COLUMN_LABEL}>Schedule</span>
        <span style={{ ...COLUMN_LABEL, textAlign: "right" }}>Revenue</span>
      </div>
      <div className="cfcl-card">
        {rows.map(row => (
          <div key={row.id} className="cfcl-row" onClick={() => onOpen(row.id)} style={{ gridTemplateColumns: AZ_COLUMNS }}>
            <NameBlock row={row} />
            <div className="cfcl-wide-flex" style={{ alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: row.cleanerColor }} />
              <span className="cfcl-ellipsis" style={{ fontSize: 13, color: "#5c574e" }}>{row.cleaner}</span>
            </div>
            <span className="cfcl-ellipsis cfcl-wide-only" style={{ fontSize: 13, color: "#5c574e" }}>{row.schedule}</span>
            <Revenue row={row} />
          </div>
        ))}
      </div>
    </>
  )
}

function CleanerView({ rows, onOpen }: { rows: ListRow[]; onOpen: (id: string) => void }) {
  // Groups start collapsed, per the design: the headers ARE the overview.
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const byCleaner = new Map<string, ListRow[]>()
    for (const row of rows) {
      const list = byCleaner.get(row.cleaner) ?? []
      list.push(row)
      byCleaner.set(row.cleaner, list)
    }
    return sortCleanerGroups(
      [...byCleaner.entries()].map(([name, list]) => ({
        name,
        clients: [...list].sort((a, b) => a.name.localeCompare(b.name)),
        total: list.reduce((sum, r) => sum + r.monthly, 0),
      })),
    )
  }, [rows])

  return (
    <div>
      {groups.map(group => {
        const isOpen = !!open[group.name]
        return (
          <div key={group.name} style={{ marginBottom: 16 }}>
            <div
              className="cfcl-group-head"
              onClick={() => setOpen(prev => ({ ...prev, [group.name]: !prev[group.name] }))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a39d90" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", transform: `rotate(${isOpen ? 90 : 0}deg)`, transition: "transform .15s" }}>
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: cleanerHex(group.name) }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: "#1a1a1a", whiteSpace: "nowrap" }}>{group.name}</span>
              <span className="cfcl-group-meta" style={{ fontSize: 12, color: "#8a857a", fontWeight: 600 }}>{cleanerGroupMeta(group.clients.length, group.total)}</span>
            </div>
            {isOpen && (
              <div className="cfcl-card">
                {group.clients.map(row => (
                  <div key={row.id} className="cfcl-row" onClick={() => onOpen(row.id)} style={{ gridTemplateColumns: GROUP_COLUMNS }}>
                    <NameBlock row={row} showCleaner={false} />
                    <span className="cfcl-ellipsis cfcl-wide-only" style={{ fontSize: 13, color: "#5c574e" }}>{row.schedule}</span>
                    <Revenue row={row} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CardsView({ rows, onOpen }: { rows: ListRow[]; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, paddingTop: 4 }}>
      {rows.map(row => (
        <div key={row.id} className="cfcl-client-card" onClick={() => onOpen(row.id)}>
          {/* Photo band: the client photo, or the tinted band with the
              initials tile when there is none. Set on the client's profile. */}
          <div
            style={{
              height: 96,
              background: row.inactive ? "#f0eee8" : "#e9f6f1",
              backgroundImage: row.photoUrl ? `url("${row.photoUrl}")` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              borderBottom: "1px solid #ece7dd",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {!row.photoUrl && <Avatar row={row} size={44} />}
            <StatusChip row={row} floating />
          </div>
          <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div style={{ height: 40, minWidth: 0 }}>
              <div className="cfcl-ellipsis" style={{ fontSize: 14.5, fontWeight: 800, lineHeight: 1.25, color: row.inactive ? "#8a857a" : "#1a1a1a" }}>{row.name}</div>
              <div className="cfcl-ellipsis" style={{ fontSize: 11.5, color: "#8a857a", marginTop: 2 }}>{row.subLine}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, borderTop: "1px solid #f4efe6", paddingTop: 12 }}>
              <span
                style={{
                  width: 52, height: 52, borderRadius: "50%", flex: "none", background: "#64748b",
                  backgroundImage: row.contactPhotoUrl ? `url("${row.contactPhotoUrl}")` : "none",
                  backgroundSize: "cover", backgroundPosition: "center",
                  color: "#fff", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 0 2px #fff, 0 0 0 3px #ece7dd",
                }}
              >
                {row.contactPhotoUrl ? null : row.contactName === "–" ? "?" : listInitials(row.contactName)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="cfcl-ellipsis" style={{ fontSize: 13.5, fontWeight: 700 }}>{row.contactName}</div>
                <div className="cfcl-ellipsis" style={{ fontSize: 11.5, color: "#8a857a", marginTop: 2, minHeight: 14 }}>{row.contactRole}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#5c574e", borderTop: "1px solid #f4efe6", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: row.cleanerColor }} />
                <span className="cfcl-ellipsis">{row.cleaner}</span>
              </div>
              <div className="cfcl-ellipsis">{row.schedule}</div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: "auto" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: row.moneyMuted ? "#bdb7ab" : "#1a1a1a", fontVariantNumeric: "tabular-nums" }}>{row.money}</span>
              <span style={{ fontSize: 10.5, color: "#8a857a", whiteSpace: "nowrap" }}>{row.rateSub}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function MapView({ rows, onOpen }: { rows: ListRow[]; onOpen: (id: string) => void }) {
  const { pins, unplaced } = useMemo(() => placeOnMap(rows), [rows])
  const mapPins: ClientMapPin[] = useMemo(() => pins.map(p => ({
    key: p.location.id,
    clientId: p.client.id,
    lat: p.lat,
    lng: p.lng,
    color: p.client.cleanerColor,
    label: p.label,
    area: p.location.area || p.client.area,
    cleaner: p.client.cleaner,
    money: p.client.money,
    schedule: p.client.schedule,
  })), [pins])

  const areas = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const area = row.area || "No address"
      counts.set(area, (counts.get(area) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [rows])

  return (
    <div className="cfcl-card cfcl-map" style={{ display: "flex", minHeight: 560 }}>
      <div className="cfcl-map-canvas" style={{ flex: 1, position: "relative", background: "#eef1f0", minWidth: 0, isolation: "isolate" }}>
        <ClientsMap pins={mapPins} onOpen={onOpen} />
        <div style={{ position: "absolute", left: 56, top: 12, zIndex: 2, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#7f8ea3", background: "#fff", padding: "5px 10px", borderRadius: 7, boxShadow: "0 1px 2px rgba(0,0,0,.08)", pointerEvents: "none" }}>
          Greater Los Angeles{unplaced.length > 0 ? ` · ${unplaced.length} not on map` : ""}
        </div>
        {pins.length === 0 && (
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 2, background: "#fff", borderRadius: 12, padding: "18px 22px", textAlign: "center", color: "#8a857a", boxShadow: "0 6px 18px rgba(40,30,10,0.12)", maxWidth: 300, pointerEvents: "none" }}>
            <MapPin style={{ width: 28, height: 28, margin: "0 auto 8px", opacity: 0.5 }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: "#5c574e" }}>No locations on the map yet</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>A location is placed from its address when it is saved. Addresses need a city or ZIP.</div>
          </div>
        )}
      </div>
      <div className="cfcl-map-areas" style={{ width: 240, flex: "none", borderLeft: "1px solid #efe9dd", padding: 16, overflowY: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#8a857a", marginBottom: 10 }}>By area</div>
        {areas.map(([area, count]) => (
          <div key={area} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #f4efe6" }}>
            <span style={{ fontSize: 13, color: "#1a1a1a", fontWeight: 600 }}>{area}</span>
            <span style={{ fontSize: 12, color: "#8a857a", fontWeight: 700 }}>{count}</span>
          </div>
        ))}
        {unplaced.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#8a857a", margin: "20px 0 4px" }}>Not on the map · {unplaced.length}</div>
            <div style={{ fontSize: 11.5, color: "#8a857a", marginBottom: 8 }}>Add a city or ZIP to the address to place it.</div>
            {unplaced.map(({ client, location }) => (
              <div
                key={location.id}
                onClick={() => onOpen(client.id)}
                title="Open the client to fix the address"
                style={{ padding: "7px 0", borderTop: "1px solid #f4efe6", cursor: "pointer", minWidth: 0 }}
              >
                <div className="cfcl-ellipsis" style={{ fontSize: 12.5, fontWeight: 700, color: "#1a1a1a" }}>{client.name}</div>
                <div className="cfcl-ellipsis" style={{ fontSize: 11.5, color: "#8a857a" }}>{location.address || location.name}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ClientsPageWrapper({ clients, prefillProspect }: ClientsPageWrapperProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [showWizard, setShowWizard] = useState(false)
  const [tab, setTab] = useState<ClientListTab>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("az")
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (prefillProspect) setShowWizard(true)
  }, [prefillProspect])

  // A prospect being turned into a client opens the modal filled in. Memoised:
  // the modal resets its form whenever this changes.
  const prefill = useMemo<AddClientPrefill | null>(
    () => prefillProspect
      ? {
          sourceProspectId: prefillProspect.id,
          clientName: prefillProspect.businessName,
          contactName: prefillProspect.contactName,
          email: prefillProspect.email,
          phone: prefillProspect.phone,
          notes: prefillProspect.notes,
        }
      : null,
    [prefillProspect],
  )

  const closeAddClient = useCallback(() => {
    setShowWizard(false)
    if (prefillProspect) router.replace("/clients")
  }, [prefillProspect, router])

  // The business's today, so "next Oct 3" and the 90-day window agree with the
  // server whatever timezone this browser is in.
  const today = useMemo(() => new Date(`${businessDayKey(new Date())}T12:00:00.000Z`), [])

  const allRows = useMemo(
    () => clients.map(c => toRow(c, today)).sort((a, b) => a.name.localeCompare(b.name)),
    [clients, today],
  )

  const counts = useMemo(() => {
    const result = {} as Record<ClientListTab, number>
    for (const t of TABS) result[t.key] = allRows.filter(r => statusInTab(r.status, t.key)).length
    return result
  }, [allRows])

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allRows
      .filter(r => statusInTab(r.status, tab))
      .filter(r => !q || r.haystack.includes(q))
  }, [allRows, tab, searchQuery])

  const openClient = (id: string) => router.push(`/clients/${id}`)

  return (
    <div className="cfcl-page">
      <style>{`
        .cfcl-page { width: 100%; max-width: 1760px; margin: 0 auto; padding: 22px 30px 40px; color: #1a1a1a; }
        .cfcl-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .cfcl-card { background: #fff; border: 1px solid #ece7dd; border-radius: 14px; overflow: hidden; }
        .cfcl-row { display: grid; gap: 14px; align-items: center; padding: 12px 18px; border-top: 1px solid #f4efe6; cursor: pointer; transition: background .12s; }
        .cfcl-row:first-child { border-top: none; }
        .cfcl-row:hover { background: #faf8f3; }
        .cfcl-group-head { display: flex; align-items: center; gap: 10px; padding: 11px 16px 9px; cursor: pointer; border-radius: 10px; user-select: none; }
        .cfcl-group-head:hover { background: #ebe5da; }
        .cfcl-client-card { background: #fff; border: 1px solid #ece7dd; border-radius: 14px; cursor: pointer; display: flex; flex-direction: column; min-width: 0; overflow: hidden; transition: box-shadow .12s ease, border-color .12s ease; }
        .cfcl-client-card:hover { border-color: #cfe3dc; box-shadow: 0 6px 18px rgba(40,30,10,0.08); }
        .cfcl-add:hover { background: #0b6b60 !important; }
        .cfcl-wide-grid { display: grid; }
        .cfcl-wide-flex { display: flex; }
        .cfcl-narrow-only { display: none; }
        @media (max-width: 760px) {
          .cfcl-page { padding: 16px 14px 32px; }
          .cfcl-search { order: 3; flex-basis: 100% !important; max-width: none !important; min-width: 0 !important; }
          .cfcl-tabs { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; max-width: 100%; }
          .cfcl-tabs::-webkit-scrollbar { display: none; }
          .cfcl-row { grid-template-columns: minmax(0, 1fr) auto !important; padding: 12px 14px; }
          .cfcl-wide-grid, .cfcl-wide-flex, .cfcl-wide-only { display: none !important; }
          .cfcl-narrow-only { display: flex; }
          .cfcl-group-head { flex-wrap: wrap; row-gap: 1px; }
          .cfcl-group-meta { flex-basis: 100%; padding-left: 43px; }
          .cfcl-map { flex-direction: column; min-height: 0 !important; }
          .cfcl-map-areas { width: auto !important; border-left: none !important; border-top: 1px solid #efe9dd; }
          .cfcl-map-canvas { min-height: 380px; }
        }
      `}</style>

      {/* TOP BAR */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, margin: 0, flex: "none" }}>Clients</h1>
        <div className="cfcl-search" style={{ position: "relative", flex: 1, maxWidth: 440, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", display: "flex", pointerEvents: "none", color: "#8a857a" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          </span>
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search clients, cleaners, or areas…"
            style={{ width: "100%", fontSize: 13.5, padding: "10px 14px 10px 36px", border: "1px solid #e6e0d4", borderRadius: 10, outline: "none", background: "#fff", color: "#1a1a1a" }}
          />
          {searchQuery && (
            <span
              role="button"
              aria-label="Clear search"
              onClick={() => { setSearchQuery(""); searchRef.current?.focus() }}
              style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#b6b0a3", fontSize: 14 }}
            >
              ✕
            </span>
          )}
        </div>
        <button
          className="cfcl-add"
          onClick={() => setShowWizard(true)}
          style={{ marginLeft: "auto", flex: "none", display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: "#fff", background: "#0d9488", border: "none", padding: "10px 16px", borderRadius: 10, cursor: "pointer" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add Client
        </button>
      </div>

      {/* FILTER ROW */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 18, borderBottom: "1px solid #e9e3d7", flexWrap: "wrap" }}>
        <div className="cfcl-tabs" style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <div
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                style={{
                  fontSize: 13, fontWeight: 700, padding: "9px 0", cursor: "pointer", whiteSpace: "nowrap", flex: "none",
                  borderBottom: `2px solid ${active ? "#0d9488" : "transparent"}`, color: active ? "#1a1a1a" : "#8a857a", marginBottom: -1,
                }}
              >
                {t.label} <span style={{ color: "#bdb7ab", fontWeight: 800, marginLeft: 3 }}>{counts[t.key]}</span>
              </div>
            )
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8a857a", letterSpacing: "0.02em" }}>View</span>
          <div style={{ display: "flex", background: "#ebe6db", borderRadius: 9, padding: 3, gap: 2 }}>
            {VIEWS.map(v => {
              const on = viewMode === v.key
              return (
                <button
                  key={v.key}
                  onClick={() => setViewMode(v.key)}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: "6px 15px", border: "none", borderRadius: 7, cursor: "pointer",
                    background: on ? "#fff" : "transparent", color: on ? "#1a1a1a" : "#8a857a",
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,.07)" : "none",
                  }}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: "2px 2px 0" }}>
        {rows.length === 0 ? (
          <div className="cfcl-card" style={{ marginTop: 14, textAlign: "center", padding: "48px 20px", color: "#8a857a" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No clients here</div>
            {searchQuery ? (
              <button onClick={() => setSearchQuery("")} style={{ fontSize: 12.5, color: "#0f766e", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Clear search</button>
            ) : tab !== "all" ? (
              <button onClick={() => setTab("all")} style={{ fontSize: 12.5, color: "#0f766e", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Show all clients</button>
            ) : null}
          </div>
        ) : viewMode === "az" ? (
          <AzView rows={rows} onOpen={openClient} />
        ) : viewMode === "cleaner" ? (
          <div style={{ paddingTop: 12 }}><CleanerView rows={rows} onOpen={openClient} /></div>
        ) : viewMode === "cards" ? (
          <div style={{ paddingTop: 14 }}><CardsView rows={rows} onOpen={openClient} /></div>
        ) : (
          <div style={{ paddingTop: 14 }}><MapView rows={rows} onOpen={openClient} /></div>
        )}
      </div>

      <AddClientModal
        isOpen={showWizard}
        prefill={prefill}
        onClose={closeAddClient}
        onCreated={() => {
          mutate("/api/clients/data")
          mutate("/api/dashboard-stats")
        }}
        onBookFirstClean={(clientId: string) => {
          setShowWizard(false)
          router.push(`/clients/${clientId}?book=1`)
        }}
      />
    </div>
  )
}
