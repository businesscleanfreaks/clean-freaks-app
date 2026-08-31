"use client"

import { useState } from "react"
import Link from "next/link"
import { Building2, ChevronRight, Home } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

export interface ProfileVisit {
  id: string
  date: string
  status: string
  amount: number
  note: string | null
  paid: boolean
}

export interface ProfileAccount {
  id: string
  clientId: string
  clientName: string
  locationName: string
  propertyType: string | null
  frequency: string | null
  payType: "FLAT_RATE" | "PER_CLEAN"
  rate: number
  completedCount: number
  scheduledCount: number
  skippedCount: number
  allPaid: boolean
  owed: number
  visits: ProfileVisit[]
}

const FREQ: Record<string, string> = {
  WEEKLY: "Weekly",
  BI_WEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
  "2X_MONTHLY": "2x/month",
  "2X_WEEKLY": "Mon–Fri",
  "3X_WEEKLY": "3x/week",
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })

/**
 * The accounts this cleaner works, and what happened on each.
 *
 * Expanding one opens the reconciliation panel: how many visits were completed
 * against how many were scheduled, a calendar of the month, and the visit log.
 * The point is to answer "did this actually happen?" before paying for it.
 */
export function ProfileAccounts({ accounts, period }: {
  accounts: ProfileAccount[]
  period: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const monthly = accounts.reduce((s, a) => s + (a.payType === "FLAT_RATE" ? a.rate : 0), 0)
  const [y, m] = period.split("-").map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstWeekday = new Date(y, m - 1, 1).getDay()

  return (
    <div className="overflow-hidden rounded-[12px] border border-[#ececea] bg-white"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }}>
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="flex w-full items-center gap-2.5 border-b border-[#f0f0ed] px-5 py-3.5 text-left"
      >
        <ChevronRight
          size={14}
          strokeWidth={2.6}
          className="flex-none text-[#8a8f93] transition-transform"
          style={{ transform: collapsed ? "none" : "rotate(90deg)" }}
        />
        <span className="text-[14px] font-extrabold">Accounts</span>
        <span className="text-[12px] font-semibold text-[#9a9fa4]">
          {accounts.length} account{accounts.length === 1 ? "" : "s"}
          {monthly > 0 && ` · ${formatCurrency(monthly)} /mo`}
        </span>
      </button>

      {!collapsed && accounts.length === 0 && (
        <div className="px-5 py-10 text-center text-[13px] text-[#8a8f93]">
          No recurring accounts this month.
        </div>
      )}

      {!collapsed && accounts.map(a => {
        const isOpen = open === a.id
        const residential = a.propertyType === "RESIDENTIAL"
        const extra = a.visits.filter(v => v.status === "COMPLETED").length - a.completedCount
        return (
          <div key={a.id} className="border-b border-[#f6f6f3] last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : a.id)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#fbfcfb]"
            >
              <span
                className="grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px]"
                style={residential ? { background: "#eef4ff", color: "#2a6fdb" } : { background: "#eaf5ee", color: "#0b7a4e" }}
              >
                {residential ? <Home size={13} /> : <Building2 size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold">{a.clientName}</span>
                <span className="block truncate text-[11px] text-[#9a9fa4]">
                  {residential ? "Residential" : "Commercial"}
                  {a.locationName && a.locationName !== a.clientName ? ` · ${a.locationName}` : ""}
                </span>
              </span>
              <span className="w-[92px] flex-none text-[12px] text-[#6b6f73]">
                {a.frequency ? FREQ[a.frequency] ?? a.frequency : "—"}
              </span>
              <span className="w-[96px] flex-none text-[12px] text-[#6b6f73]">
                {a.payType === "FLAT_RATE" ? "Monthly flat" : `${formatCurrency(a.rate)} / clean`}
              </span>
              <span
                className="w-max flex-none rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
                style={a.allPaid
                  ? { background: "#eaf5ee", color: "#2f6b47" }
                  : { background: "#fdf6ea", color: "#8a5e12" }}
              >
                {a.allPaid ? "Paid" : "Owe now"}
              </span>
              <span className="w-[92px] flex-none text-right text-[13px] font-extrabold tabular-nums">
                {formatCurrency(a.allPaid ? a.rate : a.owed)}
                <span className="block text-[10px] font-semibold text-[#9a9fa4]">
                  {a.completedCount} clean{a.completedCount === 1 ? "" : "s"}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-[#f6f6f3] bg-[#fdfdfb] px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-bold text-[#2f6b47]">
                    ✓ {a.completedCount} of {a.scheduledCount} visits completed
                  </span>
                  {a.skippedCount > 0 && (
                    <span className="rounded-full bg-[#f2f4f6] px-2.5 py-0.5 text-[11px] font-semibold text-[#667085]">
                      {a.skippedCount} skipped by client
                    </span>
                  )}
                  {extra > 0 && (
                    <span className="rounded-full bg-[#fbf3d9] px-2.5 py-0.5 text-[11px] font-semibold text-[#a16207]">
                      {extra} extra
                    </span>
                  )}
                  <Link
                    href={`/calendar?client=${encodeURIComponent(a.clientId)}`}
                    className="ml-auto text-[11.5px] font-bold text-[#0b7a4e] hover:underline"
                  >
                    Edit schedule on calendar →
                  </Link>
                </div>

                {/* Which days were serviced, at a glance. */}
                <div className="mt-3 max-w-[280px]">
                  <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-[#b6bbc0]">
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {Array.from({ length: firstWeekday }, (_, i) => <span key={`pad${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1
                      const visit = a.visits.find(v => new Date(v.date).getDate() === day)
                      const done = visit?.status === "COMPLETED"
                      const skipped = visit?.status === "CANCELLED"
                      return (
                        <span
                          key={day}
                          title={visit ? `${dayLabel(visit.date)} · ${visit.status.toLowerCase()}` : undefined}
                          className="grid h-6 place-items-center rounded-[6px] text-[10.5px] font-semibold tabular-nums"
                          style={
                            done
                              ? { background: "#15793f", color: "#fff" }
                              : skipped
                                ? { background: "#f2f4f6", color: "#b6bbc0", textDecoration: "line-through" }
                                : { color: "#c2c5c8" }
                          }
                        >
                          {day}
                        </span>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex gap-3 text-[10px] font-semibold text-[#9a9fa4]">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: "#15793f" }} /> Serviced
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: "#d5d8dc" }} /> Skipped
                    </span>
                  </div>
                </div>

                <div className="mt-3.5 max-h-[300px] overflow-y-auto">
                  {a.visits.map(v => (
                    <div key={v.id} className="flex items-center gap-2.5 border-b border-[#f6f6f3] py-1.5 last:border-b-0">
                      <span className="w-[92px] flex-none text-[11.5px] font-semibold tabular-nums text-[#6b6f73]">
                        {dayLabel(v.date)}
                      </span>
                      <span
                        className="h-[7px] w-[7px] flex-none rounded-full"
                        style={{ background: v.status === "COMPLETED" ? "#15793f" : v.status === "CANCELLED" ? "#d5d8dc" : "#e2e5e9" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#6b6f73]">
                        {v.note || (v.status === "CANCELLED" ? "Skipped by client" : "")}
                      </span>
                      <span className="flex-none text-[11.5px] font-bold tabular-nums"
                        style={{ color: v.paid ? "#b6bbc0" : "#3f4347" }}>
                        {v.amount > 0 ? formatCurrency(v.amount) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
