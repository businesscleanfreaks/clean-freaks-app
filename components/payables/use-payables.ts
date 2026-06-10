"use client"

import useSWR from "swr"
import { useMemo, useState } from "react"
import { fetcher } from "@/lib/fetcher"

export type AccountStatus = "safe" | "waiting" | "partial"
export type PayablesTab = "cleaners" | "vendors"

export interface PayableAccount {
  id: string
  clientName: string
  owed: number
  safeOwed: number
  waitingOwed: number
  status: AccountStatus
  reason: string
  payType: string
  payableItemIds: string[]
  allItemIds: string[]
  cleans: Array<{ date: string; amount: number }>
}

export interface Payable {
  id: string
  type: "cleaner" | "vendor"
  name: string
  initials: string
  zelleEmail: string | null
  contactPhone: string | null
  accounts: PayableAccount[]
  total: number
  safe: number
  waiting: number
}

export interface PaidEntry {
  paymentId: string
  name: string
  initials: string
  amount: number
  datePaid: string
  notes: string | null
}

interface PayablesData {
  cleaners: Payable[]
  vendors: Payable[]
  totals: {
    cleaners: { total: number; safe: number; waiting: number }
    vendors: { total: number; safe: number; waiting: number }
  }
  period: string
  isCurrent: boolean
  paid: { cleaners: PaidEntry[]; vendors: PaidEntry[]; total: number }
}

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function usePayables() {
  const [month, setMonth] = useState(thisMonth)
  const { data, isLoading, error, mutate } = useSWR<PayablesData>(`/api/payables/data?period=${month}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  })
  const [tab, setTab] = useState<PayablesTab>("cleaners")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const cleaners = data?.cleaners || []
  const vendors = data?.vendors || []
  const list = tab === "cleaners" ? cleaners : vendors
  const totals = (tab === "cleaners" ? data?.totals.cleaners : data?.totals.vendors) || { total: 0, safe: 0, waiting: 0 }
  const isCurrent = data?.isCurrent ?? month === thisMonth()
  const paid = data?.paid || { cleaners: [], vendors: [], total: 0 }
  const paidForTab: PaidEntry[] = tab === "cleaners" ? paid.cleaners : paid.vendors

  const shiftMonth = (delta: number) =>
    setMonth((m) => {
      const [y, mo] = m.split("-").map(Number)
      const d = new Date(y, mo - 1 + delta, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    })

  const selected = useMemo(
    () => list.find((p) => p.id === selectedId) || list[0] || null,
    [list, selectedId],
  )

  return {
    isLoading,
    error,
    mutate,
    tab,
    setTab,
    selectedId,
    setSelectedId,
    cleaners,
    vendors,
    list,
    totals,
    selected,
    counts: { cleaners: cleaners.length, vendors: vendors.length },
    month,
    setMonth,
    shiftMonth,
    isCurrent,
    paid,
    paidForTab,
  }
}
