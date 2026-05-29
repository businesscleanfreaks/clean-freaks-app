"use client"

import { useState } from "react"
import { format } from "date-fns"
import { showError, showApiError } from "@/lib/toast"

export const NOTE_CATEGORIES = [
  "General",
  "Scheduling",
  "Billing",
  "Access",
  "Complaint",
  "Cleaner Note",
  "Client Preference",
]

export interface ClientNote {
  id: string
  text: string
  category: string
  author: string | null
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

// Warm-gray "calm authority" tokens (match client_cockpit.jsx)
const TL = "#0D9488"
const INK = "#18181B"
const INK3 = "#A1A1AA"
const RULE = "#E4E4E7"
const RULE2 = "#F4F4F5"

function noteDate(iso: string) {
  try {
    return format(new Date(iso), "MMM d")
  } catch {
    return ""
  }
}

// ── Right-rail Notes panel with full CRUD ──
export function ClientNotesPanel({
  clientId,
  notes,
  onChange,
}: {
  clientId: string
  notes: ClientNote[]
  onChange: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draftText, setDraftText] = useState("")
  const [draftCat, setDraftCat] = useState("General")
  const [busy, setBusy] = useState(false)

  const sorted = [...notes].sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))

  const addNote = async () => {
    if (!draftText.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draftText.trim(), category: draftCat }),
      })
      if (!res.ok) { await showApiError(res, "Failed to add note"); return }
      setDraftText(""); setDraftCat("General"); setAdding(false)
      onChange()
    } catch { showError("Failed to add note") } finally { setBusy(false) }
  }

  const patchNote = async (id: string, body: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) { await showApiError(res, "Failed to update note"); return }
      onChange()
    } catch { showError("Failed to update note") } finally { setBusy(false) }
  }

  const deleteNote = async (id: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/notes/${id}`, { method: "DELETE" })
      if (!res.ok) { await showApiError(res, "Failed to delete note"); return }
      onChange()
    } catch { showError("Failed to delete note") } finally { setBusy(false) }
  }

  return (
    <div style={{ background: "#fff", border: `1px solid ${RULE}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: INK3, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Notes <span style={{ fontWeight: 400 }}>{notes.length}</span>
        </span>
        <button type="button" onClick={() => setAdding(a => !a)} style={{ all: "unset", fontSize: 11, fontWeight: 600, color: TL, cursor: "pointer" }}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${RULE2}` }}>
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            autoFocus
            placeholder="What should the team know?"
            rows={2}
            style={{ width: "100%", border: `1px solid ${RULE}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", resize: "vertical", minHeight: 40, outline: "none", color: INK, lineHeight: 1.4 }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", justifyContent: "space-between" }}>
            <select value={draftCat} onChange={e => setDraftCat(e.target.value)} style={{ fontSize: 11, padding: "4px 6px", border: `1px solid ${RULE}`, borderRadius: 5, outline: "none", color: INK, background: "#fff" }}>
              {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={addNote} disabled={!draftText.trim() || busy} style={{ all: "unset", fontSize: 11, fontWeight: 600, padding: "5px 14px", borderRadius: 5, background: draftText.trim() ? TL : "#E2E8F0", color: draftText.trim() ? "#fff" : "#94A3B8", cursor: draftText.trim() && !busy ? "pointer" : "default" }}>
              Save
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: INK3, padding: "8px 0" }}>No notes yet. Add the first thing the team should know.</div>
      )}

      {sorted.map(n => (
        <NoteRow key={n.id} note={n} busy={busy} onTogglePin={() => patchNote(n.id, { isPinned: !n.isPinned })} onSaveText={(text) => patchNote(n.id, { text })} onDelete={() => deleteNote(n.id)} />
      ))}
    </div>
  )
}

function NoteRow({
  note,
  busy,
  onTogglePin,
  onSaveText,
  onDelete,
}: {
  note: ClientNote
  busy: boolean
  onTogglePin: () => void
  onSaveText: (text: string) => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: "8px 0", borderBottom: `1px solid ${RULE2}` }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2, gap: 8 }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center", minWidth: 0 }}>
          {note.isPinned && <span style={{ fontSize: 9, color: "#D97706" }}>📌</span>}
          <span style={{ fontSize: 10, color: "#D4D4D8", whiteSpace: "nowrap" }}>{noteDate(note.createdAt)}{note.author ? ` · ${note.author}` : ""}</span>
          <span style={{ fontSize: 9, padding: "0 5px", borderRadius: 4, background: RULE2, color: INK3, whiteSpace: "nowrap" }}>{note.category}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, opacity: hovered || editing ? 1 : 0, transition: "opacity 0.1s" }}>
          {!editing && <NBtn onClick={onTogglePin} disabled={busy}>{note.isPinned ? "Unpin" : "Pin"}</NBtn>}
          {!editing && <NBtn onClick={() => { setDraft(note.text); setEditing(true) }} color={TL}>Edit</NBtn>}
          {!editing && <NBtn onClick={onDelete} color="#DC2626" disabled={busy}>Del</NBtn>}
        </div>
      </div>
      {editing ? (
        <div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={2} style={{ width: "100%", border: `1px solid ${TL}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", resize: "vertical", minHeight: 36, outline: "none", color: INK, lineHeight: 1.4 }} />
          <div style={{ display: "flex", gap: 6, marginTop: 3, justifyContent: "flex-end" }}>
            <NBtn onClick={() => { setEditing(false); setDraft(note.text) }}>Cancel</NBtn>
            <button type="button" onClick={() => { onSaveText(draft.trim() || note.text); setEditing(false) }} disabled={busy} style={{ all: "unset", fontSize: 10, padding: "2px 10px", borderRadius: 4, background: TL, color: "#fff", fontWeight: 600, cursor: "pointer" }}>Save</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: INK, lineHeight: 1.5 }}>{note.text}</div>
      )}
    </div>
  )
}

function NBtn({ children, onClick, color, disabled }: { children: React.ReactNode; onClick: () => void; color?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ all: "unset", fontSize: 10, fontWeight: 500, color: color || INK3, cursor: disabled ? "default" : "pointer" }}>
      {children}
    </button>
  )
}

// ── "Open Issues" amber editor (lives in the snapshot card) ──
export function OpenIssuesEditor({ clientId, initial }: { clientId: string; initial: string[] }) {
  const [issues, setIssues] = useState<string[]>(initial)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  const persist = async (next: string[]) => {
    setBusy(true)
    const prev = issues
    setIssues(next) // optimistic
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openIssues: next }),
      })
      if (!res.ok) { setIssues(prev); await showApiError(res, "Failed to save issue") }
    } catch { setIssues(prev); showError("Failed to save issue") } finally { setBusy(false) }
  }

  const add = () => {
    const v = draft.trim()
    if (!v) { setAdding(false); return }
    persist([...issues, v]); setDraft(""); setAdding(false)
  }
  const remove = (i: number) => persist(issues.filter((_, idx) => idx !== i))

  const show = issues.length > 0 || adding
  if (!show) {
    return (
      <div style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setAdding(true)} style={{ all: "unset", fontSize: 11, fontWeight: 600, color: "#D97706", cursor: "pointer" }}>+ Flag an open issue</button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12, padding: "8px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: "0.04em" }}>Open Issues</div>
        {!adding && <button type="button" onClick={() => setAdding(true)} style={{ all: "unset", fontSize: 10, fontWeight: 600, color: "#D97706", cursor: "pointer" }}>+ Add</button>}
      </div>
      {issues.map((issue, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 12, color: INK, lineHeight: 1.4 }}>
          <span>• {issue}</span>
          <button type="button" onClick={() => remove(i)} disabled={busy} style={{ all: "unset", fontSize: 11, color: "#DC2626", cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>
      ))}
      {adding && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") add() }}
            autoFocus
            placeholder="Describe the issue…"
            style={{ flex: 1, border: "1px solid #FDE68A", borderRadius: 5, padding: "4px 8px", fontSize: 12, outline: "none", color: INK, background: "#fff" }}
          />
          <button type="button" onClick={add} disabled={busy} style={{ all: "unset", fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 5, background: "#D97706", color: "#fff", cursor: "pointer" }}>Add</button>
        </div>
      )}
    </div>
  )
}

// ── "What to Know" pinned-notes display (lives in the snapshot card) ──
export function WhatToKnow({ pinned }: { pinned: ClientNote[] }) {
  if (pinned.length === 0) return null
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${RULE}`, paddingTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: INK3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>What to Know</div>
      {pinned.map(n => (
        <div key={n.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: INK, lineHeight: 1.4, marginBottom: 4, padding: "4px 8px", borderRadius: 4, background: RULE2 }}>
          <span style={{ flexShrink: 0, fontSize: 10, marginTop: 1 }}>📌</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  )
}
