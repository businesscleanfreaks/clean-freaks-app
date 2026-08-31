"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { showError, showUndoToast } from "@/lib/toast"
import { CONTACT_ROLES, PAY_METHOD_OPTIONS, SERVICE_TYPES } from "@/lib/combobox"
import { Combobox } from "./combobox"

interface Contact {
  name: string
  role: string
}

const INPUT =
  "w-full min-w-0 rounded-[8px] border border-[#e2e2df] bg-white px-3 py-[9px] text-[13px] font-semibold text-[#0d0d0e] outline-none focus:border-[#0b7a4e]"
/** Same field, but sharing a row — must be allowed to shrink. */
const INPUT_INLINE = `${INPUT} flex-1`

const segStyle = (on: boolean): React.CSSProperties =>
  on
    ? { background: "#fff", color: "#0d0d0e", boxShadow: "0 1px 2px rgba(16,24,40,.12)" }
    : { background: "transparent", color: "#8a8f93" }

/**
 * Add someone to the roster.
 *
 * Cleaners and vendors are separate records in the database but one decision
 * here, because from the office's point of view they are the same thing: a
 * 1099 subcontractor you pay per job. The type toggle picks which table it
 * lands in.
 */
export function AddPayeeModal({ open, onClose, onAdded }: {
  open: boolean
  onClose: () => void
  onAdded: (payee: { id: string; kind: "cleaner" | "vendor"; name: string }) => void
}) {
  const [kind, setKind] = useState<"cleaner" | "vendor">("cleaner")
  const [name, setName] = useState("")
  const [specialty, setSpecialty] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [payMethod, setPayMethod] = useState("")
  const [contacts, setContacts] = useState<Contact[]>([{ name: "", role: "" }])
  const [w9, setW9] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) return
    setKind("cleaner"); setName(""); setSpecialty(""); setPhone(""); setEmail("")
    setPayMethod(""); setContacts([{ name: "", role: "" }]); setW9(false)
  }, [open])

  const canSave = name.trim().length > 0 && !busy

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      const kept = contacts.filter(c => c.name.trim())
      const url = kind === "vendor" ? "/api/vendors" : "/api/subcontractors"
      const body = kind === "vendor"
        ? {
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            zelle: /zelle/i.test(payMethod) ? phone.trim() || null : null,
            services: specialty.trim() ? [specialty.trim()] : [],
            contacts: kept.length ? kept : undefined,
            notes: w9 ? "W-9 on file" : null,
          }
        : {
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            // Contacts and the W-9 flag have no columns on Subcontractor yet, so
            // they are recorded as notes rather than silently dropped.
            notes: [
              w9 ? "W-9 on file" : null,
              payMethod.trim() ? `Paid by ${payMethod.trim()}` : null,
              ...kept.map(c => `${c.name.trim()}${c.role.trim() ? ` (${c.role.trim()})` : ""}`),
            ].filter(Boolean).join(" · ") || null,
          }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error || "Could not add them")
      }
      const created = await res.json()
      const id = created?.id ?? created?.vendor?.id ?? created?.subcontractor?.id

      showUndoToast(`${name.trim()} added to the roster`, async () => {
        // Deactivate rather than delete: they may already have work attached.
        await fetch(`${url}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: false }),
        }).catch(() => null)
        onAdded({ id, kind, name: name.trim() })
      })
      onAdded({ id, kind, name: name.trim() })
      onClose()
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not add them")
    } finally {
      setBusy(false)
    }
  }

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[85] flex items-start justify-center px-4"
      style={{ background: "rgba(16,24,40,0.34)", paddingTop: "10vh", paddingBottom: "6vh" }}
      role="dialog"
      aria-modal="true"
      aria-label="Add a cleaner or vendor"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-[460px] max-w-full overflow-y-auto overflow-x-hidden rounded-[16px] bg-white px-[26px] py-6"
        style={{ maxHeight: "80vh", boxShadow: "0 24px 64px rgba(16,24,40,.22)" }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-[16px] font-extrabold">Add a cleaner or vendor</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1.5 grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] text-[#9a9fa4] hover:bg-[#f6f6f3]"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="mt-4 flex gap-[3px] rounded-[9px] bg-[#f0f0ec] p-[3px]">
          {([["cleaner", "Cleaner"], ["vendor", "Vendor · specialty work"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="flex-1 rounded-[7px] py-[7px] text-[12.5px] font-bold"
              style={segStyle(kind === k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3.5 flex flex-col gap-2.5">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name or company"
            autoFocus
            className={INPUT}
          />

          {kind === "vendor" && (
            <div className="flex">
              <Combobox
                value={specialty}
                onChange={setSpecialty}
                options={SERVICE_TYPES}
                placeholder="What do they do?"
              />
            </div>
          )}

          <div className="flex gap-2.5">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" className={INPUT_INLINE} />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className={INPUT_INLINE} />
          </div>

          <div className="flex">
            <Combobox
              value={payMethod}
              onChange={setPayMethod}
              options={PAY_METHOD_OPTIONS}
              placeholder="How you pay them"
              hintFor={o => (o === "Zelle" && phone.trim() ? `· uses their number ${phone.trim()}` : null)}
            />
          </div>

          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-[#9aa0a4]">
              Points of contact
            </span>
            <span className="text-[11.5px] font-semibold text-[#b6bbc0]">optional · who to text or call</span>
          </div>

          {contacts.map((c, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <input
                value={c.name}
                onChange={e => setContacts(cs => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder="Contact name"
                className={INPUT_INLINE}
              />
              <Combobox
                value={c.role}
                onChange={v => setContacts(cs => cs.map((x, j) => (j === i ? { ...x, role: v } : x)))}
                options={CONTACT_ROLES}
                placeholder="Role"
              />
              {contacts.length > 1 && (
                <button
                  type="button"
                  onClick={() => setContacts(cs => cs.filter((_, j) => j !== i))}
                  title="Remove this contact"
                  aria-label={`Remove contact ${i + 1}`}
                  className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] text-[16px] leading-none text-[#b6bbc0] hover:bg-[#f6f6f3]"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setContacts(cs => [...cs, { name: "", role: "" }])}
            className="self-start text-[11.5px] font-bold text-[#0b7a4e] hover:underline"
          >
            + Add another contact
          </button>

          <button
            type="button"
            onClick={() => setW9(v => !v)}
            aria-pressed={w9}
            className="flex items-center gap-2.5 py-0.5 text-left"
          >
            <span
              className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px]"
              style={w9
                ? { background: "#0b7a4e", border: "1px solid #0b7a4e" }
                : { background: "#fff", border: "1.5px solid #c9cdd1" }}
            >
              {w9 && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff"
                  strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 5 5L20 7" />
                </svg>
              )}
            </span>
            <span className="text-[12.5px] font-bold text-[#3f4347]">W-9 already on file</span>
            <span className="text-[11.5px] font-semibold text-[#9a9fa4]">
              needed for their 1099 once you pay them $600+
            </span>
          </button>
        </div>

        <div className="mt-[18px] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-3.5 py-2.5 text-[13px] font-bold text-[#3f4347] hover:bg-[#f6f6f3]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="rounded-[8px] px-4 py-2.5 text-[13px] font-extrabold text-white"
            style={{ background: canSave ? "#0b7a4e" : "#cbd5e1" }}
          >
            {busy ? "Adding…" : "Add to roster"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
