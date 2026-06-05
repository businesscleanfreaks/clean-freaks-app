"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { fetcher } from "@/lib/fetcher"
import { deriveVerification, type InvoiceVerification } from "@/lib/invoice-verification"
import type { InvoiceCandidate } from "@/components/invoices/candidate-card"

export type WorkspaceTab = "All" | "Not sent" | "Sent" | "Paid"

export interface WorkspaceInvoice extends InvoiceCandidate {
  verification: InvoiceVerification
  uiStatus: "Not sent" | "Sent" | "Paid"
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function toUiStatus(status: string): WorkspaceInvoice["uiStatus"] {
  if (status === "SENT") return "Sent"
  if (status === "PAID") return "Paid"
  return "Not sent" // READY | NEEDS_ATTENTION | DRAFT_EXISTS
}

// Short reason chip for yellow rows (specific, never a truncating sentence).
export function shortReason(inv: WorkspaceInvoice): string | null {
  if (inv.verification.level === "green") return null
  const counts: Record<string, number> = {}
  for (const e of inv.exceptions) counts[e.type] = (counts[e.type] || 0) + 1
  const parts: string[] = []
  if (counts.SKIPPED) parts.push(`${counts.SKIPPED} cancelled`)
  if (counts.PRICE_CHANGE) parts.push("Rate change")
  if (counts.ONE_TIME_ADD_ON) parts.push(`${counts.ONE_TIME_ADD_ON} add-on${counts.ONE_TIME_ADD_ON > 1 ? "s" : ""}`)
  if (counts.ONE_OFF_JOB) parts.push(`${counts.ONE_OFF_JOB} one-off`)
  if (counts.RESCHEDULED) parts.push("Rescheduled")
  if (counts.MISSING_EMAIL && parts.length === 0) parts.push("No email")
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return `${parts.length} changes`
}

export function useWorkspace() {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [tab, setTab] = useState<WorkspaceTab>("All")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const range = useMemo(() => {
    const [y, m] = month.split("-").map(Number)
    const d = new Date(y, m - 1, 1)
    return {
      start: format(startOfMonth(d), "yyyy-MM-dd"),
      end: format(endOfMonth(d), "yyyy-MM-dd"),
    }
  }, [month])

  const { data, isLoading, error, mutate } = useSWR(
    `/api/invoices/candidates?start=${range.start}&end=${range.end}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 },
  )

  const invoices: WorkspaceInvoice[] = useMemo(() => {
    const raw: InvoiceCandidate[] = data?.candidates || []
    return raw.map((c) => ({
      ...c,
      verification: deriveVerification(c),
      uiStatus: toUiStatus(c.status),
    }))
  }, [data])

  const totals = useMemo(() => {
    const t = { notSent: 0, sent: 0, paid: 0 }
    for (const inv of invoices) {
      if (inv.uiStatus === "Not sent") t.notSent += inv.total
      else if (inv.uiStatus === "Sent") t.sent += inv.total
      else t.paid += inv.total
    }
    return t
  }, [invoices])

  // Tab + search filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (tab !== "All" && inv.uiStatus !== tab) return false
      if (q && !inv.clientName.toLowerCase().includes(q)) return false
      return true
    })
  }, [invoices, tab, search])

  // Group by status, yellows-first then alphabetical within each group.
  const groups = useMemo(() => {
    const order: WorkspaceInvoice["uiStatus"][] = ["Not sent", "Sent", "Paid"]
    return order
      .map((status) => ({
        status,
        items: filtered
          .filter((i) => i.uiStatus === status)
          .sort((a, b) => {
            if (a.verification.level !== b.verification.level) {
              return a.verification.level === "yellow" ? -1 : 1
            }
            return a.clientName.localeCompare(b.clientName)
          }),
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  // Count of verified (green, not-sent) ready to batch send.
  const verifiedReady = useMemo(
    () => invoices.filter((i) => i.uiStatus === "Not sent" && i.verification.level === "green"),
    [invoices],
  )

  const selected = useMemo(
    () => filtered.find((i) => i.candidateId === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  )

  return {
    month, setMonth,
    tab, setTab,
    search, setSearch,
    selectedId, setSelectedId,
    isLoading, error, mutate,
    invoices, totals, groups, verifiedReady, selected,
  }
}
