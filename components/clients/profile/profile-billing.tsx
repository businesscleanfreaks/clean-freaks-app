"use client"

import { useState } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { ProrationCard } from "../cockpit/proration-card"
import type { ClientDetailState } from "../use-client-detail"
import { money, shortDay, type ProfileInvoice } from "@/lib/client-profile"
import { showApiError, showError, showSuccess } from "@/lib/toast"
import { C, initialsOf } from "./ui"
import { ContactEditor, useContacts } from "./profile-people"

/**
 * Billing (Client Profile Main.dc.html · BILLING): every invoice on the left,
 * the settings set once on the right. The settings write through the same
 * endpoint as Invoices → Billing schedule, so the two screens cannot differ.
 */

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  DRAFT: { label: "Draft", bg: "#f0eee8", fg: "#8a857a" },
  SENT: { label: "Sent", bg: "#eef2fb", fg: "#3b5bdb" },
  OVERDUE: { label: "Overdue", bg: "#fbeeec", fg: "#b4413a" },
  PAID: { label: "Paid", bg: "#e7f6ee", fg: "#1f8a5b" },
  VOID: { label: "Void", bg: "#f0eee8", fg: "#a39d90" },
}

function invoiceMonth(inv: ProfileInvoice): string {
  const d = new Date(inv.billingPeriodStart ?? inv.dateCreated)
  return `${LONG_MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() !== new Date().getUTCFullYear() ? ` ${d.getUTCFullYear()}` : ""}`
}

function invoiceState(inv: ProfileInvoice): string {
  if (inv.status === "PAID" && inv.datePaid) return `Paid ${shortDay(inv.datePaid)}`
  if ((inv.status === "SENT" || inv.status === "OVERDUE") && inv.dateSent) return `Sent ${shortDay(inv.dateSent)}`
  if (inv.status === "VOID") return "Voided"
  return "Not sent yet"
}

export function BillingTab({ state }: { state: ClientDetailState }) {
  const router = useRouter()
  const { client } = state
  const invoices = [...((client.invoices || []) as ProfileInvoice[])].sort(
    (a, b) => new Date(b.billingPeriodStart ?? b.dateCreated).getTime() - new Date(a.billingPeriodStart ?? a.dateCreated).getTime(),
  )

  return (
    <div className="cfp-billing">
      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <ProrationCard clientId={client.id} />
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 2px", marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Invoices</span>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            {invoices.map((inv, i) => {
              const chip = STATUS_CHIP[inv.status] ?? STATUS_CHIP.DRAFT
              return (
                <div
                  key={inv.id}
                  className="cfp-row cfp-inv-row"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) auto auto auto", gap: 14, alignItems: "center", padding: "13px 20px", borderTop: i === 0 ? "none" : `1px solid ${C.hair}`, borderRadius: 0 }}
                >
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{invoiceMonth(inv)}</span>
                  <span className="cfp-inv-hide" style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ fontSize: 12.5, color: C.sub }}>{invoiceState(inv)}</span>
                    {inv.invoiceNumber && <span style={{ fontSize: 11, color: "#b3ac9d", marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>{inv.invoiceNumber}</span>}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(inv.totalAmount)}</span>
                  <span className="cfp-inv-hide" style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: chip.bg, color: chip.fg }}>{chip.label}</span>
                  <span className="cfp-link cfp-inv-hide" style={{ fontSize: 11.5 }}>View invoice</span>
                </div>
              )
            })}
            {invoices.length === 0 && (
              <div style={{ fontSize: 12.5, color: C.muted, padding: "16px 20px" }}>No invoices yet.</div>
            )}
          </div>
        </div>
      </div>
      <BillingSettings state={state} />
    </div>
  )
}

const CADENCE_CHOICES: Array<[string, string, string]> = [
  ["AFTER_EACH_CLEAN", "Per visit", "Invoiced after each completed clean."],
  ["BI_WEEKLY", "Every 2 weeks", "Bundled and sent every two weeks."],
  ["END_OF_MONTH", "Monthly", "Bundled and sent at month-end across all locations."],
]

function Chip({ on, onPick, children }: { on: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPick}
      style={{
        flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, padding: "8px 6px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
        border: `1px solid ${on ? C.primary : "#e6dfd1"}`, background: on ? C.hoverTint : "#fff", color: on ? C.teal : C.sub,
      }}
    >
      {children}
    </button>
  )
}

interface RecipientRow {
  email: string
  name: string | null
  contactId: string | null
  billingRole: string | null
  tag: "TO" | "CC"
}

function BillingSettings({ state }: { state: ClientDetailState }) {
  const { client } = state
  const { data: recips, mutate: reloadRecips } = useSWR<{ recipients: RecipientRow[]; available: Array<{ id: string; name: string; email: string }> }>(
    `/api/clients/${client.id}/billing-recipients`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const { reload: reloadContacts } = useContacts(client.id)
  const [newContact, setNewContact] = useState(false)
  const [busy, setBusy] = useState(false)
  const cadence = client.invoiceFrequency || "END_OF_MONTH"
  const delivery = client.billingDelivery || "EMAIL"
  const cadenceChoices = cadence === "CUSTOM" ? [...CADENCE_CHOICES, ["CUSTOM", "Custom", "A custom arrangement."] as [string, string, string]] : CADENCE_CHOICES

  const patch = async (body: Record<string, unknown>, done: string) => {
    try {
      const res = await fetch("/api/settings/billing-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, ...body }),
      })
      if (!res.ok) return showApiError(res, "Couldn't save that")
      showSuccess(done)
      state.onDataChange?.()
    } catch {
      showError("Couldn't save that")
    }
  }

  const saveRecipients = async (list: Array<{ email: string; contactId: string | null; name: string | null }>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${client.id}/billing-recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: list }),
      })
      if (!res.ok) return showApiError(res, "Couldn't update who gets invoices")
      reloadRecips(await res.json(), false)
      state.onDataChange?.()
    } catch {
      showError("Couldn't update who gets invoices")
    } finally {
      setBusy(false)
    }
  }

  const current = (recips?.recipients ?? []).map(r => ({ email: r.email, contactId: r.contactId, name: r.name }))
  const remove = (email: string) => saveRecipients(current.filter(r => r.email !== email))
  const add = (value: string) => {
    if (value === "__new") return setNewContact(true)
    const contact = recips?.available.find(c => c.id === value)
    if (contact) saveRecipients([...current, { email: contact.email, contactId: contact.id, name: contact.name }])
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 2px", marginBottom: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Settings</span>
        <span style={{ fontSize: 12, color: C.muted }}>set once</span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <SettingLabel>Invoice cadence</SettingLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {cadenceChoices.map(([key, label]) => (
              <Chip key={key} on={cadence === key} onPick={() => cadence !== key && patch({ cadence: key }, "Invoice cadence saved")}>{label}</Chip>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 7, lineHeight: 1.45 }}>
            {(cadenceChoices.find(c => c[0] === cadence) ?? CADENCE_CHOICES[2])[2]}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 16 }}>
          <SettingLabel>How they pay</SettingLabel>
          <div style={{ display: "flex", gap: 6 }}>
            <Chip on={delivery === "EMAIL"} onPick={() => delivery !== "EMAIL" && patch({ delivery: "EMAIL" }, "Saved · invoices will be emailed")}>Send invoices</Chip>
            <Chip on={delivery === "TRACK_ONLY"} onPick={() => delivery !== "TRACK_ONLY" && patch({ delivery: "TRACK_ONLY" }, "Saved · no invoice emails")}>Charge directly</Chip>
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 7, lineHeight: 1.45 }}>
            {delivery === "TRACK_ONLY" ? "Zelle or card, no invoice is emailed. What they owe is still tracked." : "Emailed invoice, net terms."}
          </div>
        </div>

        {client.locations.length > 1 && (
          <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 16 }}>
            <SettingLabel>Across {client.locations.length} locations</SettingLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {([
                [false, "One combined invoice", "A line per location, one total"],
                [true, "One invoice per location", "Same billing contact"],
              ] as const).map(([separate, title, sub]) => {
                const on = !!client.separateLocationInvoices === separate
                return (
                  <button
                    key={title}
                    type="button"
                    onClick={() => !on && patch({ separateLocationInvoices: separate }, "Saved")}
                    style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", border: `1.5px solid ${on ? C.primary : "#e6dfd1"}`, background: on ? "#f2fbf9" : "#fff" }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{sub}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 16 }}>
          <SettingLabel>Invoices go to</SettingLabel>
          {(recips?.recipients ?? []).map((r, i) => (
            <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : `1px solid ${C.hair}` }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", flex: "none", background: r.tag === "TO" ? C.primary : "#94a3b8", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {initialsOf(r.name || r.email)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name || r.email}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: r.tag === "TO" ? C.teal : C.muted }}>{r.tag}</span>
                </div>
                {r.name && <div style={{ fontSize: 11.5, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</div>}
              </div>
              {(recips?.recipients.length ?? 0) > 1 && (
                <button
                  type="button"
                  title="Stop sending invoices to this address"
                  disabled={busy}
                  onClick={() => remove(r.email)}
                  style={{ flex: "none", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#a8a294", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          ))}
          {recips && recips.recipients.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.amber, fontWeight: 700, padding: "4px 0" }}>No email on file · invoices can&apos;t be sent yet.</div>
          )}
          <select
            value=""
            disabled={busy}
            onChange={e => add(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", marginTop: 8, fontSize: 12, fontWeight: 700, padding: "8px 10px", border: "1.5px dashed #d8d0c0", borderRadius: 9, background: "#fff", color: C.teal, cursor: "pointer", fontFamily: "inherit" }}
          >
            <option value="">+ Add recipient</option>
            {(recips?.available ?? []).map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
            <option value="__new">Someone new · create a contact…</option>
          </select>
          <div style={{ fontSize: 11, color: "#a89f8c", marginTop: 8, lineHeight: 1.45 }}>
            The first person is greeted in the email; the rest are cc&apos;d.
          </div>
        </div>
      </div>

      {newContact && (
        <ContactEditor
          clientId={client.id}
          contact={null}
          isFirst={false}
          onClose={() => setNewContact(false)}
          onSaved={contact => {
            reloadContacts()
            if (contact.email) saveRecipients([...current, { email: contact.email, contactId: contact.id, name: contact.name }])
          }}
        />
      )}
    </div>
  )
}

function SettingLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>{children}</div>
  )
}
