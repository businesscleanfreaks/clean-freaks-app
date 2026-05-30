"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { mutate } from "swr"
import { useRouter } from "next/navigation"
import { AddClientWizard } from "./add-client-wizard"
import { Plus, Search as SearchIcon, ChevronRight, X as XIcon, MapPin, Trash2 } from "lucide-react"
import { getCleanerColorInfo } from "@/lib/calendar-design-tokens"
import { useConfirm } from "@/hooks/use-confirm"
import { showSuccess, showError, showApiError } from "@/lib/toast"

interface Location {
  id: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  area?: string
  jobs?: Array<{ status: string; date?: string | Date }>
}

interface Client {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  communicationContactName: string | null
  invoicingEmail: string | null
  billingType: string
  cleanerPayType?: string
  notes: string | null
  isActive: boolean
  createdAt: string
  startDate?: string | null
  locations: Location[]
  cleanerDisplay?: string
  primaryRate: number | null
  primaryClientPayType?: string
  primaryFrequency: string | null
  scheduleText: string
  primaryArea: string
}

interface ClientsPageWrapperProps {
  clients: Client[]
  prefillProspect?: {
    id: string
    businessName: string
    contactName: string | null
    phone: string | null
    email: string | null
    notes: string | null
  } | null
}

type ViewMode = "az" | "cleaner" | "map"
type SortKey = "name" | "contact" | "cleaner" | "rate" | "schedule"
type SortDir = "asc" | "desc"
type ClientStatusBucket = "all" | "recurring" | "trial" | "one-time" | "paused" | "cancelled"

const STATUS_TABS: { key: ClientStatusBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "recurring", label: "Recurring" },
  { key: "trial", label: "Trial" },
  { key: "one-time", label: "One-Time" },
  { key: "paused", label: "Paused" },
  { key: "cancelled", label: "Cancelled" },
]

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function formatRate(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—"
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return `$${Math.round(n)}`
}

function isClientNew(client: Client): boolean {
  if (!client.isActive) return false
  const created = new Date(client.createdAt)
  if (!Number.isFinite(created.getTime())) return false
  const daysSinceCreated = Math.floor((Date.now() - created.getTime()) / 86_400_000)
  if (daysSinceCreated < 0 || daysSinceCreated > 7) return false
  const startDate = client.startDate ? new Date(client.startDate) : null
  const daysSinceStart = startDate && Number.isFinite(startDate.getTime())
    ? Math.floor((Date.now() - startDate.getTime()) / 86_400_000)
    : daysSinceCreated
  if (daysSinceStart < 0 || daysSinceStart > 14) return false
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const hasHistorical = client.locations?.some(loc =>
    loc.jobs?.some((job) => {
      if (!job.date || job.status === "CANCELLED") return false
      const d = new Date(job.date)
      return Number.isFinite(d.getTime()) && d <= todayStart
    })
  )
  return !hasHistorical
}

function ClientRow({
  client,
  showCleaner,
  zebra,
  onOpen,
  onDelete,
}: {
  client: Client
  showCleaner: boolean
  zebra: boolean
  onOpen: (id: string) => void
  onDelete: (client: Client) => void
}) {
  const [hovered, setHovered] = useState(false)
  const cleanerHex = getCleanerColorInfo(client.cleanerDisplay && client.cleanerDisplay !== "Unassigned" && client.cleanerDisplay !== "Mixed" ? client.cleanerDisplay : null).hex
  const isFlat = client.primaryClientPayType === "FLAT_RATE" || client.billingType === "FLAT_RATE"
  const billingPillBg = isFlat ? "#F5F3FF" : "#F0FDFA"
  const billingPillColor = isFlat ? "#7C3AED" : "#0D9488"
  const billingPillText = isFlat ? "Mo" : "Per"
  const locLabel = client.locations.length > 1 ? `${client.locations.length} locations` : (client.locations[0]?.name && client.locations[0].name !== client.name ? client.locations[0].name : "")
  const isNew = isClientNew(client)

  return (
    <tr
      onClick={() => onOpen(client.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: "pointer",
        background: hovered ? "#F0FDFA" : zebra ? "#FCFCFD" : "transparent",
        borderBottom: "1px solid #F8FAFC",
        transition: "background 0.08s",
      }}
    >
      <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 5, flexShrink: 0,
            background: "linear-gradient(145deg,#0FA89D,#0D8680)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 9, fontWeight: 700,
          }}>{getInitials(client.name)}</div>
          <span style={{ fontSize: 13, fontWeight: 500, color: client.isActive ? "#0F172A" : "#94A3B8", overflow: "hidden", textOverflow: "ellipsis" }}>{client.name}</span>
          {locLabel && <span style={{ fontSize: 11, color: "#94A3B8" }}>· {locLabel}</span>}
          {isNew && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#0D9488", background: "#F0FDFA", padding: "1px 5px", borderRadius: 3, marginLeft: 2 }}>NEW</span>
          )}
          {!client.isActive && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "1px 5px", borderRadius: 3, marginLeft: 2 }}>INACTIVE</span>
          )}
          {client.primaryArea && (
            <span style={{ fontSize: 11, color: "#B0B8C4", marginLeft: 2 }}>{client.primaryArea}</span>
          )}
        </div>
      </td>
      <td style={{ padding: "6px 12px", whiteSpace: "nowrap", overflow: "hidden", maxWidth: 130 }}>
        <span
          title={client.communicationContactName || ""}
          style={{ fontSize: 12, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", paddingRight: 8 }}
        >
          {client.communicationContactName || "—"}
        </span>
      </td>
      {showCleaner && (
        <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cleanerHex, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.cleanerDisplay || "Unassigned"}</span>
          </div>
        </td>
      )}
      <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: billingPillColor, background: billingPillBg, padding: "1px 5px", borderRadius: 3 }}>{billingPillText}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>{formatRate(client.primaryRate)}</span>
        </div>
      </td>
      <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis" }}>{client.scheduleText || "—"}</span>
          <button
            type="button"
            aria-label={`Delete ${client.name}`}
            title="Delete client"
            onClick={(e) => { e.stopPropagation(); onDelete(client) }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, width: 24, height: 24, borderRadius: 5, border: "none",
              background: "transparent", color: "#CBD5E1", cursor: "pointer",
              opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.1s, color 0.1s, background 0.1s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#DC2626"; e.currentTarget.style.background = "#FEF2F2" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#CBD5E1"; e.currentTarget.style.background = "transparent" }}
          >
            <Trash2 style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function MapView({ clients, onOpen }: { clients: Client[]; onOpen: (id: string) => void }) {
  const [hovered, setHovered] = useState<Client | null>(null)
  const [pinned, setPinned] = useState<Client | null>(null)
  const W = 900, H = 500
  // LA region bounds
  const cLat = 34.05, cLng = -118.33, latR = 0.38, lngR = 0.40
  const proj = (lat: number, lng: number) => ({
    x: ((lng - (cLng - lngR / 2)) / lngR) * (W - 40) + 20,
    y: (((cLat + latR / 2) - lat) / latR) * (H - 40) + 20,
  })
  const active = pinned || hovered

  const pinnable = clients
    .map(c => {
      const loc = c.locations.find(l => l.latitude != null && l.longitude != null)
      return loc ? { client: c, lat: loc.latitude!, lng: loc.longitude! } : null
    })
    .filter((x): x is { client: Client; lat: number; lng: number } => x !== null)

  const cleanerLegend = Array.from(new Map(pinnable.map(({ client }) => [
    client.cleanerDisplay && client.cleanerDisplay !== "Unassigned" && client.cleanerDisplay !== "Mixed" ? client.cleanerDisplay : "Unassigned",
    getCleanerColorInfo(client.cleanerDisplay && client.cleanerDisplay !== "Unassigned" && client.cleanerDisplay !== "Mixed" ? client.cleanerDisplay : null).hex,
  ])).entries())

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #F1F5F9", background: "#FAFBFC", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#64748B" }}>
          {pinnable.length} location{pinnable.length !== 1 ? "s" : ""} on map
          {pinnable.length < clients.length && (
            <span style={{ color: "#94A3B8", fontWeight: 400, marginLeft: 6 }}>
              ({clients.length - pinnable.length} missing coordinates)
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {cleanerLegend.map(([name, col]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: col }} />
              <span style={{ fontSize: 10, color: "#94A3B8" }}>{name.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>
      {pinnable.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "#94A3B8" }}>
          <MapPin style={{ width: 32, height: 32, margin: "0 auto 10px", opacity: 0.4 }} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>No clients have map coordinates yet</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Coordinates are added when locations are geocoded.</div>
        </div>
      ) : (
        <div style={{ position: "relative", background: "#EDF2F7" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
            <rect width={W} height={H} fill="#EDF2F7" />
            {[
              { x1: 0, y1: H * 0.35, x2: W, y2: H * 0.35 },
              { x1: 0, y1: H * 0.55, x2: W, y2: H * 0.55 },
              { x1: 0, y1: H * 0.75, x2: W, y2: H * 0.75 },
              { x1: W * 0.25, y1: 0, x2: W * 0.25, y2: H },
              { x1: W * 0.5, y1: 0, x2: W * 0.5, y2: H },
              { x1: W * 0.75, y1: 0, x2: W * 0.75, y2: H },
            ].map((r, i) => <line key={i} {...r} stroke="#D4DCE6" strokeWidth="1.5" opacity="0.6" />)}
            {pinnable.map(({ client, lat, lng }) => {
              const { x, y } = proj(lat, lng)
              const isActive = active?.id === client.id
              const hex = getCleanerColorInfo(client.cleanerDisplay && client.cleanerDisplay !== "Unassigned" && client.cleanerDisplay !== "Mixed" ? client.cleanerDisplay : null).hex
              return (
                <g key={client.id} style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHovered(client)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setPinned(pinned?.id === client.id ? null : client)}>
                  <circle cx={x} cy={y + 1} r={isActive ? 8 : 5} fill="rgba(0,0,0,0.12)" />
                  <circle cx={x} cy={y} r={isActive ? 7 : 5} fill={hex} stroke="#fff" strokeWidth={isActive ? 2.5 : 1.5} />
                </g>
              )
            })}
          </svg>
          {active && (() => {
            const loc = active.locations.find(l => l.latitude != null && l.longitude != null)
            if (!loc) return null
            const { x, y } = proj(loc.latitude!, loc.longitude!)
            const hex = getCleanerColorInfo(active.cleanerDisplay && active.cleanerDisplay !== "Unassigned" && active.cleanerDisplay !== "Mixed" ? active.cleanerDisplay : null).hex
            return (
              <div style={{
                position: "absolute",
                left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`,
                transform: "translate(12px, -100%)",
                background: "#fff", borderRadius: 8, padding: "10px 14px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #E2E8F0",
                zIndex: 30, width: 200, pointerEvents: pinned ? "auto" : "none",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 1 }}>{active.name}</div>
                {active.primaryArea && <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>{active.primaryArea}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: hex }} />
                  <span style={{ fontSize: 11, color: "#64748B" }}>{active.cleanerDisplay}</span>
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                  <span style={{ fontWeight: 700, color: "#0F172A" }}>{formatRate(active.primaryRate)}</span>
                  <span style={{ color: "#94A3B8" }}>{active.scheduleText}</span>
                </div>
                {pinned?.id === active.id && (
                  <button onClick={() => onOpen(active.id)} style={{
                    marginTop: 8, width: "100%", padding: "5px 0", fontSize: 11, fontWeight: 600,
                    background: "#0F172A", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer",
                  }}>View Profile</button>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export function ClientsPageWrapper({ clients, prefillProspect }: ClientsPageWrapperProps) {
  const router = useRouter()
  const { confirm, ConfirmDialog } = useConfirm()
  const [searchQuery, setSearchQuery] = useState("")
  const [showWizard, setShowWizard] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ClientStatusBucket>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("az")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [collapsedCleaners, setCollapsedCleaners] = useState<Record<string, boolean>>({})
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (prefillProspect) setShowWizard(true)
  }, [prefillProspect])

  // Classify each client into exactly one bucket. Used both for the tab counts and the filter.
  const classifyClient = (c: Client): ClientStatusBucket => {
    if (!c.isActive) return "cancelled"
    // Trial: marker stamped into notes by AddClientWizard (until we add a proper schema field)
    if (c.notes && c.notes.trim().startsWith("TRIAL CLIENT")) return "trial"
    // primaryFrequency is set by /api/clients/data only when an active schedule exists
    if (c.primaryFrequency) return "recurring"
    const hasHistoricalJobs = (c.locations || []).some(loc =>
      (loc.jobs || []).some(j => !!j.date)
    )
    if (hasHistoricalJobs) return "one-time"
    return "paused"
  }

  const buckets = useMemo(() => {
    const counts: Record<ClientStatusBucket, number> = {
      all: clients.length, recurring: 0, trial: 0, "one-time": 0, paused: 0, cancelled: 0,
    }
    const byClient = new Map<string, ClientStatusBucket>()
    for (const c of clients) {
      const b = classifyClient(c)
      byClient.set(c.id, b)
      counts[b]++
    }
    return { counts, byClient }
  }, [clients])

  const stats = buckets.counts

  const filtered = useMemo(() => {
    let list = clients
    if (statusFilter !== "all") {
      list = list.filter(c => buckets.byClient.get(c.id) === statusFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.cleanerDisplay || "").toLowerCase().includes(q) ||
        (c.primaryArea || "").toLowerCase().includes(q) ||
        (c.communicationContactName || "").toLowerCase().includes(q) ||
        (c.communicationEmail || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q)
      )
    }
    return list
  }, [clients, statusFilter, searchQuery, buckets])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const d = sortDir === "asc" ? 1 : -1
    arr.sort((a, b) => {
      if (sortKey === "name") return d * a.name.localeCompare(b.name)
      if (sortKey === "contact") return d * (a.communicationContactName || "").localeCompare(b.communicationContactName || "")
      if (sortKey === "cleaner") return d * (a.cleanerDisplay || "").localeCompare(b.cleanerDisplay || "")
      if (sortKey === "rate") return d * ((a.primaryRate ?? 0) - (b.primaryRate ?? 0))
      if (sortKey === "schedule") return d * a.scheduleText.localeCompare(b.scheduleText)
      return 0
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const grouped = useMemo(() => {
    if (viewMode !== "cleaner") return null
    const map = new Map<string, { color: string; clients: Client[] }>()
    sorted.forEach(c => {
      const name = c.cleanerDisplay || "Unassigned"
      const color = getCleanerColorInfo(name !== "Unassigned" && name !== "Mixed" ? name : null).hex
      if (!map.has(name)) map.set(name, { color, clients: [] })
      map.get(name)!.clients.push(c)
    })
    return Array.from(map.entries()).sort((a, b) => b[1].clients.length - a[1].clients.length)
  }, [sorted, viewMode])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("asc") }
  }
  const toggleCollapse = (n: string) => setCollapsedCleaners(prev => ({ ...prev, [n]: !prev[n] }))

  const openClient = (id: string) => router.push(`/clients/${id}`)

  const handleDeleteClient = async (client: Client) => {
    const confirmed = await confirm({
      title: "Delete Client Permanently?",
      description: `Permanently delete "${client.name}"? This cannot be undone — its schedules, generated jobs, and any draft invoices are removed. (Clients with sent/paid invoices or payment history can't be deleted; archive those instead.)`,
      confirmText: "Delete Permanently",
      cancelText: "Cancel",
      variant: "destructive",
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "DELETE" })
      if (res.status === 409) {
        showError(`"${client.name}" has sent/paid invoices or payment history. Archive it instead, or void that history first.`)
        return
      }
      if (!res.ok) {
        await showApiError(res, "Failed to delete client")
        return
      }
      showSuccess(`Deleted "${client.name}"`)
      mutate("/api/clients/data")
      mutate("/api/dashboard-stats")
      mutate("/api/calendar/data")
      router.refresh()
    } catch {
      showError("Failed to delete client. Please try again.")
    }
  }

  const Chev = ({ k }: { k: SortKey }) => sortKey === k ? (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: sortDir === "desc" ? "rotate(180deg)" : "none", transition: "transform 0.12s", marginLeft: 2 }}>
      <path d="M2.5 6L5 3.5 7.5 6" />
    </svg>
  ) : null

  const Hd = ({ k, label }: { k: SortKey; label: string }) => (
    <span onClick={() => toggleSort(k)} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 2, color: sortKey === k ? "#0F172A" : "#94A3B8" }}>
      {label}<Chev k={k} />
    </span>
  )

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A" }}>
      {/* LINE 1: title + search + Add Client */}
      <div style={{ padding: "16px 24px 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>Clients</h1>
        <div style={{ flex: 1, maxWidth: 360, minWidth: 200, position: "relative" }}>
          <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#94A3B8", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search clients, cleaners, or areas..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 30px 7px 30px",
              border: "1px solid #E2E8F0",
              borderRadius: 7,
              fontSize: 13,
              color: "#0F172A",
              background: "#fff",
              outline: "none",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "#94A3B8" }}
            onBlur={e => { e.currentTarget.style.borderColor = "#E2E8F0" }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); searchRef.current?.focus() }}
              aria-label="Clear search"
              style={{
                position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                background: "#E2E8F0", border: "none", borderRadius: "50%",
                width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "#64748B",
              }}
            >
              <XIcon style={{ width: 10, height: 10 }} />
            </button>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowWizard(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", background: "#0F172A", color: "#fff",
            border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Plus style={{ width: 12, height: 12 }} />
          Add Client
        </button>
      </div>

      {/* LINE 2: tabs + view toggle */}
      <div style={{ padding: "10px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "1px solid #E2E8F0", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {STATUS_TABS.map(tab => {
            const count = stats[tab.key]
            const isActive = statusFilter === tab.key
            // Always show every bucket tab (even 0-count) so the VA can see all segments exist
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                style={{
                  padding: "0 0 8px",
                  fontSize: 13,
                  background: "none", border: "none", cursor: "pointer",
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "#0F172A" : "#94A3B8",
                  borderBottom: isActive ? "2px solid #0F172A" : "2px solid transparent",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label} {count}
              </button>
            )
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>View:</span>
          <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 6, padding: 2 }}>
            {([
              ["az", "A–Z"],
              ["cleaner", "Cleaner"],
              ["map", "Map"],
            ] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setViewMode(v as ViewMode)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 500,
                  background: viewMode === v ? "#fff" : "transparent",
                  color: viewMode === v ? "#0F172A" : "#94A3B8",
                  boxShadow: viewMode === v ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {searchQuery.trim() && (
        <div style={{ padding: "6px 24px 0", fontSize: 11, color: "#94A3B8" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* CONTENT */}
      <div style={{ padding: "10px 24px 28px" }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94A3B8", background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No clients found</div>
            {searchQuery ? (
              <button onClick={() => setSearchQuery("")} style={{ fontSize: 12, color: "#0F766E", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Clear search</button>
            ) : (
              <button onClick={() => setShowWizard(true)} style={{ marginTop: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, background: "#0F172A", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Add Your First Client</button>
            )}
          </div>
        ) : viewMode === "az" ? (
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 165 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
              </colgroup>
              <thead>
                <tr style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", background: "#FAFBFC", borderBottom: "1px solid #F1F5F9", userSelect: "none" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}><Hd k="name" label="Client" /></th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}><Hd k="contact" label="Contact" /></th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}><Hd k="cleaner" label="Cleaner" /></th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}><Hd k="rate" label="Rate" /></th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}><Hd k="schedule" label="Schedule" /></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <ClientRow key={c.id} client={c} showCleaner zebra={i % 2 === 1} onOpen={openClient} onDelete={handleDeleteClient} />
                ))}
              </tbody>
            </table>
          </div>
        ) : viewMode === "cleaner" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grouped && grouped.map(([name, { color, clients: cls }]) => {
              const collapsed = collapsedCleaners[name] ?? false
              const open = !collapsed
              const total = cls.reduce((s, c) => s + (c.primaryRate ?? 0), 0)
              return (
                <div key={name} style={{ background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0", overflow: "hidden" }}>
                  <div onClick={() => toggleCollapse(name)} style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, background: "#FAFBFC", borderBottom: open ? "1px solid #F1F5F9" : "none", cursor: "pointer", userSelect: "none" }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" style={{ transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>
                      <path d="M3 1.5L7 5 3 8.5" />
                    </svg>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                    <span style={{ fontSize: 12, color: "#94A3B8" }}>
                      {cls.length} client{cls.length !== 1 ? "s" : ""} · {formatRate(total)}
                    </span>
                  </div>
                  {open && (
                    <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
                      <colgroup>
                        <col />
                        <col style={{ width: 130 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 180 }} />
                      </colgroup>
                      <tbody>
                        {cls.map((c, i) => (
                          <ClientRow key={c.id} client={c} showCleaner={false} zebra={i % 2 === 1} onOpen={openClient} onDelete={handleDeleteClient} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <MapView clients={filtered} onOpen={openClient} />
        )}
      </div>

      <AddClientWizard
        isOpen={showWizard}
        initialData={prefillProspect ? {
          sourceProspectId: prefillProspect.id,
          clientName: prefillProspect.businessName,
          phone: prefillProspect.phone,
          email: prefillProspect.email,
          communicationContactName: prefillProspect.contactName,
          notes: prefillProspect.notes,
        } : null}
        onClose={() => {
          setShowWizard(false)
          if (prefillProspect) router.replace("/clients")
        }}
        onSuccess={(clientId: string) => {
          mutate("/api/clients/data")
          mutate("/api/dashboard-stats")
          mutate("/api/calendar/data")
          router.push(`/clients/${clientId}`)
        }}
      />

      <ConfirmDialog />
    </div>
  )
}

// Helper exported for the icon import to satisfy ESLint if needed elsewhere.
export { ChevronRight as _ChevronRight }
