"use client"

import { Fragment, useState, type CSSProperties } from "react"
import useSWR from "swr"
import { format } from "date-fns"
import { showError, showApiError } from "@/lib/toast"

const T = "#0D9488"
const MONO = "'JetBrains Mono', monospace"
const SVC_OPTIONS = [
  "Windows (Int)",
  "Windows (Ext)",
  "Windows (Both)",
  "Carpet",
  "Upholstery",
  "Pressure Washing",
  "Deep Clean",
  "Other",
]

const fetcher = (url: string) =>
  fetch(url).then(res => {
    if (!res.ok) throw new Error("Failed to fetch")
    return res.json()
  })

interface Contact {
  name: string
  phone: string
  email: string
}

interface VendorAddOn {
  id: string
  description: string
  subcontractorRate: number
  vendorPaid: boolean
  createdAt: string
  paidDate?: string | null
  job: {
    id: string
    date: string
    status: string
    location: { client: { id: string; name: string } }
  } | null
  schedule: {
    id: string
    location: { client: { id: string; name: string } }
  } | null
}

interface VendorData {
  id: string
  name: string
  isActive: boolean
  phone: string | null
  email: string | null
  zelle: string | null
  services: string[]
  contacts: Contact[]
  notes: string | null
  owedAmount: number
  unpaidAddOns: number
  addOnServices: VendorAddOn[]
}

interface VendorJob {
  id: string
  client: string
  service: string
  date: string
  amount: number
  paid: boolean
  paidDate: string | null
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function addOnClientName(a: VendorAddOn) {
  return a.job?.location?.client?.name || a.schedule?.location?.client?.name || "Unassigned"
}

function fmtDate(iso: string) {
  try {
    return format(new Date(iso), "MMM d, yyyy")
  } catch {
    return ""
  }
}

function toJobs(v: VendorData): VendorJob[] {
  return v.addOnServices.map(a => ({
    id: a.id,
    client: addOnClientName(a),
    service: a.description,
    date: fmtDate(a.job?.date || a.createdAt),
    amount: a.subcontractorRate,
    paid: a.vendorPaid,
    paidDate: a.paidDate ? fmtDate(a.paidDate) : null,
  }))
}

const inp: CSSProperties = { width: "100%", padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13, outline: "none", color: "#0F172A" }
const inpSm: CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, outline: "none", color: "#0F172A" }
const vf: CSSProperties = { padding: "6px 8px", fontSize: 12, color: "#0F172A", fontWeight: 500, background: "#F8FAFC", borderRadius: 6, border: "1px solid #F1F5F9" }
const thStyle: CSSProperties = { padding: "10px 20px", fontSize: 10, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", borderBottom: "2px solid #F1F5F9" }

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{children}</div>
}

export function VendorsPageClient() {
  const { data, error, isLoading, mutate } = useSWR<VendorData[]>("/api/vendors", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 15000,
  })
  const vendors = data || []

  const [expanded, setExpanded] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline edit state
  const [editingVendor, setEditingVendor] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ contacts: Contact[]; zelle: string; services: string[]; notes: string }>(
    { contacts: [], zelle: "", services: [], notes: "" }
  )

  // New-vendor form state
  const [newName, setNewName] = useState("")
  const [newContacts, setNewContacts] = useState<Contact[]>([{ name: "", phone: "", email: "" }])
  const [newZelle, setNewZelle] = useState("")
  const [newSvcs, setNewSvcs] = useState<string[]>([])
  const [newNotes, setNewNotes] = useState("")

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  // ── Derived ──
  const visible = vendors.filter(v => v.isActive !== false)
  const filtered = search.trim()
    ? visible.filter(v =>
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        v.services.some(s => s.toLowerCase().includes(search.toLowerCase()))
      )
    : visible
  const sorted = [...filtered].sort((a, b) => {
    const ao = a.owedAmount, bo = b.owedAmount
    if (ao > 0 && bo === 0) return -1
    if (ao === 0 && bo > 0) return 1
    if (ao !== bo) return bo - ao
    return a.name.localeCompare(b.name)
  })
  const totalOwed = visible.reduce((s, v) => s + v.owedAmount, 0)

  // ── Mutations ──
  const markPaid = async (vendorId: string, jobId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vendorId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addOnServiceIds: [jobId] }),
      })
      if (!res.ok) { await showApiError(res, "Failed to mark as paid"); return }
      await mutate()
      flash("Marked as paid")
    } catch { showError("Failed to mark as paid") } finally { setBusy(false) }
  }

  const payAll = async (vendorId: string, ids: string[]) => {
    if (busy || ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vendorId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addOnServiceIds: ids }),
      })
      if (!res.ok) { await showApiError(res, "Failed to pay all"); return }
      await mutate()
      flash("All jobs marked as paid")
    } catch { showError("Failed to pay all") } finally { setBusy(false) }
  }

  const addVendor = async () => {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          zelle: newZelle || null,
          services: newSvcs,
          contacts: newContacts.filter(c => c.name || c.phone || c.email),
          notes: newNotes || null,
        }),
      })
      if (!res.ok) { await showApiError(res, "Failed to add vendor"); return }
      await mutate()
      setNewName(""); setNewContacts([{ name: "", phone: "", email: "" }]); setNewZelle(""); setNewSvcs([]); setNewNotes("")
      setShowAdd(false)
      flash("Vendor added")
    } catch { showError("Failed to add vendor") } finally { setBusy(false) }
  }

  const startEdit = (v: VendorData) => {
    setEditingVendor(v.id)
    setEditForm({ contacts: v.contacts.map(c => ({ ...c })), zelle: v.zelle || "", services: [...v.services], notes: v.notes || "" })
  }

  const saveEdit = async (vid: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacts: editForm.contacts.filter(c => c.name || c.phone || c.email),
          zelle: editForm.zelle || null,
          services: editForm.services,
          notes: editForm.notes || null,
        }),
      })
      if (!res.ok) { await showApiError(res, "Failed to update vendor"); return }
      await mutate()
      setEditingVendor(null)
      flash("Vendor updated")
    } catch { showError("Failed to update vendor") } finally { setBusy(false) }
  }

  const archiveVendor = async (vid: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      })
      if (!res.ok) { await showApiError(res, "Failed to archive vendor"); return }
      await mutate()
      setEditingVendor(null)
      flash("Vendor archived")
    } catch { showError("Failed to archive vendor") } finally { setBusy(false) }
  }

  // Edit-form contact helpers
  const editContact = (i: number, f: keyof Contact, val: string) =>
    setEditForm(ef => ({ ...ef, contacts: ef.contacts.map((c, ci) => ci === i ? { ...c, [f]: val } : c) }))
  const addEditContact = () => setEditForm(ef => ({ ...ef, contacts: [...ef.contacts, { name: "", phone: "", email: "" }] }))
  const removeEditContact = (i: number) => setEditForm(ef => ({ ...ef, contacts: ef.contacts.filter((_, ci) => ci !== i) }))
  const toggleEditSvc = (svc: string) =>
    setEditForm(ef => ({ ...ef, services: ef.services.includes(svc) ? ef.services.filter(x => x !== svc) : [...ef.services, svc] }))

  // New-vendor contact helpers
  const updateNewContact = (i: number, f: keyof Contact, val: string) => {
    const c = [...newContacts]; c[i] = { ...c[i], [f]: val }; setNewContacts(c)
  }
  const addNewContact = () => setNewContacts([...newContacts, { name: "", phone: "", email: "" }])
  const removeNewContact = (i: number) => { if (newContacts.length > 1) setNewContacts(newContacts.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ fontFamily: "'Outfit', -apple-system, sans-serif", minHeight: "100vh", background: "#F8FAFC", padding: "24px 32px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');@keyframes fi{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@keyframes ti{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", letterSpacing: "-0.02em" }}>Vendors</h1>
          <div style={{ display: "flex", gap: 16, marginTop: 6, alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>Unpaid</span>
              <span style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, color: totalOwed > 0 ? "#DC2626" : "#16A34A", marginLeft: 6 }}>${Math.round(totalOwed).toLocaleString()}</span>
            </div>
            <div style={{ width: 1, height: 20, background: "#E2E8F0" }} />
            <div>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>Vendors</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginLeft: 6 }}>{visible.length}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          style={{ all: "unset", padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "#0F172A", color: "#fff", cursor: "pointer" }}
        >
          {showAdd ? "Cancel" : "+ Add Vendor"}
        </button>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
          <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vendors or services..."
          style={{ width: "100%", maxWidth: 400, padding: "9px 12px 9px 32px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none", color: "#0F172A", background: "#fff" }}
        />
      </div>

      {/* Add Vendor (inline) */}
      {showAdd && (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 20px", marginBottom: 14, animation: "fi 0.15s ease", borderLeft: `3px solid ${T}` }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", display: "block", marginBottom: 12 }}>New Vendor</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <Lbl>Company / Vendor Name *</Lbl>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Company name" autoFocus style={inp} />
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>Zelle Email</Lbl>
              <input value={newZelle} onChange={e => setNewZelle(e.target.value)} placeholder="zelle@email.com" style={inp} />
            </div>
          </div>

          {newContacts.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><Lbl>Contact Name</Lbl><input value={c.name} onChange={e => updateNewContact(i, "name", e.target.value)} placeholder="First Last" style={inpSm} /></div>
              <div style={{ flex: 1 }}><Lbl>Phone</Lbl><input value={c.phone} onChange={e => updateNewContact(i, "phone", e.target.value)} placeholder="(555) 555-5555" style={inpSm} /></div>
              <div style={{ flex: 1 }}><Lbl>Email</Lbl><input value={c.email} onChange={e => updateNewContact(i, "email", e.target.value)} placeholder="email@co.com" style={inpSm} /></div>
              {newContacts.length > 1 && <button type="button" onClick={() => removeNewContact(i)} style={{ all: "unset", fontSize: 10, color: "#DC2626", cursor: "pointer", paddingBottom: 8 }}>×</button>}
            </div>
          ))}
          <button type="button" onClick={addNewContact} style={{ all: "unset", fontSize: 11, fontWeight: 600, color: T, cursor: "pointer", marginBottom: 8, display: "block" }}>+ Add contact</button>

          <Lbl>Services They Provide</Lbl>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {SVC_OPTIONS.map(svc => {
              const on = newSvcs.includes(svc)
              return (
                <button
                  key={svc}
                  type="button"
                  onClick={() => setNewSvcs(on ? newSvcs.filter(x => x !== svc) : [...newSvcs, svc])}
                  style={{ all: "unset", padding: "4px 10px", borderRadius: 14, fontSize: 11, fontWeight: on ? 600 : 500, cursor: "pointer", border: on ? `2px solid ${T}` : "1px solid #E2E8F0", color: on ? T : "#64748B", background: on ? "#F0FDFA" : "transparent" }}
                >
                  {svc}
                </button>
              )
            })}
          </div>
          <Lbl>Notes</Lbl>
          <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Payment preferences, scheduling notes..." style={{ ...inp, marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={addVendor}
              disabled={!newName.trim() || busy}
              style={{ all: "unset", padding: "8px 20px", borderRadius: 7, fontSize: 13, fontWeight: 700, background: newName.trim() ? T : "#E2E8F0", color: newName.trim() ? "#fff" : "#94A3B8", cursor: newName.trim() && !busy ? "pointer" : "default" }}
            >
              Add Vendor
            </button>
          </div>
        </div>
      )}

      {/* Vendor List */}
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <colgroup>
            <col />
            <col style={{ width: 160 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 30 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>Vendor</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Services</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Unpaid</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Owed</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(v => {
              const jobs = toJobs(v)
              const vOwed = v.owedAmount
              const uCount = v.unpaidAddOns
              const isOpen = expanded === v.id
              const unpaidJobs = jobs.filter(j => !j.paid)
              const paidJobs = jobs.filter(j => j.paid)
              const isEditing = editingVendor === v.id
              const ef = editForm
              const contacts = isEditing ? ef.contacts : v.contacts
              const notes = isEditing ? ef.notes : v.notes
              const zelle = isEditing ? ef.zelle : v.zelle
              const svcs = isEditing ? ef.services : v.services

              return (
                <Fragment key={v.id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : v.id)}
                    style={{ borderBottom: isOpen ? "none" : "1px solid #F1F5F9", cursor: "pointer", background: isOpen ? "#FAFBFC" : "transparent", transition: "background 0.06s" }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#FAFBFC" }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = "transparent" }}
                  >
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: vOwed > 0 ? "#FEF2F2" : "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: vOwed > 0 ? "#DC2626" : T, flexShrink: 0 }}>
                          {initials(v.name)}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>{v.name}</div>
                          {v.contacts[0]?.phone && (
                            <div style={{ fontSize: 11, color: "#94A3B8" }}>
                              {v.contacts[0].name ? v.contacts[0].name + " · " : ""}{v.contacts[0].phone}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", gap: 3, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {v.services.map(s => <span key={s} style={{ fontSize: 9.5, fontWeight: 500, padding: "2px 7px", borderRadius: 8, background: "#F1F5F9", color: "#64748B" }}>{s}</span>)}
                      </div>
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "center", verticalAlign: "middle" }}>
                      {uCount > 0
                        ? <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", background: "#FEF2F2", padding: "3px 10px", borderRadius: 10 }}>{uCount} job{uCount > 1 ? "s" : ""}</span>
                        : <span style={{ fontSize: 11, color: "#16A34A", fontWeight: 500 }}>✓ Paid up</span>}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", verticalAlign: "middle" }}>
                      <span style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: vOwed > 0 ? "#DC2626" : "#CBD5E1" }}>${vOwed > 0 ? Math.round(vOwed).toLocaleString() : "0"}</span>
                    </td>
                    <td style={{ padding: "14px 8px", verticalAlign: "middle" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" style={{ transition: "transform 0.12s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                        <path d="M3 4.5L6 7.5 9 4.5" />
                      </svg>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan={5} style={{ padding: "0 20px 16px 62px", background: "#FAFBFC", borderBottom: "1px solid #F1F5F9" }}>
                        <div style={{ animation: "fi 0.12s ease" }}>
                          {/* Contacts */}
                          <div style={{ marginBottom: 8 }}>
                            {contacts.map((c, ci) => (
                              <div key={ci} style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "flex-end" }}>
                                <div style={{ flex: 1 }}>
                                  <Lbl>{contacts.length > 1 ? `Contact ${ci + 1}` : "Contact"}</Lbl>
                                  {isEditing ? <input value={c.name} onChange={e => editContact(ci, "name", e.target.value)} placeholder="First Last" style={inpSm} /> : <div style={vf}>{c.name || "—"}</div>}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <Lbl>Phone</Lbl>
                                  {isEditing ? <input value={c.phone} onChange={e => editContact(ci, "phone", e.target.value)} placeholder="(555) 555-5555" style={inpSm} /> : <div style={vf}>{c.phone || "—"}</div>}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <Lbl>Email</Lbl>
                                  {isEditing ? <input value={c.email} onChange={e => editContact(ci, "email", e.target.value)} placeholder="email@co.com" style={inpSm} /> : <div style={vf}>{c.email || "—"}</div>}
                                </div>
                                {isEditing && contacts.length > 1 && <button type="button" onClick={e => { e.stopPropagation(); removeEditContact(ci) }} style={{ all: "unset", fontSize: 10, color: "#DC2626", cursor: "pointer", paddingBottom: 8 }}>×</button>}
                              </div>
                            ))}
                            {contacts.length === 0 && !isEditing && <div style={{ ...vf, color: "#CBD5E1" }}>No contacts</div>}
                            {isEditing && <button type="button" onClick={e => { e.stopPropagation(); addEditContact() }} style={{ all: "unset", fontSize: 11, fontWeight: 600, color: T, cursor: "pointer", display: "block", marginTop: 2 }}>+ Add contact</button>}
                          </div>

                          {/* Zelle */}
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 8 }}>
                            <div style={{ minWidth: 280 }}>
                              <Lbl>Zelle Email</Lbl>
                              {isEditing
                                ? <input value={ef.zelle} onChange={e => setEditForm(f => ({ ...f, zelle: e.target.value }))} placeholder="zelle@email.com" style={inpSm} />
                                : <div style={vf}>{zelle || "—"}</div>}
                            </div>
                            {!isEditing && zelle && (
                              <button type="button" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(zelle); flash("Copied — open Zelle to pay") }} style={{ all: "unset", padding: "5px 12px", borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: T, color: "#fff", cursor: "pointer", marginBottom: 1 }}>Copy</button>
                            )}
                          </div>

                          {/* Services */}
                          <div style={{ marginBottom: 8 }}>
                            <Lbl>Services</Lbl>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                              {isEditing
                                ? SVC_OPTIONS.map(svc => {
                                    const on = svcs.includes(svc)
                                    return <button key={svc} type="button" onClick={e => { e.stopPropagation(); toggleEditSvc(svc) }} style={{ all: "unset", padding: "3px 8px", borderRadius: 12, fontSize: 10, fontWeight: on ? 600 : 500, cursor: "pointer", border: on ? `2px solid ${T}` : "1px solid #E2E8F0", color: on ? T : "#64748B", background: on ? "#F0FDFA" : "transparent" }}>{svc}</button>
                                  })
                                : svcs.length > 0
                                  ? svcs.map(s => <span key={s} style={{ padding: "3px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, border: `2px solid ${T}`, color: T, background: "#F0FDFA" }}>{s}</span>)
                                  : <span style={{ fontSize: 11, color: "#CBD5E1" }}>None specified</span>}
                            </div>
                          </div>

                          {/* Notes */}
                          <div style={{ marginBottom: 10 }}>
                            <Lbl>Notes</Lbl>
                            {isEditing
                              ? <textarea value={ef.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Payment preferences, scheduling notes..." style={{ width: "100%", maxWidth: 400, padding: "6px 8px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, outline: "none", resize: "none", fontFamily: "inherit", color: "#0F172A" }} />
                              : notes
                                ? <div style={{ padding: "6px 8px", background: "#FFFBEB", borderRadius: 6, fontSize: 12, color: "#92400E", lineHeight: 1.4, border: "1px solid #FEF3C7", maxWidth: 400 }}>{notes}</div>
                                : <div style={{ ...vf, maxWidth: 400, color: "#CBD5E1" }}>No notes</div>}
                          </div>

                          {/* Edit / Save / Archive */}
                          <div style={{ display: "flex", gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #E2E8F0" }}>
                            {isEditing ? (
                              <>
                                <button type="button" onClick={e => { e.stopPropagation(); saveEdit(v.id) }} disabled={busy} style={{ all: "unset", padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: T, color: "#fff", cursor: "pointer" }}>Save</button>
                                <button type="button" onClick={e => { e.stopPropagation(); setEditingVendor(null) }} style={{ all: "unset", padding: "6px 16px", borderRadius: 6, fontSize: 12, color: "#94A3B8", cursor: "pointer" }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={e => { e.stopPropagation(); startEdit(v) }} style={{ all: "unset", fontSize: 11, fontWeight: 500, color: T, cursor: "pointer" }}>Edit</button>
                                <button type="button" onClick={e => { e.stopPropagation(); archiveVendor(v.id) }} style={{ all: "unset", fontSize: 11, fontWeight: 500, color: "#DC2626", cursor: "pointer" }}>Archive</button>
                              </>
                            )}
                          </div>

                          {/* Unpaid jobs */}
                          {unpaidJobs.length > 0 && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Unpaid ({unpaidJobs.length})</div>
                              {unpaidJobs.map(j => (
                                <div key={j.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#FEF2F2", borderRadius: 6, marginBottom: 3, borderLeft: "3px solid #FECACA" }}>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{j.client}</div>
                                    <div style={{ fontSize: 11, color: "#94A3B8" }}>{j.service} · {j.date}</div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: "#DC2626" }}>${Math.round(j.amount).toLocaleString()}</span>
                                    <button type="button" onClick={e => { e.stopPropagation(); markPaid(v.id, j.id) }} disabled={busy} style={{ all: "unset", padding: "5px 12px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "#0F172A", color: "#fff", cursor: "pointer" }}>Mark Paid</button>
                                  </div>
                                </div>
                              ))}
                              {unpaidJobs.length > 1 && (
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                                  <button type="button" onClick={e => { e.stopPropagation(); payAll(v.id, unpaidJobs.map(j => j.id)) }} disabled={busy} style={{ all: "unset", padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: T, color: "#fff", cursor: "pointer" }}>
                                    Pay All — ${Math.round(vOwed).toLocaleString()}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {unpaidJobs.length === 0 && !isEditing && (
                            <div style={{ fontSize: 12, color: "#16A34A", fontWeight: 500, marginBottom: 10 }}>✓ No outstanding payments</div>
                          )}

                          {/* Job history */}
                          {paidJobs.length > 0 && (
                            <div>
                              <button type="button" onClick={e => { e.stopPropagation(); setShowPaid(showPaid === v.id ? null : v.id) }} style={{ all: "unset", fontSize: 11, fontWeight: 500, color: "#94A3B8", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" style={{ transition: "transform 0.12s", transform: showPaid === v.id ? "rotate(90deg)" : "rotate(0deg)" }}>
                                  <path d="M3 1.5L7 5 3 8.5" />
                                </svg>
                                Job history ({paidJobs.length})
                              </button>
                              {showPaid === v.id && (
                                <div style={{ marginTop: 6, animation: "fi 0.1s ease" }}>
                                  {paidJobs.map((j, ji) => (
                                    <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderRadius: 5, background: ji % 2 === 0 ? "#fff" : "transparent" }}>
                                      <div>
                                        <span style={{ fontSize: 12, fontWeight: 500, color: "#0F172A" }}>{j.client}</span>
                                        <span style={{ fontSize: 10.5, color: "#94A3B8", marginLeft: 6 }}>{j.service}</span>
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <span style={{ fontSize: 10.5, color: "#94A3B8" }}>{j.date}</span>
                                        {j.paidDate && <span style={{ fontSize: 10, color: "#CBD5E1" }}>Paid {j.paidDate}</span>}
                                        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 12, color: "#16A34A" }}>${Math.round(j.amount).toLocaleString()}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>

        {isLoading && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "#94A3B8" }}>Loading vendors…</div>
        )}
        {error && !isLoading && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "#DC2626" }}>Failed to load vendors. Please refresh.</div>
        )}
        {!isLoading && !error && sorted.length === 0 && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: "#94A3B8" }}>
            {search ? "No vendors match your search" : "No vendors yet — add one to get started"}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#0F172A", color: "#fff", padding: "8px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 500, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", animation: "ti 0.15s ease", zIndex: 200, whiteSpace: "nowrap" }}>{"✓ " + toast}</div>
      )}
    </div>
  )
}
