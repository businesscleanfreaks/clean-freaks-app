"use client"

import { useEffect, useState } from "react"
import { FileText, Info, Download, Loader2, Clock, AlertTriangle } from "lucide-react"

interface Summary {
  year: number
  cleanerCount: number
  over600Count: number
  approachingCount: number
  totalPaid: number
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)

export function PayoutsForm() {
  const currentYear = new Date().getFullYear()
  const years = [currentYear, currentYear - 1, currentYear - 2]
  const [year, setYear] = useState(currentYear)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/settings/payouts/1099?year=${year}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSummary(d.summary ?? null)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const exportCsv = () => {
    // The response is Content-Disposition: attachment, so this downloads without navigating.
    window.location.href = `/api/settings/payouts/1099?year=${year}&format=csv`
  }

  return (
    <div>
      <div className="mb-[26px]">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em]">Payouts &amp; 1099s</h1>
        <div className="mt-[5px] text-[13.5px] text-[#6b6f73]">
          Defaults for paying your subcontractors and staying tax-ready.
        </div>
      </div>

      {/* When cleaners get paid — set per cleaner (see profile) */}
      <div className="mb-[10px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#b3b6b9]">
        When cleaners get paid
      </div>
      <div className="flex items-center gap-[14px] rounded-[14px] border border-[#e9e9e6] bg-white px-[22px] py-[18px]">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#eef6f1] text-[#0b7a4e]">
          <Clock className="h-5 w-5" />
        </span>
        <div className="text-[13px] leading-relaxed text-[#6b6f73]">
          Each cleaner&apos;s payout timing (immediate, after the client pays, end of month, …) is set on{" "}
          <strong className="text-[#55585c]">their profile</strong>, since it varies per person.
        </div>
      </div>

      {/* 1099 totals */}
      <div className="mb-[10px] mt-[26px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#b3b6b9]">
        1099 totals for tax season
      </div>
      <div className="rounded-[14px] border border-[#e9e9e6] bg-white px-[22px] py-5">
        <div className="flex flex-wrap items-center gap-[14px]">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#eef6f1] text-[#0b7a4e]">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-[180px] flex-1">
            <div className="text-[14px] font-bold">1099 totals · {year}</div>
            <div className="mt-0.5 text-[12.5px] text-[#7e8489]">
              One file showing what you paid each cleaner in {year}. Hand it to your accountant — done.
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-[9px] border border-[#dededa] bg-white px-[11px] py-[9px] text-[13px] font-semibold text-[#0d0d0e] outline-none focus:border-[#0b7a4e]"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-[9px] border border-[#e2e2df] bg-white px-4 py-[9px] text-[13px] font-bold text-[#55585c] transition-colors hover:bg-[#f7f7f5]"
            >
              <Download className="h-[15px] w-[15px]" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Readiness summary */}
        <div className="mt-4 border-t border-[#f2f2ef] pt-4 text-[12.5px]">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-[#7e8489]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking {year} totals…
            </span>
          ) : summary && summary.cleanerCount > 0 ? (
            <div className="flex flex-col gap-1.5">
              {summary.over600Count > 0 ? (
                <div className="inline-flex items-center gap-2 font-semibold text-[#b0821f]">
                  <AlertTriangle className="h-4 w-4 flex-none" />
                  {summary.over600Count} cleaner{summary.over600Count === 1 ? "" : "s"} crossed $600 in {year} — collect a
                  W-9.
                </div>
              ) : (
                <div className="text-[#6b6f73]">No cleaner has crossed $600 in {year} yet.</div>
              )}
              <div className="text-[#7e8489]">
                {summary.cleanerCount} cleaner{summary.cleanerCount === 1 ? "" : "s"} paid · {money(summary.totalPaid)}{" "}
                total{summary.approachingCount > 0 ? ` · ${summary.approachingCount} approaching $600` : ""}
              </div>
            </div>
          ) : (
            <div className="text-[#7e8489]">No cleaner payments recorded for {year}.</div>
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="mt-[14px] flex items-start gap-[9px] rounded-[11px] border border-[#ededea] bg-[#f7f7f5] px-[15px] py-[13px] text-[12.5px] leading-relaxed text-[#7e8489]">
        <Info className="mt-px h-4 w-4 flex-none" />
        <span>
          A cleaner&apos;s own W-9, pay method, and rate live on <strong className="text-[#55585c]">their profile</strong>{" "}
          — not here — since they differ per person.
        </span>
      </div>
    </div>
  )
}
