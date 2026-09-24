"use client"

import { useState } from "react"
import useSWR from "swr"
import { CONTACT_ROLES } from "@/lib/new-client"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { AddButton, C, Card, Field, Modal, initialsOf } from "./ui"

/**
 * Contacts and Notes (Client Profile Main.dc.html): the answer-card contacts
 * list with its editor, and the client-relationship notes with pinning.
 */

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error("failed"))))

export interface ProfileContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  billingRole: string | null
  isPrimary: boolean
}

interface RecipientsResponse {
  recipients: Array<{ email: string; contactId: string | null; tag: "TO" | "CC" }>
}

export function useContacts(clientId: string) {
  const { data, mutate } = useSWR<{ contacts: ProfileContact[] }>(`/api/clients/${clientId}/contacts`, fetcher, { revalidateOnFocus: false })
  return { contacts: data?.contacts ?? [], loaded: !!data, reload: () => mutate() }
}

export function ContactsCard({
  clientId,
  onChanged,
}: {
  clientId: string
  onChanged?: () => void
}) {
  const { contacts, loaded, reload } = useContacts(clientId)
  const { data: recips } = useSWR<RecipientsResponse>(`/api/clients/${clientId}/billing-recipients`, fetcher, { revalidateOnFocus: false })
  const onInvoice = new Set((recips?.recipients ?? []).map(r => r.email.toLowerCase()))
  const [editor, setEditor] = useState<ProfileContact | "new" | null>(null)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? contacts : contacts.slice(0, 3)

  return (
    <Card
      title="Contacts"
      style={{ flex: "1 1 260px" }}
      action={<AddButton small label="Add Contact" onClick={() => setEditor("new")} />}
    >
      <div style={{ padding: "0 16px 8px" }}>
        {shown.map((c, i) => {
          const gets = !!c.email && onInvoice.has(c.email.toLowerCase())
          const role = [c.billingRole, gets ? "invoices" : null].filter(Boolean).join(" · ")
          return (
            <div
              key={c.id}
              className="cfp-row"
              onClick={() => setEditor(c)}
              title="Edit contact"
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 4px", margin: "0 -4px", borderTop: `1px solid ${i === 0 ? "transparent" : C.hair}`, minWidth: 0 }}
            >
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: c.isPrimary ? C.primary : "#64748b", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                {initialsOf(c.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{role}</span>
                </div>
                {(c.phone || c.email) && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {c.phone || c.email}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {contacts.length > 3 && (
          <div onClick={() => setShowAll(s => !s)} style={{ fontSize: 11.5, fontWeight: 700, color: C.teal, padding: "8px 0 4px", borderTop: `1px solid ${C.hair}`, cursor: "pointer" }}>
            {showAll ? "Show fewer" : `+ ${contacts.length - 3} more`}
          </div>
        )}
        {loaded && contacts.length === 0 && (
          <div style={{ fontSize: 12.5, color: C.muted, padding: "10px 0 6px" }}>No contact on file yet.</div>
        )}
      </div>

      {editor && (
        <ContactEditor
          clientId={clientId}
          contact={editor === "new" ? null : editor}
          isFirst={contacts.length === 0}
          onClose={() => setEditor(null)}
          onSaved={() => { reload(); onChanged?.() }}
        />
      )}
    </Card>
  )
}

const OTHER = "__other"

export function ContactEditor({
  clientId,
  contact,
  isFirst,
  onClose,
  onSaved,
}: {
  clientId: string
  contact: ProfileContact | null
  isFirst: boolean
  onClose: () => void
  onSaved: (contact: ProfileContact) => void
}) {
  const presetRole = (CONTACT_ROLES as readonly string[]).includes(contact?.billingRole ?? "")
  const [name, setName] = useState(contact?.name ?? "")
  // A contact saved without a title stays without one until someone picks it:
  // editing a phone number must not quietly make them the owner.
  const [roleChoice, setRoleChoice] = useState(contact ? (presetRole ? contact.billingRole! : contact.billingRole ? OTHER : "") : "Owner")
  const [roleText, setRoleText] = useState(contact && !presetRole ? contact.billingRole ?? "" : "")
  const [email, setEmail] = useState(contact?.email ?? "")
  const [phone, setPhone] = useState(contact?.phone ?? "")
  const [isPrimary, setIsPrimary] = useState(contact ? contact.isPrimary : isFirst)
  const [saving, setSaving] = useState(false)
  const emailBad = !!email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSave = !!name.trim() && !emailBad && !saving

  const save = async () => {
    if (!canSave) return
    const title = roleChoice === OTHER ? roleText.trim() : roleChoice
    const role = title === "Owner" ? "OWNER" : contact?.role && contact.role !== "OWNER" ? contact.role : "GENERAL"
    setSaving(true)
    try {
      const res = await fetch(contact ? `/api/clients/${clientId}/contacts/${contact.id}` : `/api/clients/${clientId}/contacts`, {
        method: contact ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, billingRole: title || null, role, isPrimary }),
      })
      if (!res.ok) {
        await showApiError(res, "Couldn't save the contact")
        return
      }
      const body = await res.json()
      showSuccess(contact ? "Contact saved" : "Contact added")
      onSaved(body.contact)
      onClose()
    } catch {
      showError("Couldn't save the contact")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!contact || !window.confirm(`Remove ${contact.name} from this client's contacts?`)) return
    const res = await fetch(`/api/clients/${clientId}/contacts/${contact.id}`, { method: "DELETE" })
    if (!res.ok) {
      await showApiError(res, "Couldn't remove the contact")
      return
    }
    showSuccess("Contact removed")
    onSaved(contact)
    onClose()
  }

  return (
    <Modal
      title={contact ? "Edit contact" : "Add contact"}
      onClose={onClose}
      footer={
        <>
          {contact && <button className="cfp-btn danger" style={{ marginRight: "auto" }} onClick={remove}>Remove</button>}
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name">
          <input autoFocus className="cfp-input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Role">
          <div style={{ display: "grid", gridTemplateColumns: roleChoice === OTHER ? "1fr 1fr" : "1fr", gap: 10 }}>
            <select className="cfp-input" value={roleChoice} onChange={e => setRoleChoice(e.target.value)}>
              {roleChoice === "" && <option value="">No role set</option>}
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              <option value={OTHER}>Other role…</option>
            </select>
            {roleChoice === OTHER && (
              <input autoFocus className="cfp-input" value={roleText} onChange={e => setRoleText(e.target.value)} placeholder="Their role · e.g. Regional Manager" />
            )}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Email">
            <input className="cfp-input" type="email" value={email} onChange={e => setEmail(e.target.value)} style={emailBad ? { borderColor: "#dc2626" } : undefined} />
          </Field>
          <Field label="Phone">
            <input className="cfp-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          </Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: C.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={isPrimary} onChange={() => setIsPrimary(p => !p)} style={{ width: 15, height: 15, accentColor: C.primary }} />
          Primary contact
        </label>
      </div>
    </Modal>
  )
}

// ── Notes ──────────────────────────────────────────────────────────────────

interface ProfileNote {
  id: string
  text: string
  isPinned: boolean
  createdAt: string
}

export function NotesCard({ clientId, legacyNote }: { clientId: string; legacyNote: string | null }) {
  const { data, mutate } = useSWR<ProfileNote[]>(`/api/clients/${clientId}/notes`, fetcher, { revalidateOnFocus: false })
  const notes = [...(data ?? [])].sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
  const [editor, setEditor] = useState<ProfileNote | "new" | null>(null)

  const togglePin = async (note: ProfileNote) => {
    const res = await fetch(`/api/clients/${clientId}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !note.isPinned }),
    })
    if (!res.ok) return showApiError(res, "Couldn't update the note")
    mutate()
  }

  return (
    <Card title="Notes" action={<AddButton small label="Add Note" onClick={() => setEditor("new")} />}>
      <div style={{ padding: "0 16px 8px" }}>
        {notes.map((n, i) => (
          <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 0", borderTop: `1px solid ${i === 0 ? "transparent" : C.hair}` }}>
            <span style={{ marginTop: 1, flex: "none", width: 12, textAlign: "center", fontSize: 12, lineHeight: 1.45, color: n.isPinned ? "#e0a83a" : "#d6cfc0" }}>{n.isPinned ? "★" : "•"}</span>
            <div onClick={() => setEditor(n)} style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, cursor: "pointer", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{n.text}</div>
            <span onClick={() => togglePin(n)} style={{ flex: "none", cursor: "pointer", color: "#cfc8ba", fontSize: 10.5, fontWeight: 700 }}>{n.isPinned ? "Unpin" : "Pin"}</span>
          </div>
        ))}
        {legacyNote && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 0", borderTop: `1px solid ${notes.length ? C.hair : "transparent"}` }}>
            <span style={{ marginTop: 1, flex: "none", width: 12, textAlign: "center", fontSize: 12, color: "#d6cfc0" }}>•</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{legacyNote}</div>
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>From the client record</div>
            </div>
          </div>
        )}
        {data && notes.length === 0 && !legacyNote && (
          <div style={{ fontSize: 12, color: "#bdb7ab", padding: "9px 0 2px" }}>No notes yet.</div>
        )}
      </div>
      {editor && (
        <NoteEditor clientId={clientId} note={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => mutate()} />
      )}
    </Card>
  )
}

function NoteEditor({ clientId, note, onClose, onSaved }: { clientId: string; note: ProfileNote | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(note?.text ?? "")
  const [pinned, setPinned] = useState(note?.isPinned ?? false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      const res = await fetch(note ? `/api/clients/${clientId}/notes/${note.id}` : `/api/clients/${clientId}/notes`, {
        method: note ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), isPinned: pinned }),
      })
      if (!res.ok) {
        await showApiError(res, "Couldn't save the note")
        return
      }
      onSaved()
      onClose()
    } catch {
      showError("Couldn't save the note")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!note || !window.confirm("Delete this note?")) return
    const res = await fetch(`/api/clients/${clientId}/notes/${note.id}`, { method: "DELETE" })
    if (!res.ok) return showApiError(res, "Couldn't delete the note")
    onSaved()
    onClose()
  }

  return (
    <Modal
      title={note ? "Edit note" : "Add note"}
      onClose={onClose}
      footer={
        <>
          {note && <button className="cfp-btn danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={!text.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>About the client. Door codes and parking go on the location.</div>
      <textarea autoFocus className="cfp-input" rows={4} value={text} onChange={e => setText(e.target.value)} style={{ resize: "vertical", lineHeight: 1.45 }} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, fontWeight: 600, color: C.sub, cursor: "pointer" }}>
        <input type="checkbox" checked={pinned} onChange={() => setPinned(p => !p)} style={{ width: 15, height: 15, accentColor: C.primary }} />
        Pin to the top
      </label>
    </Modal>
  )
}
