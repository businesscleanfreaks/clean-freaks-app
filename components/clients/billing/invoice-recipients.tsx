"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { ChevronDown, ChevronUp, Loader2, Plus, X } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { showError, showSuccess } from "@/lib/toast"
import {
  BILLING_ROLES,
  moveRecipient,
  renumber,
  tagFor,
  validateRecipients,
  type BillingRecipient,
} from "@/lib/billing-recipients"

interface Row extends BillingRecipient {
  phone?: string | null
}

interface Payload {
  recipients: Row[]
  available: Row[]
}

const CUSTOM = "__custom__"

const initials = (name: string) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || "")
    .join("") || "?"

/**
 * "Invoices sent to" — every address a client's invoice goes to, in order.
 *
 * The first row is tagged TO · GREETED because it decides the "Hi {firstName}"
 * the client reads; the rest are CC. That is why the order is editable here
 * rather than inferred, and why removing the last recipient is refused.
 */
export function InvoiceRecipients({ clientId }: { clientId: string }) {
  const { data, mutate } = useSWR<Payload>(`/api/clients/${clientId}/billing-recipients`, fetcher)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [customFor, setCustomFor] = useState<Record<string, boolean>>({})

  useEffect(() => { if (data) setRows(data.recipients) }, [data])

  if (!rows) {
    return (
      <section className="rounded-[10px] bg-white p-5" style={{ border: "1px solid #E4E4E7" }}>
        <div className="flex items-center gap-2 text-[12px] text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading recipients…
        </div>
      </section>
    )
  }

  const problems = validateRecipients(rows)
  const dirty = JSON.stringify(rows) !== JSON.stringify(data?.recipients ?? [])

  const save = async (next: Row[]) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/billing-recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: next.map(r => ({ id: r.id, billingRole: r.billingRole, email: r.email, name: r.name })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { showError(body?.error || "Could not save recipients"); return }
      mutate(body, false)
      setRows(body.recipients)
      showSuccess("Invoice recipients saved")
    } catch {
      showError("Could not save recipients")
    } finally {
      setSaving(false)
    }
  }

  const patch = (id: string, changes: Partial<Row>) =>
    setRows(cur => (cur || []).map(r => (r.id === id ? { ...r, ...changes } : r)))

  const move = (id: string, delta: number) => setRows(cur => moveRecipient(cur || [], id, delta) as Row[])

  const remove = (id: string) => {
    if ((rows || []).length <= 1) {
      showError("Every client needs at least one invoice recipient.")
      return
    }
    setRows(cur => renumber((cur || []).filter(r => r.id !== id)) as Row[])
  }

  const addExisting = (contact: Row) => {
    setRows(cur => renumber([...(cur || []), { ...contact, isBillingRecipient: true }]) as Row[])
    setAdding(false)
  }

  return (
    <section className="rounded-[10px] bg-white" style={{ border: "1px solid #E4E4E7" }}>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400">Invoices sent to</span>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
      </div>

      <div className="px-5">
        {rows.length === 0 && (
          <p className="pb-2 text-[12.5px] text-slate-500">
            Nobody is set to receive this client&apos;s invoices yet.
          </p>
        )}

        {rows.map((r, i) => {
          const tag = tagFor(i)
          const isCustom = customFor[r.id] || (!!r.billingRole && !BILLING_ROLES.includes(r.billingRole as never))
          return (
            <div key={r.id} className="flex items-start gap-2.5 border-b border-slate-100 py-2.5 last:border-b-0">
              <span
                className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10.5px] font-bold"
                style={{ background: "#ecfdf9", color: "#0f766e" }}
              >
                {initials(r.name)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    aria-label={`Name for recipient ${i + 1}`}
                    value={r.name}
                    onChange={e => patch(r.id, { name: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-teal-500"
                  />
                  <span
                    className="flex-none rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.04em]"
                    style={
                      tag === "TO"
                        ? { background: "#ecfdf9", color: "#0f766e" }
                        : { background: "#f1f5f9", color: "#64748b" }
                    }
                    title={tag === "TO" ? "Addressed by name in the email greeting" : "Copied on the invoice email"}
                  >
                    {tag === "TO" ? "To · Greeted" : "CC"}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label={`Billing role for ${r.name || "recipient"}`}
                    value={isCustom ? CUSTOM : r.billingRole || ""}
                    onChange={e => {
                      if (e.target.value === CUSTOM) {
                        setCustomFor(c => ({ ...c, [r.id]: true }))
                        patch(r.id, { billingRole: "" })
                      } else {
                        setCustomFor(c => ({ ...c, [r.id]: false }))
                        patch(r.id, { billingRole: e.target.value || null })
                      }
                    }}
                    className="flex-none rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] text-slate-700 outline-none focus:border-teal-500"
                  >
                    <option value="">Billing role…</option>
                    {BILLING_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                    <option value={CUSTOM}>Custom role…</option>
                  </select>

                  {isCustom && (
                    <input
                      aria-label={`Custom billing role for ${r.name || "recipient"}`}
                      value={r.billingRole || ""}
                      placeholder="Their title"
                      onChange={e => patch(r.id, { billingRole: e.target.value })}
                      className="w-[132px] flex-none rounded-md border border-slate-200 px-2 py-1 text-[11.5px] text-slate-700 outline-none focus:border-teal-500"
                    />
                  )}

                  <input
                    aria-label={`Email for ${r.name || "recipient"}`}
                    value={r.email || ""}
                    placeholder="email@example.com"
                    onChange={e => patch(r.id, { email: e.target.value })}
                    className="min-w-[180px] flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11.5px] text-slate-700 outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="mt-0.5 flex flex-none items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(r.id, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${r.name || "recipient"} up`}
                  title="Move up · the first recipient is the one greeted"
                  className="rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(r.id, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Move ${r.name || "recipient"} down`}
                  className="rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.name || "recipient"}`}
                  title="Remove from the invoice · keeps the contact"
                  className="rounded p-1 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-2.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setAdding(v => !v)}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 transition-colors hover:text-teal-800"
          >
            <Plus className="h-3 w-3" /> Add another recipient
          </button>

          {adding && (
            <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[280px] rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-xl">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-slate-400">
                From this client&apos;s contacts
              </div>
              {(data?.available || []).length === 0 ? (
                <p className="px-2 py-2 text-[11.5px] text-slate-500">
                  {rows.length > 0
                    ? "Everyone on file is already a recipient. Add a contact on the Contacts tab first."
                    : "This client has no contacts yet. Add one on the Contacts tab first."}
                </p>
              ) : (
                (data?.available || []).map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addExisting(c)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9.5px] font-bold"
                      style={{ background: "#eef1f4", color: "#64748b" }}
                    >
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-slate-800">{c.name}</span>
                      <span className="block truncate text-[10.5px] text-slate-400">{c.email || "No email"}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {dirty && (
          <button
            type="button"
            onClick={() => save(rows)}
            disabled={saving || problems.length > 0}
            title={problems[0]?.message}
            className="ml-auto rounded-md px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-50"
            style={{ background: "#0d9488" }}
          >
            {saving ? "Saving…" : "Save recipients"}
          </button>
        )}
      </div>

      {/* Only while editing. Every client starts with an empty list until
          someone fills this card in, and flagging all of them as broken would
          be noise rather than news. */}
      {dirty && problems.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50 px-5 py-2">
          {problems.map((p, i) => (
            <p key={i} className="text-[11.5px] font-semibold text-amber-800">{p.message}</p>
          ))}
        </div>
      )}

      <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
        The first recipient is greeted by name. Everyone else is CC&apos;d. Edits here update the contact record.
      </p>
    </section>
  )
}
