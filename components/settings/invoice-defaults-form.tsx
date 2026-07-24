"use client"

import { Home, Building2, Info } from "lucide-react"
import type { InvoiceDefaultsData } from "@/lib/invoice-defaults"

const RESIDENTIAL_TERMS: { value: string; label: string }[] = [
  { value: "DUE_ON_RECEIPT", label: "Due now" },
  { value: "NET_7", label: "Net 7" },
  { value: "NET_14", label: "Net 14" },
]
const COMMERCIAL_TERMS: { value: string; label: string }[] = [
  { value: "NET_15", label: "Net 15" },
  { value: "NET_30", label: "Net 30" },
  { value: "MONTH_END", label: "Month-end" },
]

interface Props {
  value: InvoiceDefaultsData
  onChange: (patch: Partial<InvoiceDefaultsData>) => void
}

function Segmented({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="inline-flex flex-none gap-0.5 rounded-[10px] bg-[#f2f2ef] p-[3px]">
      {options.map((opt) => {
        const active = selected === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`rounded-[8px] px-[13px] py-2 text-[12.5px] font-bold transition-colors ${
              active ? "bg-white text-[#0d0d0e] shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "bg-transparent text-[#8a8f93]"
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export function InvoiceDefaultsForm({ value, onChange }: Props) {
  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Invoice defaults</h1>
        <div className="mt-[5px] text-[13.5px] text-[#6b6f73]">
          Applied to every new invoice. You can still change any of these on an individual invoice.
        </div>
      </div>

      <div className="rounded-[14px] border border-[#e9e9e6] bg-white px-6 py-[6px]">
        {/* Payment terms */}
        <div className="border-b border-[#f2f2ef] py-[17px]">
          <div className="text-[14px] font-bold">Payment terms</div>
          <div className="mt-0.5 text-[12.5px] text-[#7e8489]">
            When an invoice is due after it&apos;s sent. Residential and commercial clients pay on different schedules,
            so each has its own default.
          </div>
          <div className="mt-[15px] flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-[14px]">
              <div className="flex min-w-[180px] flex-1 items-center gap-[10px]">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-[#eef4ff] text-[#2a6fdb]">
                  <Home className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[13.5px] font-bold">Residential</div>
                  <div className="mt-px text-[11.5px] text-[#7e8489]">Homes &amp; one-off cleans · usually pay fast</div>
                </div>
              </div>
              <Segmented
                options={RESIDENTIAL_TERMS}
                selected={value.residentialPaymentTerms}
                onSelect={(v) => onChange({ residentialPaymentTerms: v })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-[14px]">
              <div className="flex min-w-[180px] flex-1 items-center gap-[10px]">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-[#eef6f1] text-[#0f8a6e]">
                  <Building2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[13.5px] font-bold">Commercial</div>
                  <div className="mt-px text-[11.5px] text-[#7e8489]">Recurring accounts · billed on terms</div>
                </div>
              </div>
              <Segmented
                options={COMMERCIAL_TERMS}
                selected={value.commercialPaymentTerms}
                onSelect={(v) => onChange({ commercialPaymentTerms: v })}
              />
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="py-[17px]">
          <div className="text-[14px] font-bold">Invoice footer note</div>
          <div className="mb-[11px] mt-0.5 text-[12.5px] text-[#7e8489]">Shown at the bottom of every invoice.</div>
          <textarea
            rows={2}
            className="w-full resize-y rounded-[9px] border border-[#dededa] bg-white px-[13px] py-[11px] text-[14px] leading-relaxed outline-none transition-colors focus:border-[#0b7a4e] focus:ring-2 focus:ring-[#0b7a4e]/15"
            placeholder="Thank you for your business!"
            value={value.invoiceFooterNote ?? ""}
            onChange={(e) => onChange({ invoiceFooterNote: e.target.value })}
          />
        </div>
      </div>

      {/* Deferred controls */}
      <div className="mt-[14px] flex items-start gap-[9px] rounded-[11px] border border-[#ededea] bg-[#f7f7f5] px-[15px] py-[13px] text-[12.5px] leading-relaxed text-[#7e8489]">
        <Info className="mt-px h-4 w-4 flex-none" />
        <span>Default tax rate and automatic late reminders are coming soon.</span>
      </div>
    </div>
  )
}
