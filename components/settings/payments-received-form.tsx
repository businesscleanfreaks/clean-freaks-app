"use client"

import { useState } from "react"
import { Check, Plus, Info, Search, Loader2, X } from "lucide-react"
import { showSuccess, showError } from "@/lib/toast"

export interface PaymentDetectionData {
  enableInboxSync: boolean
  autoConfirmHighConfidencePayments: boolean
}

const MAX_METHOD_LENGTH = 40

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-[42px] flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? "#0b7a4e" : "#d4d4d0" }}
    >
      <span
        className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(0)" }}
      />
    </button>
  )
}

interface Props {
  value: PaymentDetectionData
  onChange: (patch: Partial<PaymentDetectionData>) => void
  provider: string
  credsSet: boolean
  // Persists any pending toggle change before a scan (the scan reads saved state).
  onEnsureSaved: () => Promise<boolean>
  methods: string[]
  onMethodsChange: (methods: string[]) => void
}

export function PaymentsReceivedForm({
  value,
  onChange,
  provider,
  credsSet,
  onEnsureSaved,
  methods,
  onMethodsChange,
}: Props) {
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draftMethod, setDraftMethod] = useState("")

  const commitMethod = () => {
    const value = draftMethod.trim().slice(0, MAX_METHOD_LENGTH)
    if (!value) {
      setAdding(false)
      setDraftMethod("")
      return
    }
    const duplicate = methods.some((m) => m.toLowerCase() === value.toLowerCase())
    if (!duplicate) onMethodsChange([...methods, value])
    setDraftMethod("")
    setAdding(false)
  }
  const gmail = provider === "gmail"
  const canScan = gmail && credsSet && value.enableInboxSync

  const scanNow = async () => {
    setScanning(true)
    try {
      // Save the toggle change first — the scan endpoint checks the saved value.
      const saved = await onEnsureSaved()
      if (!saved) return
      const res = await fetch("/api/settings/email/test-inbox", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        showError(data?.error || "Inbox scan failed")
        return
      }
      showSuccess(
        `Inbox scan complete: ${data.scanned || 0} checked, ${data.created || 0} added, ${data.autoApplied || 0} auto-confirmed`,
      )
    } catch {
      showError("Inbox scan failed")
    } finally {
      setScanning(false)
    }
  }

  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Payments received</h1>
        <div className="mt-[5px] text-[13.5px] text-[#6b6f73]">
          How clients pay you, and how the app spots payments as they land.
        </div>
      </div>

      {/* Methods you accept */}
      <div className="mb-[10px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#b3b6b9]">
        Methods you accept
      </div>
      <div className="rounded-[14px] border border-[#e9e9e6] bg-white px-[22px] py-5">
        <div className="flex flex-wrap gap-[9px]">
          {methods.map((m) => (
            <span
              key={m}
              className="group inline-flex items-center gap-[7px] rounded-full border border-[#d6e8de] bg-[#eef6f1] py-[9px] pl-[14px] pr-[10px] text-[13px] font-bold text-[#0b7a4e]"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              {m}
              <button
                type="button"
                aria-label={`Remove ${m}`}
                onClick={() => onMethodsChange(methods.filter((x) => x !== m))}
                className="ml-0.5 rounded-full p-0.5 text-[#0b7a4e]/50 transition-colors hover:bg-[#d6e8de] hover:text-[#b91c1c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7a4e]/30"
              >
                <X className="h-3 w-3" strokeWidth={2.6} />
              </button>
            </span>
          ))}

          {adding ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#0b7a4e] bg-white py-[7px] pl-[12px] pr-[8px]">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- focus follows the click that revealed this input */}
              <input
                autoFocus
                value={draftMethod}
                maxLength={MAX_METHOD_LENGTH}
                placeholder="e.g. Venmo"
                onChange={(e) => setDraftMethod(e.target.value)}
                onBlur={commitMethod}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitMethod()
                  } else if (e.key === "Escape") {
                    setDraftMethod("")
                    setAdding(false)
                  }
                }}
                className="w-[110px] bg-transparent text-[13px] font-bold text-[#0d0d0e] outline-none placeholder:font-semibold placeholder:text-[#aab2bd]"
              />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-[6px] rounded-full border border-dashed border-[#cfcfca] bg-white px-[14px] py-[9px] text-[13px] font-bold text-[#55585c] transition-colors hover:border-[#0b7a4e] hover:text-[#0b7a4e]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              Add method
            </button>
          )}
        </div>
        <div className="mt-[13px] text-[12px] text-[#7e8489]">
          Zelle is your primary method. Add others like Gusto or Venmo if certain clients prefer them.
        </div>
      </div>

      {/* Zelle auto-detection */}
      <div className="mb-[10px] mt-[26px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#b3b6b9]">
        Zelle auto-detection
      </div>
      <div className="rounded-[14px] border border-[#e9e9e6] bg-white px-[22px] py-[6px]">
        <div className="flex items-center gap-4 border-b border-[#f2f2ef] py-[17px]">
          <div className="flex-1">
            <div className="text-[14px] font-bold">Watch inbox for payments</div>
            <div className="mt-0.5 text-[12.5px] text-[#7e8489]">
              Reads your connected Gmail for Zelle deposit notices and matches them to open invoices.
            </div>
            {!gmail && (
              <div className="mt-1.5 text-[12px] font-semibold text-[#b0821f]">
                Requires Gmail — connect it under Invoice delivery.
              </div>
            )}
          </div>
          <Toggle
            checked={value.enableInboxSync}
            onChange={(v) => onChange({ enableInboxSync: v, ...(v ? {} : { autoConfirmHighConfidencePayments: false }) })}
            disabled={!gmail}
          />
        </div>
        <div className="flex items-center gap-4 py-[17px]">
          <div className="flex-1">
            <div className={`text-[14px] font-bold ${!gmail || !value.enableInboxSync ? "text-[#9aa0a4]" : ""}`}>
              Auto-confirm exact matches
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#7e8489]">
              Only when a known client&apos;s amount matches one open invoice exactly. Everything else waits for your
              review.
            </div>
            {gmail && !value.enableInboxSync && (
              <div className="mt-1.5 text-[12px] font-semibold text-[#b0821f]">
                Turn on “Watch inbox for payments” above to use this.
              </div>
            )}
            {!gmail && (
              <div className="mt-1.5 text-[12px] font-semibold text-[#b0821f]">
                Requires Gmail — connect it under Invoice delivery.
              </div>
            )}
          </div>
          <Toggle
            checked={value.autoConfirmHighConfidencePayments}
            onChange={(v) => onChange({ autoConfirmHighConfidencePayments: v })}
            disabled={!gmail || !value.enableInboxSync}
          />
        </div>
      </div>

      {/* Scan now */}
      <div className="mt-[14px] flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={scanNow}
          disabled={!canScan || scanning}
          className="inline-flex items-center gap-2 rounded-[9px] border border-[#e2e2df] bg-white px-4 py-[10px] text-[13px] font-bold text-[#55585c] transition-colors hover:bg-[#f7f7f5] disabled:opacity-50"
        >
          {scanning ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Search className="h-[15px] w-[15px]" />}
          {scanning ? "Scanning…" : "Scan inbox now"}
        </button>
        {!credsSet && gmail && (
          <span className="text-[12px] text-[#7e8489]">Add your Gmail App Password under Invoice delivery first.</span>
        )}
      </div>

      <div className="mt-[14px] flex items-start gap-[9px] rounded-[11px] border border-[#ededea] bg-[#f7f7f5] px-[15px] py-[13px] text-[12.5px] leading-relaxed text-[#7e8489]">
        <Info className="mt-px h-4 w-4 flex-none" />
        <span>
          Detected payments show up in <strong className="text-[#55585c]">Payables → Payments</strong>. This only spots
          them — you always confirm the money before an invoice is marked paid.
        </span>
      </div>
    </div>
  )
}
