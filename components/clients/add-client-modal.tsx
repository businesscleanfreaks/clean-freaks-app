"use client"

import { useEffect, useRef, useState } from "react"
import { showError } from "@/lib/toast"
import {
  CONTACT_ROLES,
  validateNewClient,
  type NewClientField,
  type NewClientInput,
  type PayMethod,
} from "@/lib/new-client"

/**
 * The Add Client modal (Clients Main.dc.html · "New client"). It creates the
 * account and who to bill; the first clean is booked next, on the profile.
 * The save is one request, so a client is either created whole or not at all.
 */

export interface AddClientPrefill {
  sourceProspectId?: string | null
  clientName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}

interface AddClientModalProps {
  isOpen: boolean
  prefill?: AddClientPrefill | null
  onClose: () => void
  /** The client exists: refresh whatever lists show it. */
  onCreated: (clientId: string) => void
  /** "Book first clean". */
  onBookFirstClean: (clientId: string) => void
}

const CUSTOM_ROLE = "__custom"

interface Draft {
  name: string
  address: string
  contactName: string
  roleChoice: string
  roleText: string
  email: string
  phone: string
  pays: PayMethod
  separateBillingEmail: boolean
  billingEmail: string
}

const emptyDraft = (prefill?: AddClientPrefill | null): Draft => ({
  name: prefill?.clientName ?? "",
  address: "",
  contactName: prefill?.contactName ?? "",
  roleChoice: "Owner",
  roleText: "",
  email: prefill?.email ?? "",
  phone: prefill?.phone ?? "",
  pays: "invoice",
  separateBillingEmail: false,
  billingEmail: "",
})

export function AddClientModal({ isOpen, prefill, onClose, onCreated, onBookFirstClean }: AddClientModalProps) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(prefill))
  const [errors, setErrors] = useState<Partial<Record<NewClientField, string>>>({})
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  // Fresh form each time it opens.
  useEffect(() => {
    if (!isOpen) return
    setDraft(emptyDraft(prefill))
    setErrors({})
    setSaving(false)
    setAdded(null)
    const t = setTimeout(() => nameRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [isOpen, prefill])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [isOpen, saving, onClose])

  if (!isOpen) return null

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
    const field = key === "roleText" ? "role" : key
    if (field in errors) setErrors(e => ({ ...e, [field]: undefined }))
  }

  const toInput = (): NewClientInput => ({
    name: draft.name,
    address: draft.address,
    contactName: draft.contactName,
    role: draft.roleChoice === CUSTOM_ROLE ? draft.roleText : draft.roleChoice,
    email: draft.email,
    phone: draft.phone,
    pays: draft.pays,
    separateBillingEmail: draft.separateBillingEmail,
    billingEmail: draft.billingEmail,
    notes: prefill?.notes ?? null,
    sourceProspectId: prefill?.sourceProspectId ?? null,
  })

  const canSave = draft.name.trim().length > 0 && !saving

  const save = async () => {
    if (!canSave) return
    const input = toInput()
    const problems = validateNewClient(input)
    if (problems.length > 0) {
      setErrors(Object.fromEntries(problems.map(p => [p.field, p.message])))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/clients/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(body.problems)) {
          setErrors(Object.fromEntries(body.problems.map((p: { field: string; message: string }) => [p.field, p.message])))
        } else {
          showError(body.error || "Couldn't add the client. Nothing was saved.")
        }
        return
      }
      setAdded({ id: body.id, name: body.name })
      onCreated(body.id)
    } catch {
      showError("Couldn't reach the server. Nothing was saved.")
    } finally {
      setSaving(false)
    }
  }

  const customRole = draft.roleChoice === CUSTOM_ROLE

  return (
    <div className="cfac-overlay" onClick={() => { if (!saving) onClose() }}>
      <style>{STYLES}</style>
      <div className="cfac-panel" role="dialog" aria-modal="true" aria-labelledby="cfac-title" onClick={e => e.stopPropagation()}>
        <button className="cfac-close" aria-label="Close" onClick={onClose} disabled={saving}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        {!added ? (
          <>
            <div style={{ padding: "22px 24px 0" }}>
              <div id="cfac-title" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>New client</div>
              <div style={{ fontSize: 12.5, color: "#8a857a", marginTop: 3 }}>Add the account and who to bill. You&apos;ll schedule their first clean next.</div>
            </div>

            <form
              className="cfac-body"
              onSubmit={e => { e.preventDefault(); save() }}
              noValidate
            >
              <div>
                <div className="cfac-label">Client details</div>
                <div className="cfac-stack">
                  <Field error={errors.name}>
                    <input ref={nameRef} className="cfac-input" value={draft.name} onChange={e => set("name", e.target.value)} placeholder="Business or client name" aria-invalid={!!errors.name} />
                  </Field>
                  <Field error={errors.address}>
                    <input className="cfac-input" value={draft.address} onChange={e => set("address", e.target.value)} placeholder="Address or area (e.g. Santa Monica 90404)" />
                  </Field>
                </div>
              </div>

              <div>
                <div className="cfac-label">Primary contact</div>
                <div className="cfac-stack">
                  <Field error={errors.contactName}>
                    <input className="cfac-input" value={draft.contactName} onChange={e => set("contactName", e.target.value)} placeholder="Contact name" />
                  </Field>
                  <div className={customRole ? "cfac-pair" : undefined}>
                    <select className="cfac-input" value={draft.roleChoice} onChange={e => set("roleChoice", e.target.value)} aria-label="Their role">
                      {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      <option value={CUSTOM_ROLE}>Other role…</option>
                    </select>
                    {customRole && (
                      <Field error={errors.role}>
                        <input autoFocus className="cfac-input" value={draft.roleText} onChange={e => set("roleText", e.target.value)} placeholder="Their role · e.g. Regional Manager, Executive Assistant" />
                      </Field>
                    )}
                  </div>
                  <div className="cfac-pair">
                    <Field error={errors.email}>
                      <input className="cfac-input" type="email" value={draft.email} onChange={e => set("email", e.target.value)} placeholder="Email (for invoices)" aria-invalid={!!errors.email} />
                    </Field>
                    <Field error={errors.phone}>
                      <input className="cfac-input" type="tel" value={draft.phone} onChange={e => set("phone", e.target.value)} placeholder="Phone (optional)" />
                    </Field>
                  </div>
                </div>
              </div>

              <div>
                <div className="cfac-label">How they pay</div>
                <div className="cfac-pair cfac-pair-keep">
                  <PayCard on={draft.pays === "invoice"} onPick={() => set("pays", "invoice")} title="Send invoices" sub="Emailed invoice, net terms" />
                  <PayCard on={draft.pays === "charge"} onPick={() => set("pays", "charge")} title="Charge directly" sub="Zelle / card, no invoice" />
                </div>
                {draft.pays === "invoice" && (
                  <>
                    <label className="cfac-check">
                      <input type="checkbox" checked={draft.separateBillingEmail} onChange={() => set("separateBillingEmail", !draft.separateBillingEmail)} />
                      Invoices go to a different email than the contact
                    </label>
                    {draft.separateBillingEmail && (
                      <Field error={errors.billingEmail} style={{ marginTop: 9 }}>
                        <input autoFocus className="cfac-input" type="email" value={draft.billingEmail} onChange={e => set("billingEmail", e.target.value)} placeholder="Billing email (e.g. ap@company.com)" aria-invalid={!!errors.billingEmail} />
                      </Field>
                    )}
                  </>
                )}
              </div>

              <div className="cfac-note">
                More people at this company? Add extra contacts · and pick who receives invoices · on the client&apos;s profile after creating.
              </div>
              {/* Enter submits from any field. */}
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>

            <div className="cfac-foot">
              <button className="cfac-cancel" onClick={onClose} disabled={saving}>Cancel</button>
              <button
                className="cfac-save"
                onClick={save}
                disabled={!canSave}
                style={{ background: canSave ? "#0d9488" : "#cfc8ba", cursor: canSave ? "pointer" : "not-allowed" }}
              >
                {saving ? "Adding…" : "Add client"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding: "30px 26px 24px", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#e8f5ec", color: "#15803d", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>{added.name} added</div>
            <div style={{ fontSize: 12.5, color: "#8a857a", marginTop: 5, lineHeight: 1.5, maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
              The account is created. Schedule their first clean to set the cleaner, rate, and cadence.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 20 }}>
              <button className="cfac-book" onClick={() => onBookFirstClean(added.id)} autoFocus>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                Book first clean
              </button>
              <button className="cfac-later" onClick={onClose}>Done · I&apos;ll schedule later</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ error, children, style }: { error?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={error ? "cfac-field cfac-field-bad" : "cfac-field"} style={style}>
      {children}
      {error && <div className="cfac-error">{error}</div>}
    </div>
  )
}

function PayCard({ on, onPick, title, sub }: { on: boolean; onPick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="cfac-pay"
      style={{ borderColor: on ? "#0d9488" : "#e6dfd1", background: on ? "#f2fbf9" : "#fff" }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{title}</div>
      <div style={{ fontSize: 11, color: "#8a857a", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
    </button>
  )
}

const STYLES = `
  .cfac-overlay { position: fixed; inset: 0; background: rgba(30,24,12,0.34); z-index: 80; display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
  .cfac-panel { position: relative; width: 520px; max-width: 93vw; max-height: 86vh; overflow: hidden; display: flex; flex-direction: column; background: #fff; border-radius: 18px; box-shadow: 0 28px 70px rgba(40,30,10,0.32); color: #1a1a1a; }
  .cfac-close { position: absolute; top: 16px; right: 16px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #f4f0e8; border: none; color: #8a857a; cursor: pointer; z-index: 2; }
  .cfac-close:hover { background: #ebe5da; }
  .cfac-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 24px 8px; display: flex; flex-direction: column; gap: 18px; }
  .cfac-label { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #8a857a; margin-bottom: 9px; }
  .cfac-stack { display: flex; flex-direction: column; gap: 10px; }
  .cfac-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cfac-input { width: 100%; font-size: 13.5px; padding: 11px 12px; border: 1px solid #e6dfd1; border-radius: 10px; outline: none; background: #fff; color: #1a1a1a; box-sizing: border-box; }
  .cfac-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,0.12); }
  .cfac-field-bad .cfac-input { border-color: #dc2626; }
  .cfac-error { font-size: 11.5px; color: #b91c1c; margin-top: 5px; font-weight: 600; }
  .cfac-pay { text-align: left; cursor: pointer; border-radius: 11px; padding: 12px 13px; border: 1.5px solid #e6dfd1; transition: border-color .12s, background .12s; font: inherit; }
  .cfac-check { display: flex; align-items: center; gap: 8px; margin-top: 11px; cursor: pointer; font-size: 12.5px; color: #5c574e; font-weight: 600; }
  .cfac-check input { width: 15px; height: 15px; accent-color: #0d9488; }
  .cfac-note { font-size: 11.5px; color: #8a857a; line-height: 1.5; background: #faf8f3; border: 1px solid #f0ebe1; border-radius: 10px; padding: 11px 13px; }
  .cfac-foot { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 24px 16px; border-top: 1px solid #f0ebe1; background: #fff; }
  .cfac-cancel { font-size: 12.5px; font-weight: 700; color: #8a857a; background: #fff; border: 1px solid #e6dfd1; padding: 9px 15px; border-radius: 9px; cursor: pointer; }
  .cfac-save { font-size: 12.5px; font-weight: 700; color: #fff; border: none; padding: 9px 18px; border-radius: 9px; }
  .cfac-book { font-size: 13px; font-weight: 700; color: #fff; background: #0d9488; padding: 11px; border-radius: 10px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; }
  .cfac-book:hover { background: #0b6b60; }
  .cfac-later { font-size: 12.5px; font-weight: 700; color: #8a857a; background: #fff; border: 1px solid #e6dfd1; padding: 10px; border-radius: 10px; cursor: pointer; }
  @media (max-width: 480px) {
    .cfac-overlay { padding-top: 4vh; }
    .cfac-body { padding: 16px 18px 8px; }
    .cfac-pair:not(.cfac-pair-keep) { grid-template-columns: 1fr; }
    .cfac-foot { padding: 12px 18px 14px; }
  }
`
