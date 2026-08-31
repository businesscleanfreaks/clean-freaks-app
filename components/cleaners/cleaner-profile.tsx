"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
import { avatarColor, initialsOf } from "@/lib/avatar-palette"
import { ProfileAccounts, type ProfileAccount } from "./profile-accounts"
import { ProfileSidebar, type ProfileContact, type ProfileTax } from "./profile-sidebar"

interface OneOff {
  id: string
  date: string
  clientName: string
  note: string | null
  amount: number
  paid: boolean
}

interface Payment {
  id: string
  date: string
  amount: number
  method: string
  notes: string | null
}

interface ProfileData {
  cleaner: {
    id: string
    name: string
    email: string | null
    phone: string | null
    isActive: boolean
    since: string
    payByDay: number
    notes: string | null
  }
  accounts: ProfileAccount[]
  oneOffs: OneOff[]
  payments: Payment[]
  contacts: ProfileContact[]
  tax: ProfileTax
  owedNow: number
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const monthLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number)
  return `${FULL_MONTHS[m - 1]} ${y}`
}
const shift = (p: string, by: number) => {
  const [y, m] = p.split("-").map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
const thisMonth = () => new Date().toISOString().slice(0, 7)
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })

const CARD = "rounded-[12px] border border-[#ececea] bg-white"
const SHADOW = { boxShadow: "0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.05)" }
const LABEL = "text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#7e8489]"

/** One cleaner: what they work, what they are owed, and who they are. */
export function CleanerProfile({ cleanerId }: { cleanerId: string }) {
  const [period, setPeriod] = useState(thisMonth())
  const { data, isLoading, mutate } = useSWR<ProfileData>(
    `/api/cleaners/${cleanerId}/profile?period=${period}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-[#98a2b3]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const { cleaner, accounts, oneOffs, payments, contacts, tax, owedNow } = data
  const color = avatarColor(cleaner.name)
  const first = cleaner.name.split(/\s+/)[0]
  const since = new Date(cleaner.since).toLocaleDateString("en-US", { month: "short", year: "numeric" })

  /**
   * The payment list as a spreadsheet. Built in the browser from what is
   * already on screen, so it always matches the range being looked at.
   */
  const downloadCsv = () => {
    const rows = [
      ["Account", "Detail", "Amount", "Status"],
      ...accounts.map(a => [
        a.clientName,
        `${a.completedCount} of ${a.scheduledCount} visits`,
        a.allPaid ? a.rate.toFixed(2) : a.owed.toFixed(2),
        a.allPaid ? "Paid" : "Owe now",
      ]),
      ...oneOffs.map(o => [
        o.clientName,
        `One-off · ${shortDate(o.date)}${o.note ? ` · ${o.note}` : ""}`,
        o.amount.toFixed(2),
        o.paid ? "Paid" : "Owe now",
      ]),
      ["", "Period total", owedNow.toFixed(2), ""],
    ]
    const csv = rows
      .map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${cleaner.name.replace(/[^\w-]+/g, "-")}-${monthLabel(period).replace(" ", "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <Link
        href="/cleaners"
        className="inline-flex items-center gap-[5px] text-[12.5px] font-semibold text-[#6b7480] hover:text-[#0d0d0e]"
      >
        <ChevronLeft size={14} strokeWidth={2.2} /> Cleaners
      </Link>

      <div className="mt-2 flex items-start gap-4">
        <span
          className="grid h-16 w-16 flex-none place-items-center rounded-[18px] text-[20px] font-extrabold"
          style={{ background: color.bg, color: color.fg }}
        >
          {initialsOf(cleaner.name)}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[27px] font-extrabold leading-tight tracking-[-0.02em]">{cleaner.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[#7e8489]">
            <span className="rounded-full bg-[#eaf5ee] px-2.5 py-0.5 text-[11px] font-bold text-[#2f6b47]">
              Cleaner
            </span>
            <span>{accounts.length} recurring account{accounts.length === 1 ? "" : "s"}</span>
            <span>· Since {since}</span>
          </div>
        </div>

        <div className="flex-none text-right">
          <div className={LABEL}>Owed to {first} now</div>
          <div className="mt-1 text-[28px] font-extrabold tabular-nums text-[#0b7a4e]">
            {formatCurrency(owedNow)}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPeriod(p => shift(p, -1))}
            aria-label="Previous month"
            className="grid h-6 w-6 place-items-center rounded-[7px] border border-[#e2e2df] bg-white text-[#6b6f73] hover:bg-[#f6f6f3]"
          >
            <ChevronLeft size={12} strokeWidth={2.6} />
          </button>
          <span className="min-w-[112px] text-center text-[13.5px] font-bold text-[#3f4347]">
            {monthLabel(period)}
          </span>
          <button
            type="button"
            onClick={() => setPeriod(p => shift(p, 1))}
            disabled={period >= thisMonth()}
            aria-label="Next month"
            className="grid h-6 w-6 place-items-center rounded-[7px] border border-[#e2e2df] bg-white text-[#6b6f73] hover:bg-[#f6f6f3] disabled:opacity-30"
          >
            <ChevronRight size={12} strokeWidth={2.6} />
          </button>
        </div>

        <span className="ml-auto text-[12px] font-semibold text-[#7e8489]">
          Download {first}&rsquo;s payment list for {monthLabel(period)}:
        </span>
        <button
          type="button"
          onClick={downloadCsv}
          title="Download as a spreadsheet"
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e2e2df] bg-white px-3 py-1.5 text-[12px] font-bold text-[#3f4347] hover:bg-[#f6f6f3]"
        >
          <FileSpreadsheet size={13} /> Spreadsheet
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          title="Print or save as PDF"
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e2e2df] bg-white px-3 py-1.5 text-[12px] font-bold text-[#3f4347] hover:bg-[#f6f6f3]"
        >
          <FileText size={13} /> PDF
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <ProfileAccounts accounts={accounts} period={period} />

          <div className={CARD} style={SHADOW}>
            <div className="border-b border-[#f0f0ed] px-5 py-3">
              <span className={LABEL}>One-off jobs &amp; trials</span>
            </div>
            {oneOffs.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12.5px] text-[#8a8f93]">
                No one-off jobs in {monthLabel(period)}.
              </div>
            ) : (
              oneOffs.map(o => (
                <div key={o.id} className="flex items-center gap-3 border-b border-[#f6f6f3] px-5 py-2.5 last:border-b-0">
                  <span className="w-[60px] flex-none text-[11.5px] font-semibold tabular-nums text-[#6b6f73]">
                    {shortDate(o.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{o.clientName}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#9a9fa4]">{o.note}</span>
                  <span className="flex-none text-[12.5px] font-bold tabular-nums">{formatCurrency(o.amount)}</span>
                  <span
                    className="w-[64px] flex-none text-right text-[11px] font-bold"
                    style={{ color: o.paid ? "#2f6b47" : "#8a5e12" }}
                  >
                    {o.paid ? "Paid" : "Owe now"}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className={CARD} style={SHADOW}>
            <div className="border-b border-[#f0f0ed] px-5 py-3">
              <span className={LABEL}>Payments sent</span>
            </div>
            {payments.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12.5px] text-[#8a8f93]">
                No payments logged yet.
              </div>
            ) : (
              payments.map(p => (
                <div key={p.id} className="flex items-center gap-3 border-b border-[#f6f6f3] px-5 py-2.5 last:border-b-0">
                  <span className="w-[70px] flex-none text-[11.5px] font-semibold tabular-nums text-[#6b6f73]">
                    {shortDate(p.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#6b6f73]">
                    {p.notes || "—"}
                  </span>
                  <span className="w-[80px] flex-none text-[11.5px] capitalize text-[#9a9fa4]">
                    {p.method.toLowerCase()}
                  </span>
                  <span className="flex-none text-[12.5px] font-bold tabular-nums">{formatCurrency(p.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <ProfileSidebar
          cleanerId={cleanerId}
          contacts={contacts}
          tax={tax}
          notes={cleaner.notes}
          email={cleaner.email}
          phone={cleaner.phone}
          onChanged={() => mutate()}
        />
      </div>
    </div>
  )
}
