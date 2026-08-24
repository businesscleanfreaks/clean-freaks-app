"use client"

import useSWR from "swr"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Check, Loader2, Mail } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import type { RecipientAuditRow } from "@/lib/recipient-audit"

interface AuditResponse {
  rows: RecipientAuditRow[]
  outstanding: number
  total: number
}

const STATE_STYLE = {
  missing: { bg: "#fdecec", color: "#a93a3a", label: "No email" },
  fallback: { bg: "#fdf6ea", color: "#8a5e12", label: "Using general contact" },
  designated: { bg: "#eaf5ee", color: "#2f6b47", label: "Set" },
} as const

/**
 * The worklist for designating who receives each client's invoice.
 *
 * Josh is going through these by hand rather than having them backfilled, so
 * this is a checklist, not an automation: worst first, each row saying what an
 * invoice would do today, linking straight to where it gets fixed.
 */
export function RecipientWorklist() {
  const { data, isLoading } = useSWR<AuditResponse>("/api/clients/recipient-audit", fetcher, {
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#98a2b3]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const rows = data?.rows ?? []
  const outstanding = data?.outstanding ?? 0
  const done = outstanding === 0 && rows.length > 0

  return (
    <div>
      <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Invoice recipients</h1>
      <p className="mb-5 mt-1.5 text-[13.5px] text-[#667085]">
        Who each client&rsquo;s invoice is addressed to. Clients without one fall back to their
        general contact, which may not be the person who pays.
      </p>

      <div
        className="mb-5 flex items-center gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px]"
        style={
          done
            ? { background: "#eaf5ee", border: "1px solid #cfe7d8", color: "#2f6b47" }
            : { background: "#fdf6ea", border: "1px solid #f0e0c0", color: "#8a5e12" }
        }
      >
        {done ? <Check size={16} /> : <AlertTriangle size={16} />}
        <span className="font-semibold">
          {done
            ? `All ${data?.total} clients have an invoice recipient set.`
            : `${outstanding} of ${data?.total} clients still need one.`}
        </span>
      </div>

      <div className="overflow-hidden rounded-[13px] border border-[#e4e7ec] bg-white">
        {rows.map(row => {
          const style = STATE_STYLE[row.state]
          return (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(160px,1fr)_160px_minmax(180px,1fr)_88px] items-center gap-3 border-b border-[#f4f5f7] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-bold text-[#101828]">{row.name}</div>
                <div className="mt-px truncate text-[11.5px] text-[#7d8795]">{row.note}</div>
              </div>

              <span
                className="w-max rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
                style={{ background: style.bg, color: style.color }}
              >
                {style.label}
              </span>

              <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[#475467]">
                {row.effectiveEmail ? (
                  <>
                    <Mail size={12} className="flex-none text-[#98a2b3]" />
                    <span className="truncate">
                      {row.effectiveContactName ? `${row.effectiveContactName} · ` : ""}
                      {row.effectiveEmail}
                    </span>
                  </>
                ) : (
                  <span className="text-[#a93a3a]">Cannot be invoiced</span>
                )}
              </div>

              <Link
                href={`/clients/${row.id}?tab=billing`}
                className="inline-flex items-center justify-end gap-1 text-[12px] font-bold text-[#15793f]"
              >
                {row.state === "designated" ? "Review" : "Set"} <ArrowRight size={12} />
              </Link>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="px-4 py-14 text-center text-[13px] text-[#7d8795]">No active clients.</div>
        )}
      </div>
    </div>
  )
}
