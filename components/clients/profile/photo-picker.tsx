"use client"

import { useEffect, useRef, useState } from "react"
import { shrinkPhoto } from "@/lib/photo-shrink"
import { photoUploadProblem } from "@/lib/photos"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { C, Modal } from "./ui"

/**
 * The photo picker from Client Profile Main.dc.html, for the client photo and
 * each location's photo. Nothing is saved until Save.
 *
 *   - Client photo: upload, remove, or "Or use a location photo".
 *   - Location photo: upload or remove, and "Also use as the client photo".
 */

export interface PhotoTarget {
  owner: "client" | "location"
  id: string
  name: string
  /** The photo it has now, or null. */
  url: string | null
}

type Draft =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "file"; file: File; preview: string }
  | { kind: "location"; locationId: string; preview: string }

/** Send a picture to /api/photos, shrunk first. Throws with the reason on failure. */
export async function uploadPhoto(owner: "client" | "location" | "contact", id: string, file: File, extra?: Record<string, string>) {
  const blob = await shrinkPhoto(file)
  const problem = photoUploadProblem({ size: blob.size, type: blob.type })
  if (problem) throw new Error(problem)
  const fd = new FormData()
  fd.append("file", blob, blob === file ? file.name : "photo.jpg")
  for (const [key, value] of Object.entries(extra ?? {})) fd.append(key, value)
  const res = await fetch(`/api/photos/${owner}/${id}`, { method: "POST", body: fd })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Couldn't save the photo")
}

export async function removePhoto(owner: "client" | "location" | "contact", id: string) {
  const res = await fetch(`/api/photos/${owner}/${id}`, { method: "DELETE" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Couldn't remove the photo")
}

/** A file the user picked or dropped, if it is an image at all. */
export function pickedImage(files: FileList | null | undefined): File | null {
  const file = files?.[0]
  if (!file) return null
  if (!file.type.startsWith("image/")) {
    showError("Pick an image file.")
    return null
  }
  return file
}

export function PhotoPicker({
  clientId,
  target,
  locationPhotos = [],
  onClose,
  onSaved,
}: {
  clientId: string
  target: PhotoTarget
  /** For the client photo: locations that have a photo to reuse. */
  locationPhotos?: Array<{ id: string; name: string; url: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>({ kind: "keep" })
  const [alsoClient, setAlsoClient] = useState(false)
  const [saving, setSaving] = useState(false)
  const preview = useRef<string | null>(null)

  // Object URLs for picked files are freed when replaced and on close.
  useEffect(() => () => { if (preview.current) URL.revokeObjectURL(preview.current) }, [])

  const pickFile = (files: FileList | null) => {
    const file = pickedImage(files)
    if (!file) return
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = URL.createObjectURL(file)
    setDraft({ kind: "file", file, preview: preview.current })
  }

  const shown =
    draft.kind === "file" || draft.kind === "location" ? draft.preview
      : draft.kind === "remove" ? null
        : target.url
  const isClient = target.owner === "client"

  const save = async () => {
    const copyToClient = !isClient && alsoClient
    if (draft.kind === "keep" && !(copyToClient && target.url)) {
      onClose()
      return
    }
    setSaving(true)
    try {
      if (draft.kind === "file") {
        await uploadPhoto(target.owner, target.id, draft.file, copyToClient ? { alsoClient: "1" } : undefined)
      } else if (draft.kind === "remove") {
        await removePhoto(target.owner, target.id)
      } else {
        // Reusing a location photo as the client photo: picked from the client
        // picker, or "Also use as the client photo" on a location that has one.
        const fromLocation = draft.kind === "location" ? draft.locationId : target.id
        const res = await fetch(`/api/photos/client/${clientId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromLocation }),
        })
        if (!res.ok) {
          await showApiError(res, "Couldn't save the photo")
          return
        }
      }
      showSuccess(draft.kind === "remove" ? "Photo removed" : "Photo saved")
      onSaved()
      onClose()
    } catch (err) {
      showError(err instanceof Error ? err.message : "Couldn't save the photo")
    } finally {
      setSaving(false)
    }
  }

  const uploadLabel: React.CSSProperties = { cursor: "pointer", position: "relative" }
  const hiddenInput: React.CSSProperties = { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }

  return (
    <Modal
      title={isClient ? "Client photo" : `Photo · ${target.name}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="cfp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cfp-btn primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: -6, marginBottom: 14 }}>
        {isClient ? "Shows on the client list and at the top of this page." : "Shows on this location card."}
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <label
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files) }}
          style={{
            position: "relative", width: 120, height: 120, borderRadius: 14, flex: "none",
            background: "#f3f0e9", backgroundImage: shown ? `url("${shown}")` : "none", backgroundSize: "cover", backgroundPosition: "center",
            border: `2px dashed ${shown ? "transparent" : "#d9d2c3"}`,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            color: C.muted, fontSize: 12, fontWeight: 700, textAlign: "center", overflow: "hidden",
          }}
        >
          {!shown && <span style={{ padding: "0 10px" }}>Drop or click to upload</span>}
          <input type="file" accept="image/*" onChange={e => { pickFile(e.target.files); e.target.value = "" }} style={hiddenInput} />
        </label>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, fontSize: 12.5, fontWeight: 700, color: C.teal }}>
            <label style={uploadLabel}>
              Upload new
              <input type="file" accept="image/*" onChange={e => { pickFile(e.target.files); e.target.value = "" }} style={hiddenInput} />
            </label>
            {shown && (
              <span onClick={() => setDraft({ kind: "remove" })} style={{ cursor: "pointer", color: C.muted }}>Remove</span>
            )}
          </div>

          {isClient && locationPhotos.length > 0 && (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, marginTop: 14 }}>
                Or use a location photo
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {locationPhotos.map(p => {
                  const picked = draft.kind === "location" && draft.locationId === p.id
                  return (
                    <div key={p.id} onClick={() => setDraft({ kind: "location", locationId: p.id, preview: p.url })} title={p.name} style={{ width: 64, textAlign: "center", cursor: "pointer" }}>
                      <div style={{ width: 64, height: 64, borderRadius: 10, background: "#e9e4d8", backgroundImage: `url("${p.url}")`, backgroundSize: "cover", backgroundPosition: "center", border: `2px solid ${picked ? C.primary : "transparent"}` }} />
                      <div style={{ fontSize: 10.5, color: C.sub, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!isClient && shown && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12.5, color: C.sub, marginTop: 14 }}>
              <input type="checkbox" checked={alsoClient} onChange={() => setAlsoClient(v => !v)} style={{ width: 15, height: 15, accentColor: C.primary }} />
              Also use as the client photo
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}
