"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { fetcher } from "@/lib/fetcher"
import { formatCurrency } from "@/lib/utils"
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

// ── Verdict ────────────────────────────────────────────────────────────────
// The plain-English "what's the story with this invoice this month" line — the
// single most useful thing to know at a glance, built from real candidate data
// (status + the same exceptions/line-items the rest of the workspace uses).
export type VerdictTone = "green" | "amber" | "blue" | "rose"
export interface Verdict { text: string; tone: VerdictTone }

export const VERDICT_TONE: Record<VerdictTone, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: "#ECFDF5", border: "#A7F3D0", text: "#047857", dot: "#10B981" },
  amber: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", dot: "#F59E0B" },
  blue: { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8", dot: "#0EA5E9" },
  rose: { bg: "#FFF1F2", border: "#FECDD3", text: "#BE123C", dot: "#F43F5E" },
}

export function buildVerdict(inv: WorkspaceInvoice): Verdict {
  if (inv.uiStatus === "Paid") return { text: "Paid in full — nothing left to do this month.", tone: "green" }
  if (inv.uiStatus === "Sent") return { text: "Sent — awaiting payment.", tone: "blue" }

  const counts: Record<string, number> = {}
  for (const e of inv.exceptions) counts[e.type] = (counts[e.type] || 0) + 1
  const proration = inv.lineItems.find((li) => li.sourceType === "PRORATION")
  const addOn = inv.lineItems.find((li) => li.sourceType === "ADD_ON" || li.sourceType === "RECURRING_ADD_ON")
  const isFlat = inv.billingType === "FLAT_RATE"
  const cleans = inv.completedCount || inv.jobCount

  // Lead with the most consequential change (the one that moved the dollar amount).
  if (counts.SKIPPED) {
    const n = counts.SKIPPED
    if (proration) {
      const credit = Math.abs(proration.price * proration.quantity)
      return { text: `${n} clean${n > 1 ? "s" : ""} missed — invoice credited ${formatCurrency(credit)}.`, tone: "amber" }
    }
    return { text: `${n} clean${n > 1 ? "s" : ""} missed — billed for ${cleans} of ${inv.jobCount}.`, tone: "amber" }
  }
  if (counts.ONE_TIME_ADD_ON || addOn) {
    const desc = addOn?.description?.replace(/\s*·.*$/, "") || "An add-on"
    const amt = addOn ? ` (+${formatCurrency(addOn.price * addOn.quantity)})` : ""
    return { text: `${desc} due this month${amt}, on top of the regular visits.`, tone: "amber" }
  }
  if (counts.PRICE_CHANGE) {
    const msg = inv.exceptions.find((e) => e.type === "PRICE_CHANGE")?.message
    return { text: msg ? msg[0].toUpperCase() + msg.slice(1) : "Rate changed this month — review before sending.", tone: "amber" }
  }
  if (counts.ONE_OFF_JOB) {
    const n = counts.ONE_OFF_JOB
    return { text: `${n} one-off job${n > 1 ? "s" : ""} added this month.`, tone: "amber" }
  }
  if (counts.RESCHEDULED) {
    const n = counts.RESCHEDULED
    return { text: `${n} clean${n > 1 ? "s" : ""} rescheduled — monthly total unchanged.`, tone: "amber" }
  }
  if (counts.MISSING_EMAIL) {
    return { text: "No email on file — add one before this can be sent.", tone: "rose" }
  }

  // Nothing flagged → steady month.
  if (isFlat) return { text: "Flat monthly rate, no changes since last month.", tone: "green" }
  if (inv.billingType === "ONE_TIME") return { text: "One-time clean, billed once.", tone: "green" }
  return { text: `${cleans} clean${cleans === 1 ? "" : "s"} this month at the usual rate — no changes.`, tone: "green" }
}

export function useWorkspace() {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [tab, setTab] = useState<WorkspaceTab>("All")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleCheckMany = (ids: string[]) =>
    setChecked((prev) => {
      const next = new Set(prev)
      const allIn = ids.length > 0 && ids.every((id) => next.has(id))
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)))
      return next
    })
  const clearChecked = () => setChecked(new Set())

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

  // Group by billing type (Flat Rate / Per Clean / One-Time); yellows-first then
  // alphabetical within each group. Status is shown per-item and filtered by tab.
  const groups = useMemo(() => {
    const labelOf = (i: WorkspaceInvoice) =>
      i.billingType === "FLAT_RATE" ? "Flat Rate" : i.billingType === "PER_CLEAN" ? "Per Clean" : "One-Time"
    const order = ["Flat Rate", "Per Clean", "One-Time"]
    return order
      .map((label) => {
        const items = filtered
          .filter((i) => labelOf(i) === label)
          .sort((a, b) => {
            if (a.verification.level !== b.verification.level) return a.verification.level === "yellow" ? -1 : 1
            return a.clientName.localeCompare(b.clientName)
          })
        return {
          label,
          items,
          total: items.reduce((s, i) => s + i.total, 0),
          yellowCount: items.filter((i) => i.verification.level === "yellow").length,
          notSentIds: items.filter((i) => i.uiStatus === "Not sent").map((i) => i.candidateId),
        }
      })
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

  // Manually checked invoices (only not-sent ones are sendable).
  const checkedList = useMemo(
    () => invoices.filter((i) => checked.has(i.candidateId) && i.uiStatus === "Not sent"),
    [invoices, checked],
  )

  return {
    month, setMonth,
    tab, setTab,
    search, setSearch,
    selectedId, setSelectedId,
    checked, toggleCheck, toggleCheckMany, clearChecked, checkedList,
    isLoading, error, mutate,
    invoices, totals, groups, verifiedReady, selected,
  }
}
