"use client"

import { useState } from "react"
import { AlertTriangle, Check, FileText, Mail, Phone, Plus, Upload, X } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { showError, showSuccess } from "@/lib/toast"
import { CONTACT_ROLES } from "@/lib/combobox"
import { Combobox } from "./combobox"

export interface ProfileContact {
  id: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
}

export interface ProfileTax {
  w9OnFile: boolean
  w9FileName: string | null
  w9UploadedAt: string | null
  legalName: string | null
  taxIdType: string | null
  taxIdLast4: string | null
  paidThisYear: number
  year: number
  over1099Threshold: boolean
  threshold: number
}

const CARD = "rounded-[12px] border border-[#ececea] bg-white"
const SHADOW = { boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }
const LABEL = "text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#7e8489]"
const INPUT =
  "w-full min-w-0 rounded-[7px] border border-[#e2e2df] px-2.5 py-[7px] text-[12.5px] outline-none focus:border-[#0b7a4e]"

/** Who to call, what the tax position is, and anything else worth remembering. */
export function ProfileSidebar({ cleanerId, contacts, tax, notes, email, phone, onChanged }: {
  cleanerId: string
  contacts: ProfileContact[]
  tax: ProfileTax
  notes: string | null
  email: string | null
  phone: string | null
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<ProfileContact>>({})
  const [adding, setAdding] = useState(false)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [taxEditing, setTaxEditing] = useState(false)
  const [taxDraft, setTaxDraft] = useState<Partial<ProfileTax>>({})
  const [uploadingW9, setUploadingW9] = useState(false)

  const uploadW9 = async (file?: File) => {
    if (!file) return
    setUploadingW9(true)
    try {
      const fd = new FormData()
      fd.append("kind", "w9")
      fd.append("file", file)
      const res = await fetch(`/api/cleaners/${cleanerId}/files`, { method: "POST", body: fd })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not upload")
      showSuccess("W-9 uploaded")
      onChanged()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not upload")
    } finally {
      setUploadingW9(false)
    }
  }

  const call = async (url: string, init: RequestInit, ok: string) => {
    try {
      const res = await fetch(url, init)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not save")
      showSuccess(ok)
      onChanged()
      return true
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save")
      return false
    }
  }

  const saveContact = async () => {
    if (!draft.name?.trim()) { showError("A name is required"); return }
    const body = JSON.stringify({
      contactId: editing, name: draft.name, role: draft.role ?? "",
      phone: draft.phone ?? "", email: draft.email ?? "",
    })
    const ok = editing === "new"
      ? await call(`/api/cleaners/${cleanerId}/contacts`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body,
        }, "Contact added")
      : await call(`/api/cleaners/${cleanerId}/contacts`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body,
        }, "Contact updated")
    if (ok) { setEditing(null); setAdding(false); setDraft({}) }
  }

  const saveTax = async () => {
    const ok = await call(`/api/subcontractors/${cleanerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalName: taxDraft.legalName ?? null,
        taxIdType: taxDraft.taxIdType || null,
        taxIdLast4: taxDraft.taxIdLast4 || null,
        w9OnFile: taxDraft.w9OnFile ?? tax.w9OnFile,
      }),
    }, "Tax details saved")
    if (ok) setTaxEditing(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD} style={SHADOW}>
        <div className="flex items-center gap-2 border-b border-[#f0f0ed] px-4 py-3">
          <span className={LABEL}>Contact</span>
          {!adding && (
            <button
              type="button"
              onClick={() => { setAdding(true); setEditing("new"); setDraft({}) }}
              className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-bold text-[#0b7a4e] hover:underline"
            >
              <Plus size={12} strokeWidth={2.6} /> Add a person
            </button>
          )}
        </div>

        <div className="px-4 py-1">
          {contacts.map(c => (
            <div key={c.id} className="border-b border-[#f6f6f3] py-2.5 last:border-b-0">
              {editing === c.id ? (
                <ContactForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={saveContact}
                  onCancel={() => { setEditing(null); setDraft({}) }}
                  onRemove={async () => {
                    await call(`/api/cleaners/${cleanerId}/contacts?contactId=${c.id}`, { method: "DELETE" }, "Contact removed")
                    setEditing(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditing(c.id); setDraft(c) }}
                  className="w-full rounded-[7px] px-1 py-0.5 text-left hover:bg-[#fafaf8]"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold">{c.name}</span>
                    {c.role && (
                      <span className="text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-[#9aa0a4]">
                        {c.role}
                      </span>
                    )}
                  </span>
                  {c.phone && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[#6b6f73]">
                      <Phone size={10} /> {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span className="mt-px flex items-center gap-1.5 truncate text-[11.5px] text-[#6b6f73]">
                      <Mail size={10} /> {c.email}
                    </span>
                  )}
                </button>
              )}
            </div>
          ))}

          {adding && editing === "new" && (
            <div className="border-b border-[#f6f6f3] py-2.5 last:border-b-0">
              <ContactForm
                draft={draft}
                setDraft={setDraft}
                onSave={saveContact}
                onCancel={() => { setAdding(false); setEditing(null); setDraft({}) }}
              />
            </div>
          )}

          {contacts.length === 0 && !adding && (
            <div className="py-4 text-[12px] text-[#9a9fa4]">No people added yet.</div>
          )}
        </div>

        {(email || phone) && (
          <div className="border-t border-[#f0f0ed] px-4 py-2.5 text-[11.5px] text-[#6b6f73]">
            {email && <div className="truncate">{email}</div>}
            {phone && <div className="mt-px">{phone}</div>}
          </div>
        )}
      </div>

      {/* Tax · the $600 rule is the whole reason this card exists. */}
      <div
        className={CARD}
        style={{ ...SHADOW, ...(tax.over1099Threshold && !tax.w9OnFile ? { borderColor: "#f0e0c0" } : {}) }}
      >
        <div className="flex items-center gap-2 border-b border-[#f0f0ed] px-4 py-3">
          <span className={LABEL}>Tax · W-9 / 1099</span>
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
            style={tax.w9OnFile
              ? { background: "#eaf5ee", color: "#2f6b47" }
              : { background: "#fdf6ea", color: "#8a5e12" }}
          >
            {tax.w9OnFile ? <Check size={11} /> : <AlertTriangle size={11} />}
            {tax.w9OnFile ? "On file" : "1099 required"}
          </span>
        </div>

        <div className="px-4 py-3">
          {/* The document itself. Uploading it IS the confirmation that a W-9
              is on file, so there is no separate checkbox to forget. */}
          {tax.w9OnFile && tax.w9FileName ? (
            <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-[#ececea] bg-[#fafaf8] px-2.5 py-2">
              <FileText size={13} className="flex-none text-[#0b7a4e]" />
              <span className="min-w-0 flex-1">
                <a
                  href={`/api/cleaners/${cleanerId}/files?kind=w9`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[12px] font-bold text-[#3f4347] hover:underline"
                >
                  {tax.w9FileName}
                </a>
                {tax.w9UploadedAt && (
                  <span className="block text-[10.5px] text-[#9a9fa4]">
                    Uploaded {new Date(tax.w9UploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </span>
              <label className="flex-none cursor-pointer text-[11px] font-bold text-[#0b7a4e] hover:underline">
                Replace
                <input type="file" accept="application/pdf,image/*" className="hidden"
                  onChange={e => uploadW9(e.target.files?.[0])} />
              </label>
            </div>
          ) : (
            <label
              className="mb-3 flex cursor-pointer flex-col items-center gap-1 rounded-[9px] border border-dashed px-3 py-4 text-center"
              style={{ borderColor: "#e6cfa5", background: "#fdf9f1" }}
            >
              <Upload size={15} className="text-[#b45309]" />
              <span className="text-[12px] font-bold text-[#8a5e12]">
                {uploadingW9 ? "Uploading…" : "Upload W-9"}
              </span>
              <span className="text-[10.5px] text-[#9a9fa4]">Needed to issue a 1099</span>
              <input type="file" accept="application/pdf,image/*" className="hidden"
                onChange={e => uploadW9(e.target.files?.[0])} />
            </label>
          )}

          {taxEditing ? (
            <div className="flex flex-col gap-2">
              <input
                value={taxDraft.legalName ?? ""}
                onChange={e => setTaxDraft(d => ({ ...d, legalName: e.target.value }))}
                placeholder="Legal name"
                className={INPUT}
              />
              <div className="flex gap-2">
                <select
                  value={taxDraft.taxIdType ?? ""}
                  onChange={e => setTaxDraft(d => ({ ...d, taxIdType: e.target.value }))}
                  className={`${INPUT} flex-none w-[84px]`}
                >
                  <option value="">Type</option>
                  <option value="SSN">SSN</option>
                  <option value="EIN">EIN</option>
                </select>
                <input
                  value={taxDraft.taxIdLast4 ?? ""}
                  onChange={e => setTaxDraft(d => ({ ...d, taxIdLast4: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  placeholder="Last 4"
                  inputMode="numeric"
                  className={`${INPUT} flex-1`}
                />
              </div>
              {/* Said plainly, because someone will wonder where the rest went. */}
              <div className="text-[10.5px] text-[#9a9fa4]">
                Only the last four digits are stored · that is all a 1099 needs.
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={saveTax}
                  className="rounded-[7px] px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: "#0b7a4e" }}>
                  Save
                </button>
                <button type="button" onClick={() => setTaxEditing(false)}
                  className="text-[12px] font-semibold text-[#6b6f73]">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setTaxDraft(tax); setTaxEditing(true) }}
              className="w-full rounded-[7px] text-left hover:bg-[#fafaf8]"
            >
              <div className="text-[12.5px] font-semibold">
                {tax.legalName || <span className="text-[#b6bbc0]">Legal name not set</span>}
              </div>
              <div className="mt-0.5 text-[11.5px] tabular-nums text-[#6b6f73]">
                {tax.taxIdLast4
                  ? `${tax.taxIdType ?? "ID"} ••• •• ${tax.taxIdLast4}`
                  : <span className="text-[#b6bbc0]">No tax ID on file</span>}
              </div>
            </button>
          )}

          <div className="mt-3 border-t border-[#f6f6f3] pt-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] text-[#6b6f73]">{tax.year} paid</span>
              <span className="text-[13px] font-extrabold tabular-nums">{formatCurrency(tax.paidThisYear)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
              <span
                className="h-[6px] w-[6px] flex-none rounded-full"
                style={{ background: tax.over1099Threshold ? "#b45309" : "#c2c5c8" }}
              />
              <span style={{ color: tax.over1099Threshold ? "#b45309" : "#9a9fa4" }}>
                {tax.over1099Threshold
                  ? `Over the ${formatCurrency(tax.threshold)} threshold · 1099 due for ${tax.year}`
                  : `Under the ${formatCurrency(tax.threshold)} 1099 threshold for ${tax.year}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={CARD} style={SHADOW}>
        <div className="border-b border-[#f0f0ed] px-4 py-3">
          <span className={LABEL}>Notes</span>
        </div>
        <div className="px-4 py-3">
          {noteDraft === null ? (
            <button
              type="button"
              onClick={() => setNoteDraft(notes ?? "")}
              className="w-full rounded-[7px] text-left text-[12.5px] leading-[1.55] hover:bg-[#fafaf8]"
            >
              {notes || <span className="text-[#b6bbc0]">Click to add a note</span>}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                rows={4}
                autoFocus
                className={`${INPUT} resize-y leading-[1.5]`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await call(`/api/subcontractors/${cleanerId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ profileNotes: noteDraft.trim() || null }),
                    }, "Note saved")
                    if (ok) setNoteDraft(null)
                  }}
                  className="rounded-[7px] px-3 py-1.5 text-[12px] font-bold text-white"
                  style={{ background: "#0b7a4e" }}
                >
                  Save
                </button>
                <button type="button" onClick={() => setNoteDraft(null)}
                  className="text-[12px] font-semibold text-[#6b6f73]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ContactForm({ draft, setDraft, onSave, onCancel, onRemove }: {
  draft: Partial<ProfileContact>
  setDraft: (fn: (d: Partial<ProfileContact>) => Partial<ProfileContact>) => void
  onSave: () => void
  onCancel: () => void
  onRemove?: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <input
        value={draft.name ?? ""}
        onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
        placeholder="Name"
        autoFocus
        className={INPUT}
      />
      <div className="flex">
        <Combobox
          value={draft.role ?? ""}
          onChange={v => setDraft(d => ({ ...d, role: v }))}
          options={CONTACT_ROLES}
          placeholder="Role"
        />
      </div>
      <input
        value={draft.phone ?? ""}
        onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))}
        placeholder="Phone"
        className={INPUT}
      />
      <input
        value={draft.email ?? ""}
        onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
        placeholder="Email"
        className={INPUT}
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSave}
          className="rounded-[7px] px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: "#0b7a4e" }}>
          Save
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-[#6b6f73]">Cancel</button>
        {onRemove && (
          <button type="button" onClick={onRemove}
            className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#b6bbc0] hover:text-[#d92d20]">
            <X size={12} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}
