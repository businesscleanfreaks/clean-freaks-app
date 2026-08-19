"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { ChevronRight, Loader2 } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { showError, showSuccess } from "@/lib/toast"
import { PAY_METHOD_LABELS } from "@/lib/billing-schedule"
import {
  DRAFT_TIMINGS, DRAFT_TIMING_LABELS,
  FOOTER_METHODS,
  ONE_TIME_JOB_KINDS, ONE_TIME_TERM_DAYS, ONE_TIME_TERM_LABELS,
  REMINDER_SLOTS,
  type DraftTiming,
  type InvoiceFooterTemplates,
  type OneTimeJobDefaults,
  type ReminderTemplates,
} from "@/lib/billing-sections"

const inputCls =
  "w-full rounded-[8px] border border-[#e0e5ea] bg-white px-2.5 py-2 text-[12px] leading-[1.5] text-[#475467] outline-none focus:border-[#15793f]"

const selectCls =
  "flex-none rounded-[8px] border border-[#e0e5ea] bg-white px-2.5 py-[7px] text-[12px] font-semibold text-[#344054] outline-none focus:border-[#15793f]"

/**
 * One collapsible settings section with its own explicit Save changes button.
 *
 * Saving folds the section — the design's way of confirming the write landed.
 * These are settings you set and leave alone, unlike the per-client rows below
 * which save as you touch them.
 */
function Section({ title, hint, blurb, open, onToggle, onSave, saving, children }: {
  title: string
  hint?: string
  blurb: string
  open: boolean
  onToggle: () => void
  onSave: () => void
  saving: boolean
  children: React.ReactNode
}) {
  return (
    <div className="mt-2.5 rounded-[13px] border border-[#eef1f4] bg-[#f8fafb] first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full select-none items-center gap-2.5 px-[17px] py-[11px] text-left"
      >
        <span className="flex-none text-[11px] font-extrabold uppercase tracking-[0.05em] text-[#475467]">{title}</span>
        {hint && <span className="min-w-0 truncate text-[11.5px] text-[#98a2b3]">{hint}</span>}
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 flex-none text-[#98a2b3] transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col px-[17px] pb-3">
          <p className="pb-2 text-[11.5px] leading-[1.5] text-[#98a2b3]">{blurb}</p>
          {children}
          <div className="flex justify-end border-t border-[#eef1f4] pt-2.5">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#15793f] px-4 py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export interface SectionSettings {
  oneTimeJobDefaults: OneTimeJobDefaults
  invoiceFooterTemplates: InvoiceFooterTemplates
  reminderTemplates: ReminderTemplates
}

/**
 * The three settings sections above the per-client table: one-time job
 * defaults, invoice footer templates and the two reminder emails.
 */
export function BillingSections({ clientCounts }: {
  clientCounts: { residential: number; commercial: number }
}) {
  const { data, mutate } = useSWR<SectionSettings>("/api/settings/billing-sections", fetcher, {
    revalidateOnFocus: false,
  })
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [draft, setDraft] = useState<SectionSettings | null>(null)

  // Edit a local copy: each section saves only its own field, so a half-typed
  // footer can never be written by another section's button.
  useEffect(() => { if (data) setDraft(data) }, [data])

  const toggle = (key: string) => setOpenSection(cur => (cur === key ? null : key))

  const save = async (section: keyof SectionSettings, toast: string) => {
    if (!draft) return
    setSaving(section)
    try {
      const res = await fetch("/api/settings/billing-sections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, value: draft[section] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        showError(err?.error || "Could not save")
        return
      }
      mutate(await res.json(), false)
      setOpenSection(null)
      showSuccess(toast)
    } catch {
      showError("Could not save")
    } finally {
      setSaving(null)
    }
  }

  if (!draft) {
    return (
      <div className="flex items-center justify-center px-5 py-8 text-[#98a2b3]">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="px-5 pb-1 pt-3">
      <Section
        title="One-time job defaults"
        hint="When the invoice drafts & how long the client has to pay"
        blurb="When a one-time job is done, its invoice drafts itself. Set here when that draft appears and how long the client has to pay · you can still change either on any single job."
        open={openSection === "oneTimeJobDefaults"}
        onToggle={() => toggle("oneTimeJobDefaults")}
        onSave={() => save("oneTimeJobDefaults", "One-time job defaults saved · apply to every new job")}
        saving={saving === "oneTimeJobDefaults"}
      >
        {ONE_TIME_JOB_KINDS.map(({ key, label }, i) => {
          const row = draft.oneTimeJobDefaults[key]
          const applies =
            key === "residential" ? clientCounts.residential
              : key === "commercial" ? clientCounts.commercial
                : null
          return (
            <div key={key} className={`flex items-center gap-3 py-[7px] ${i ? "border-t border-[#eef1f4]" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-[#344054]">{label}</span>
                <span className="mt-px block text-[10.5px] text-[#98a2b3]">
                  {applies !== null
                    ? `Applies to ${applies} client${applies === 1 ? "" : "s"} · set on the booking form`
                    : "Any client · picked per job"}
                </span>
              </span>
              <select
                aria-label={`When the invoice drafts for ${label}`}
                className={`w-[206px] ${selectCls}`}
                value={row.when}
                onChange={e => setDraft(d => d && ({
                  ...d,
                  oneTimeJobDefaults: {
                    ...d.oneTimeJobDefaults,
                    [key]: { ...row, when: e.target.value as DraftTiming },
                  },
                }))}
              >
                {DRAFT_TIMINGS.map(t => <option key={t} value={t}>{DRAFT_TIMING_LABELS[t]}</option>)}
              </select>
              <select
                aria-label={`Payment terms for ${label}`}
                className={`w-[92px] ${selectCls}`}
                value={String(row.termDays)}
                onChange={e => setDraft(d => d && ({
                  ...d,
                  oneTimeJobDefaults: {
                    ...d.oneTimeJobDefaults,
                    [key]: { ...row, termDays: Number(e.target.value) },
                  },
                }))}
              >
                {ONE_TIME_TERM_DAYS.map(t => <option key={t} value={t}>{ONE_TIME_TERM_LABELS[t]}</option>)}
              </select>
            </div>
          )
        })}
      </Section>

      <Section
        title="Invoice footer templates"
        blurb="Edit once, applies to every invoice going forward. Change a client's method in the list below and their footer follows."
        open={openSection === "invoiceFooterTemplates"}
        onToggle={() => toggle("invoiceFooterTemplates")}
        onSave={() => save("invoiceFooterTemplates", "Invoice footers saved · used on every invoice from now on")}
        saving={saving === "invoiceFooterTemplates"}
      >
        {FOOTER_METHODS.map(method => (
          <div key={method} className="flex items-start gap-3 border-t border-[#eef1f4] py-2">
            <span className="w-[92px] flex-none pt-2 text-[12px] font-bold text-[#344054]">
              {PAY_METHOD_LABELS[method]}
            </span>
            <textarea
              aria-label={`Invoice footer for ${PAY_METHOD_LABELS[method]}`}
              rows={2}
              className={`flex-1 resize-y ${inputCls}`}
              value={draft.invoiceFooterTemplates[method]}
              onChange={e => setDraft(d => d && ({
                ...d,
                invoiceFooterTemplates: { ...d.invoiceFooterTemplates, [method]: e.target.value },
              }))}
            />
          </div>
        ))}
      </Section>

      <Section
        title="Reminder templates"
        blurb="The escalation ladder for late invoices. Reminders send as a reply in the original invoice email thread. Placeholders: #NUM = invoice number, AMT = amount, DUE = due date, DAYS = days late."
        open={openSection === "reminderTemplates"}
        onToggle={() => toggle("reminderTemplates")}
        onSave={() => save("reminderTemplates", "Reminder templates saved · used for every late invoice")}
        saving={saving === "reminderTemplates"}
      >
        {REMINDER_SLOTS.map(slot => (
          <div key={slot.key} className="flex items-start gap-3 border-t border-[#eef1f4] py-2">
            <span className="w-[130px] flex-none pt-2">
              <span className="block text-[12px] font-bold text-[#344054]">{slot.label}</span>
              <span className="mt-px block text-[10.5px] text-[#98a2b3]">{slot.when}</span>
            </span>
            <textarea
              aria-label={slot.label}
              rows={2}
              className={`flex-1 resize-y ${inputCls}`}
              value={draft.reminderTemplates[slot.key]}
              onChange={e => setDraft(d => d && ({
                ...d,
                reminderTemplates: { ...d.reminderTemplates, [slot.key]: e.target.value },
              }))}
            />
          </div>
        ))}
        <p className="pt-1 text-[10.5px] text-[#98a2b3]">
          14+ days late escalates to a phone call, so there is no third email to edit.
        </p>
      </Section>
    </div>
  )
}
