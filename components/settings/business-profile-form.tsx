"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { BusinessProfileData } from "@/lib/business-settings"
import { showSuccess, showError } from "@/lib/toast"

const inputCls =
  "w-full rounded-[9px] border border-[#dededa] bg-white px-[13px] py-[11px] text-[14px] text-[#0d0d0e] outline-none transition-colors focus:border-[#0b7a4e] focus:ring-2 focus:ring-[#0b7a4e]/15"
const labelCls = "mb-1.5 block text-[13px] font-bold text-[#0d0d0e]"

function initialsOf(name: string): string {
  const parts = (name || "CF").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "CF"
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
}

interface Props {
  value: BusinessProfileData
  onChange: (patch: Partial<BusinessProfileData>) => void
}

export function BusinessProfileForm({ value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Cache-busted so a replacement shows immediately.
  const refreshLogo = async () => {
    try {
      const res = await fetch("/api/settings/logo", { cache: "no-store" })
      const isImage = res.ok && (res.headers.get("content-type") || "").startsWith("image/")
      setLogoUrl(isImage ? `/api/settings/logo?t=${Date.now()}` : null)
    } catch {
      setLogoUrl(null)
    }
  }

  useEffect(() => {
    refreshLogo()
  }, [])

  const uploadLogo = async (file: File) => {
    setBusy(true)
    try {
      const body = new FormData()
      body.append("logo", file)
      const res = await fetch("/api/settings/logo", { method: "POST", body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to upload logo")
      showSuccess("Logo updated")
      await refreshLogo()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to upload logo")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const removeLogo = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/settings/logo", { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to remove logo")
      showSuccess("Logo removed")
      await refreshLogo()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to remove logo")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Business profile</h1>
        <div className="mt-[5px] text-[13.5px] text-[#6b6f73]">
          How your business appears to clients on invoices and emails.
        </div>
      </div>

      <div className="rounded-[14px] border border-[#e9e9e6] bg-white px-6 py-[22px]">
        {/* Logo */}
        <div className="flex items-center gap-[18px]">
          <div className="flex h-[74px] w-[74px] flex-none items-center justify-center overflow-hidden rounded-[14px] border border-[#dcebe3] bg-[#eef6f1] text-[22px] font-extrabold text-[#0b7a4e]">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- served as raw bytes from our API, not a static asset
              <img src={logoUrl} alt="Invoice logo" className="h-full w-full object-contain" />
            ) : (
              initialsOf(value.businessName)
            )}
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadLogo(file)
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-[9px] border border-[#d6e8de] bg-[#eef6f1] px-[15px] py-[9px] text-[13px] font-bold text-[#0b7a4e] transition-colors hover:bg-[#e4f0e9] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {logoUrl ? "Replace logo" : "Upload logo"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={removeLogo}
                  className="rounded-[9px] px-2.5 py-[9px] text-[13px] font-bold text-[#7e8489] transition-colors hover:bg-[#fdecec] hover:text-[#b91c1c] disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="mt-2 text-[12px] text-[#7e8489]">
              PNG or JPG, up to 2 MB. Shown on your invoices.
            </div>
          </div>
        </div>

        <div className="my-[22px] h-px bg-[#f0f0ed]" />

        {/* Fields */}
        <div className="flex flex-col gap-[18px]">
          <div>
            <label className={labelCls} htmlFor="bp-name">Business name</label>
            <input
              id="bp-name"
              type="text"
              className={inputCls}
              value={value.businessName}
              onChange={(e) => onChange({ businessName: e.target.value })}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="bp-legal">Legal business name</label>
            <input
              id="bp-legal"
              type="text"
              className={inputCls}
              placeholder="e.g. Shiloh Pro Cleaning Services"
              value={value.legalName ?? ""}
              onChange={(e) => onChange({ legalName: e.target.value })}
            />
            <div className="mt-[7px] text-[12px] text-[#7e8489]">
              The registered entity shown on invoices. Leave blank to just use your business name.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="bp-phone">Phone</label>
              <input
                id="bp-phone"
                type="text"
                className={inputCls}
                value={value.phone ?? ""}
                onChange={(e) => onChange({ phone: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="bp-email">Business email</label>
              <input
                id="bp-email"
                type="text"
                className={inputCls}
                value={value.email ?? ""}
                onChange={(e) => onChange({ email: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="bp-address">Business address</label>
            <input
              id="bp-address"
              type="text"
              className={inputCls}
              value={value.address ?? ""}
              onChange={(e) => onChange({ address: e.target.value })}
            />
            <div className="mt-[7px] text-[12px] text-[#7e8489]">
              Appears in the invoice footer. Leave blank to hide it.
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="bp-payment-email">Payment email (Zelle)</label>
            <input
              id="bp-payment-email"
              type="text"
              className={inputCls}
              placeholder="e.g. admin@thecleanfreaks.co"
              value={value.paymentEmail ?? ""}
              onChange={(e) => onChange({ paymentEmail: e.target.value })}
            />
            <div className="mt-[7px] text-[12px] text-[#7e8489]">
              The Zelle address clients send payment to. Shown in the invoice payment block.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
