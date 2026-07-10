"use client"

import { format, isSameMonth } from "date-fns"
import { Plus, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import type { KeyedMutator } from "swr"
import { showError, showSuccess } from "@/lib/toast"

export interface ProjectedExpenses {
  software: number
  insurance: number
  marketing: number
  mistakes: number
  freelancers: number
  miscellaneous: number
}

export interface ExpenseRow {
  id: string
  date: string
  amount: number
  description: string
  category: string | null
  type: string | null
  vendor: string | null
  notes: string | null
  isRecurring: boolean
}

export interface ExpenseData {
  expenses: ExpenseRow[]
  months: Array<{ key: string; label: string; total: number }>
  total: number
  period: string
}

const projectedFields: Array<{ key: keyof ProjectedExpenses; label: string }> = [
  { key: "software", label: "Software" },
  { key: "insurance", label: "Insurance" },
  { key: "marketing", label: "Marketing" },
  { key: "mistakes", label: "Mistakes" },
  { key: "freelancers", label: "Freelancers" },
  { key: "miscellaneous", label: "Miscellaneous" },
]

const categories = [
  ["SOFTWARE_SUBSCRIPTIONS", "Software"],
  ["INSURANCE", "Insurance"],
  ["MARKETING_ADVERTISING", "Marketing"],
  ["PROFESSIONAL_FEES", "Professional fees"],
  ["CLEANING_SUPPLIES", "Cleaning supplies"],
  ["OFFICE_SUPPLIES", "Office supplies"],
  ["UTILITIES", "Utilities"],
  ["PHONE_INTERNET", "Phone & internet"],
  ["EQUIPMENT", "Equipment"],
  ["VEHICLE_FUEL", "Vehicle & fuel"],
  ["OTHER", "Miscellaneous"],
] as const

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

interface ModalProps {
  open: boolean
  onClose: () => void
}

function ModalShell({ open, onClose, children, width = "max-w-[446px]" }: ModalProps & { children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`relative max-h-[calc(100dvh-32px)] w-full ${width} overflow-hidden rounded-lg bg-white shadow-2xl`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center text-stone-400 hover:text-stone-700"
          aria-label="Close"
        >
          <X size={19} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ProjectedExpensesModal({
  open,
  onClose,
  values,
  actualAverage,
  onSave,
}: ModalProps & {
  values: ProjectedExpenses
  actualAverage: number
  onSave: (values: ProjectedExpenses) => Promise<void>
}) {
  const [draft, setDraft] = useState(values)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(values), [values, open])
  const total = Object.values(draft).reduce((sum, value) => sum + (Number(value) || 0), 0)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose}>
      <div className="px-6 pb-5 pt-6">
        <h2 className="text-[19px] font-extrabold text-stone-900">Projected expenses</h2>
        <p className="mt-0.5 pr-8 text-[13px] leading-snug text-stone-500">Expected monthly spend by category / sets projected Net Profit</p>

        <div className="mt-6 divide-y divide-stone-100">
          {projectedFields.map((field) => (
            <label key={field.key} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-[14px] font-semibold text-stone-800">{field.label}</span>
              <span className="flex h-10 w-[132px] items-center rounded-lg border border-stone-200 bg-white px-3 focus-within:border-teal-600">
                <span className="text-[13px] font-semibold text-stone-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft[field.key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: Math.max(0, Number(event.target.value) || 0) }))}
                  className="min-w-0 flex-1 bg-transparent text-right text-[14px] font-extrabold tabular-nums text-stone-800 outline-none"
                />
                <span className="ml-1 text-[11px] font-semibold text-stone-400">/mo</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-stone-200 bg-[#faf8f3] px-4 py-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase text-stone-500">Projected total</div>
            <div className="mt-0.5 text-[11px] text-stone-400">6-mo actual avg / {money.format(actualAverage)}/mo</div>
          </div>
          <div className="text-[25px] font-extrabold tabular-nums text-stone-900">{money.format(total)}<span className="text-[11px] text-stone-500">/mo</span></div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDraft({ software: 0, insurance: 0, marketing: 0, mistakes: 0, freelancers: 0, miscellaneous: 0 })}
            className="h-11 rounded-lg border border-stone-200 px-4 text-[13px] font-bold text-stone-500 hover:bg-stone-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-11 flex-1 rounded-lg bg-[#10998c] px-4 text-[13px] font-extrabold text-white hover:bg-[#087d72] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function categoryLabel(value: string | null) {
  return categories.find(([key]) => key === value)?.[1] ?? "Miscellaneous"
}

function ExpenseEditRow({ row, mutate }: { row: ExpenseRow; mutate: KeyedMutator<ExpenseData> }) {
  const [description, setDescription] = useState(row.description)
  const [amount, setAmount] = useState(String(row.amount))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDescription(row.description)
    setAmount(String(row.amount))
  }, [row.description, row.amount])

  const update = async (patch: Partial<ExpenseRow>) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/expenses/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Failed to update expense")
      await mutate()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to update expense")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Remove "${row.description}"?`)) return
    setBusy(true)
    try {
      const response = await fetch(`/api/expenses/${row.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Failed to remove expense")
      await mutate()
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to remove expense")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`border-b border-stone-100 py-3 last:border-b-0 ${busy ? "opacity-60" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description.trim() && description.trim() !== row.description && update({ description: description.trim() })}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-stone-800 outline-none"
          aria-label="Expense description"
        />
        <button type="button" onClick={remove} className="flex h-7 w-7 items-center justify-center text-stone-300 hover:text-red-600" aria-label="Remove expense">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_100px_126px] gap-2 max-sm:grid-cols-1">
        <select
          value={row.category || "OTHER"}
          onChange={(event) => update({ category: event.target.value })}
          className="h-9 min-w-0 rounded-lg border border-stone-200 bg-white px-2 text-[12px] font-semibold text-stone-600 outline-none focus:border-teal-600"
          aria-label="Expense category"
        >
          {categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span className="flex h-9 items-center rounded-lg border border-stone-200 bg-white px-2">
          <span className="text-stone-400">-$</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => {
              const next = Number(amount)
              if (next > 0 && Math.abs(next - row.amount) > 0.001) update({ amount: next })
            }}
            className="min-w-0 flex-1 bg-transparent text-right text-[12px] font-extrabold tabular-nums outline-none"
            aria-label="Expense amount"
          />
        </span>
        <button
          type="button"
          onClick={() => update({ isRecurring: !row.isRecurring, type: row.isRecurring ? "VARIABLE" : "FIXED" })}
          className="h-9 rounded-lg border border-stone-200 px-2 text-[11px] font-bold text-stone-500 hover:bg-stone-50"
        >
          {row.isRecurring ? "Fixed / Monthly" : "Variable / One-time"}
        </button>
      </div>
    </div>
  )
}

export function ExpensesModal({
  open,
  onClose,
  selectedMonth,
  data,
  isLoading,
  mutate,
  onSelectMonth,
}: ModalProps & {
  selectedMonth: Date
  data?: ExpenseData
  isLoading: boolean
  mutate: KeyedMutator<ExpenseData>
  onSelectMonth: (month: Date) => void
}) {
  const [adding, setAdding] = useState(false)
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("OTHER")
  const [amount, setAmount] = useState("")
  const [recurring, setRecurring] = useState(false)
  const [saving, setSaving] = useState(false)

  const maxMonth = Math.max(1, ...(data?.months.map((month) => month.total) || [1]))
  const average = useMemo(() => {
    if (!data?.months.length) return 0
    return data.months.reduce((sum, month) => sum + month.total, 0) / data.months.length
  }, [data?.months])

  const addExpense = async () => {
    const numericAmount = Number(amount)
    if (!description.trim() || numericAmount <= 0) {
      showError("Enter what the expense was for and an amount")
      return
    }
    setSaving(true)
    try {
      const today = new Date()
      const date = isSameMonth(today, selectedMonth)
        ? format(today, "yyyy-MM-dd")
        : format(selectedMonth, "yyyy-MM-01")
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          description: description.trim(),
          amount: numericAmount,
          category,
          type: recurring ? "FIXED" : "VARIABLE",
          isRecurring: recurring,
        }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Failed to add expense")
      setDescription("")
      setAmount("")
      setCategory("OTHER")
      setRecurring(false)
      setAdding(false)
      await mutate()
      showSuccess("Expense added")
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to add expense")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} width="max-w-[470px]">
      <div className="flex max-h-[calc(100dvh-32px)] flex-col">
        <div className="px-6 pb-0 pt-6">
          <h2 className="text-[19px] font-extrabold text-stone-900">Expenses</h2>
          <p className="mt-0.5 text-[13px] text-stone-500">Last 6 months / avg {money.format(average)}/mo</p>

          <div className="mt-5 flex h-[116px] items-end justify-between gap-2">
            {(data?.months || []).map((month) => {
              const active = month.key === format(selectedMonth, "yyyy-MM")
              const [year, numericMonth] = month.key.split("-").map(Number)
              return (
                <button
                  type="button"
                  key={month.key}
                  onClick={() => onSelectMonth(new Date(year, numericMonth - 1, 1))}
                  className={`flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-lg px-1 pb-1 ${active ? "bg-[#faf8f3]" : "hover:bg-stone-50"}`}
                >
                  <span className="mb-1 text-[9px] font-semibold tabular-nums text-stone-400">{money.format(month.total)}</span>
                  <span className={`w-6 rounded-t-[4px] ${active ? "bg-[#10998c]" : "bg-[#dcd5c7]"}`} style={{ height: `${Math.max(8, (month.total / maxMonth) * 68)}px` }} />
                  <span className={`mt-1 text-[11px] font-bold ${active ? "text-teal-700" : "text-stone-500"}`}>{month.label}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex items-end justify-between border-b border-stone-200 pb-3">
            <div>
              <div className="text-[15px] font-extrabold text-stone-900">{format(selectedMonth, "MMMM yyyy")}</div>
              <div className="text-[11px] text-stone-400">{isSameMonth(selectedMonth, new Date()) ? "This month" : "Total"}</div>
            </div>
            <div className="text-[25px] font-extrabold tabular-nums text-[#c33d0e]">-{money.format(data?.total || 0)}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-3">
          {isLoading ? (
            <div className="py-10 text-center text-[13px] text-stone-400">Loading expenses...</div>
          ) : data?.expenses.length ? (
            <>
              <p className="pb-1 text-[11px] font-semibold text-stone-400">Edit any field directly</p>
              {data.expenses.map((row) => <ExpenseEditRow key={row.id} row={row} mutate={mutate} />)}
            </>
          ) : (
            <div className="py-9 text-center text-[13px] text-stone-400">No expenses recorded for this month.</div>
          )}
        </div>

        <div className="border-t border-stone-100 bg-white px-6 py-4">
          {adding ? (
            <div className="rounded-lg border border-stone-200 bg-[#faf8f3] p-3">
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What was it for?"
                className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] outline-none focus:border-teal-600"
                autoFocus
              />
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_130px] gap-2">
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 min-w-0 rounded-lg border border-stone-200 bg-white px-2 text-[12px] outline-none">
                  {categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount" className="h-10 min-w-0 rounded-lg border border-stone-200 bg-white px-3 text-[13px] outline-none" />
              </div>
              <div className="mt-2 grid grid-cols-2 rounded-lg bg-[#eee8dc] p-0.5 text-[11px] font-bold">
                <button type="button" onClick={() => setRecurring(false)} className={`h-7 rounded-md ${!recurring ? "bg-[#10998c] text-white" : "text-stone-500"}`}>One-time</button>
                <button type="button" onClick={() => setRecurring(true)} className={`h-7 rounded-md ${recurring ? "bg-[#10998c] text-white" : "text-stone-500"}`}>Repeats monthly</button>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-lg border border-stone-200 bg-white px-4 text-[12px] font-bold text-stone-500">Cancel</button>
                <button type="button" onClick={addExpense} disabled={saving} className="h-10 flex-1 rounded-lg bg-[#10998c] px-4 text-[12px] font-extrabold text-white disabled:opacity-60">{saving ? "Adding..." : "Add"}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e6f4f2] text-[13px] font-extrabold text-teal-700 hover:bg-[#d8efec]">
              <Plus size={16} /> Add expense
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

export { categoryLabel }
