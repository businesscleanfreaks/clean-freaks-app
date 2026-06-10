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

interface PayablesData {
  cleaners: Payable[]
  vendors: Payable[]
  totals: {
    cleaners: { total: number; safe: number; waiting: number }
    vendors: { total: number; safe: number; waiting: number }
  }
}

export function usePayables() {
  const { data, isLoading, error, mutate } = useSWR<PayablesData>("/api/payables/data", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  })
  const [tab, setTab] = useState<PayablesTab>("cleaners")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const cleaners = data?.cleaners || []
  const vendors = data?.vendors || []
  const list = tab === "cleaners" ? cleaners : vendors
  const totals = (tab === "cleaners" ? data?.totals.cleaners : data?.totals.vendors) || { total: 0, safe: 0, waiting: 0 }

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
  }
}
