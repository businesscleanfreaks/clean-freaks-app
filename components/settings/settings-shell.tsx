"use client"

import { useState } from "react"
import { Building2, Users, Mail, FileText, CreditCard, Coins, Loader2, Clock } from "lucide-react"
import type { BusinessProfileData } from "@/lib/business-settings"
import type { InvoiceDefaultsData } from "@/lib/invoice-defaults"
import { showSuccess, showError } from "@/lib/toast"
import { EmailSettingsForm } from "./email-settings-form"
import { BusinessProfileForm } from "./business-profile-form"
import { InvoiceDefaultsForm } from "./invoice-defaults-form"

type Section = "business" | "team" | "delivery" | "invoicedefaults" | "payments" | "payouts"

const NAV_GROUPS: { label: string; items: { id: Section; name: string; icon: typeof Building2 }[] }[] = [
  {
    label: "Account",
    items: [
      { id: "business", name: "Business profile", icon: Building2 },
      { id: "team", name: "Team", icon: Users },
    ],
  },
  {
    label: "Getting paid",
    items: [
      { id: "delivery", name: "Invoice delivery", icon: Mail },
      { id: "invoicedefaults", name: "Invoice defaults", icon: FileText },
      { id: "payments", name: "Payments received", icon: CreditCard },
    ],
  },
  {
    label: "Cleaners",
    items: [{ id: "payouts", name: "Payouts & 1099s", icon: Coins }],
  },
]

// Sections whose content is a self-contained form with its own save controls,
// so the global save bar is hidden for them.
const SELF_SAVING: Section[] = ["delivery"]

const COMING_SOON: Partial<Record<Section, { title: string; desc: string }>> = {
  team: {
    title: "Team",
    desc: "Invite people to log in and run the business with you. This section is coming soon.",
  },
  payments: {
    title: "Payments received",
    desc: "Payment methods you accept and Zelle auto-detection. Detection settings currently live under Invoice delivery. This section is coming soon.",
  },
  payouts: {
    title: "Payouts & 1099s",
    desc: "Default cleaner payout timing and 1099 exports. This section is coming soon.",
  },
}

function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">{title}</h1>
      </div>
      <div className="flex items-center gap-[14px] rounded-[14px] border border-[#e9e9e6] bg-white px-6 py-[22px]">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#f2f2ef] text-[#7e8489]">
          <Clock className="h-5 w-5" />
        </span>
        <div className="text-[13.5px] leading-relaxed text-[#6b6f73]">{desc}</div>
      </div>
    </div>
  )
}

interface SettingsShellProps {
  initialBusiness: BusinessProfileData
  initialInvoiceDefaults: InvoiceDefaultsData
}

export function SettingsShell({ initialBusiness, initialInvoiceDefaults }: SettingsShellProps) {
  const [cat, setCat] = useState<Section>("business")
  const [saving, setSaving] = useState(false)

  const [business, setBusiness] = useState<BusinessProfileData>(initialBusiness)
  const [savedBusiness, setSavedBusiness] = useState<BusinessProfileData>(initialBusiness)

  const [invoiceDefaults, setInvoiceDefaults] = useState<InvoiceDefaultsData>(initialInvoiceDefaults)
  const [savedInvoiceDefaults, setSavedInvoiceDefaults] = useState<InvoiceDefaultsData>(initialInvoiceDefaults)

  const businessDirty = JSON.stringify(business) !== JSON.stringify(savedBusiness)
  const invoiceDefaultsDirty = JSON.stringify(invoiceDefaults) !== JSON.stringify(savedInvoiceDefaults)

  const saveBusiness = async () => {
    if (!business.businessName.trim()) {
      showError("Business name is required.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/settings/business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(business),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to save settings")
      }
      const saved = (await res.json()) as BusinessProfileData
      setBusiness(saved)
      setSavedBusiness(saved)
      showSuccess("Settings saved")
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const saveInvoiceDefaults = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/settings/invoice-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoiceDefaults),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to save settings")
      }
      const saved = (await res.json()) as InvoiceDefaultsData
      setInvoiceDefaults(saved)
      setSavedInvoiceDefaults(saved)
      showSuccess("Settings saved")
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  // The save bar is shared by every section that self-manages a dirty draft.
  const activeSaver =
    cat === "business"
      ? { dirty: businessDirty, save: saveBusiness, discard: () => setBusiness(savedBusiness) }
      : cat === "invoicedefaults"
        ? {
            dirty: invoiceDefaultsDirty,
            save: saveInvoiceDefaults,
            discard: () => setInvoiceDefaults(savedInvoiceDefaults),
          }
        : null
  const showSaveBar = activeSaver !== null

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* Sub-nav */}
      <div className="hidden w-[248px] flex-none flex-col overflow-y-auto border-r border-[#ececea] bg-white md:flex">
        <div className="px-[18px] pb-2 pt-6">
          <div className="px-[10px] text-[19px] font-extrabold tracking-[-0.02em]">Settings</div>
        </div>
        <div className="flex flex-col gap-0.5 px-3 pb-5 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-[10px] pb-[5px] pt-3 text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#b3b6b9]">
                {group.label}
              </div>
              {group.items.map((item) => {
                const active = cat === item.id
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCat(item.id)}
                    className={`flex w-full items-center gap-[11px] rounded-[9px] px-[10px] py-[10px] text-[13.5px] transition-colors ${
                      active
                        ? "bg-[#eef6f1] font-bold text-[#0b7a4e]"
                        : "font-semibold text-[#55585c] hover:bg-[#f4f4f2]"
                    }`}
                  >
                    <Icon className="h-[17px] w-[17px] flex-none" />
                    <span>{item.name}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile section picker */}
        <div className="border-b border-[#ececea] bg-white px-4 py-2 md:hidden">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as Section)}
            className="w-full rounded-[9px] border border-[#dededa] bg-white px-3 py-2 text-[14px] font-semibold text-[#0d0d0e] outline-none"
          >
            {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-6 py-9 md:px-11">
            {cat === "business" && (
              <BusinessProfileForm
                value={business}
                onChange={(patch) => setBusiness((prev) => ({ ...prev, ...patch }))}
              />
            )}
            {cat === "delivery" && <EmailSettingsForm />}
            {cat === "invoicedefaults" && (
              <InvoiceDefaultsForm
                value={invoiceDefaults}
                onChange={(patch) => setInvoiceDefaults((prev) => ({ ...prev, ...patch }))}
              />
            )}
            {COMING_SOON[cat] && <ComingSoon {...COMING_SOON[cat]!} />}
          </div>
        </div>

        {/* Save bar */}
        {showSaveBar && activeSaver && (
          <div className="flex-none border-t border-[#ececea] bg-white px-6 py-[14px] md:px-11">
            <div className="mx-auto flex max-w-[720px] items-center gap-3">
              <div className="flex-1 text-[12.5px] text-[#7e8489]">
                {activeSaver.dirty ? "You have unsaved changes" : "All changes saved"}
              </div>
              <button
                type="button"
                onClick={activeSaver.discard}
                disabled={!activeSaver.dirty || saving}
                className="rounded-[10px] border border-[#e2e2df] bg-white px-[18px] py-[11px] text-[13px] font-bold text-[#55585c] transition-colors hover:bg-[#f7f7f5] disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={activeSaver.save}
                disabled={!activeSaver.dirty || saving}
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#0b7a4e] px-[22px] py-[11px] text-[13px] font-bold text-white transition-colors hover:bg-[#0a6a44] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
