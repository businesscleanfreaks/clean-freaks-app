"use client"

import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns"
import {
  Check,
  Circle,
  ClipboardCheck,
  CreditCard,
  Sparkles,
  WalletCards,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export type DashboardCompletionState = Record<string, boolean>

interface CompletionProps {
  doneTasks: DashboardCompletionState
  onToggleTask: (taskId: string) => void
}

export interface DashboardOperationsData {
  trials: Array<{
    id: string
    clientId: string
    clientName: string
    date: string
    kind: "TRIAL" | "FIRST_CLEAN"
    detail: string
  }>
  manualCharges: Array<{
    id: string
    clientId: string
    clientName: string
    amount: number
    date: string
    detail: string
  }>
  oneOffs: Array<{
    id: string
    clientId: string
    clientName: string
    locationName: string
    date: string
    clientAmount: number
    workerAmount: number
    workerId: string | null
    workerName: string
    workerType: "cleaner" | "vendor"
    invoiced: boolean
    hasWorkerInvoice: boolean
    workerPaid: boolean
    stage: "INVOICE_CLIENT" | "GET_WORKER_INVOICE" | "PAY_WORKER" | "DONE"
  }>
  period: string
}

interface PayableAccount {
  id: string
  clientName: string
  safeOwed: number
  status: "safe" | "waiting" | "partial" | "pay-today"
  reason: string
  payableItemIds: string[]
  cleans: Array<{ date: string; amount: number }>
}

interface PayablePerson {
  id: string
  type: "cleaner" | "vendor"
  name: string
  accounts: PayableAccount[]
  safe: number
  fastPay: boolean
}

export interface DashboardPayablesData {
  cleaners: PayablePerson[]
  vendors: PayablePerson[]
  totals: {
    cleaners: { total: number; safe: number; waiting: number; payToday: number }
    vendors: { total: number; safe: number; waiting: number; payToday: number }
  }
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

function residentialPayItems(payables?: DashboardPayablesData) {
  return (payables?.cleaners || []).flatMap((person) =>
    person.accounts
      .filter((account) => account.payableItemIds.length > 0 && (person.fastPay || account.reason.toLowerCase().includes("residential")))
      .map((account) => ({ person, account })),
  )
}

function payableTaskId(person: PayablePerson, account: PayableAccount) {
  return `pay:${person.id}:${account.id}`
}

function chargeTaskId(chargeId: string) {
  return `charge:${chargeId}`
}

function dueDateForPayable(person: PayablePerson, account: PayableAccount) {
  const latest = account.cleans.reduce<Date | null>((value, clean) => {
    const date = new Date(clean.date)
    return !value || date > value ? date : value
  }, null)
  if (!latest) return new Date()
  return addDays(latest, person.fastPay ? 3 : 7)
}

function dueLabel(date: Date) {
  const days = differenceInCalendarDays(startOfDay(date), startOfDay(new Date()))
  if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, tone: "text-[#c33d0e]" }
  if (days === 0) return { label: "Due today", tone: "text-[#c33d0e]" }
  if (days === 1) return { label: "Tomorrow", tone: "text-stone-500" }
  return { label: `In ${days} days`, tone: "text-stone-500" }
}

function RailCard({
  icon,
  title,
  count,
  subtitle,
  children,
  countTone = "teal",
}: {
  icon: React.ReactNode
  title: string
  count: number
  subtitle?: string
  children: React.ReactNode
  countTone?: "teal" | "orange"
}) {
  return (
    <section className="rounded-lg border border-[#e6dfd4] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(40,30,10,0.04)]">
      <div className="flex items-center gap-2 border-b border-[#eee8dd] pb-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e6f4f2] text-teal-700">{icon}</span>
        <h3 className="min-w-0 flex-1 text-[15px] font-extrabold text-stone-900">{title}</h3>
        <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[11px] font-extrabold ${countTone === "orange" ? "bg-orange-100 text-[#b43709]" : "bg-[#e6f4f2] text-teal-700"}`}>{count}</span>
      </div>
      {subtitle && <p className="border-b border-[#eee8dd] py-1.5 text-[11px] font-medium text-stone-400">{subtitle}</p>}
      {children}
    </section>
  )
}

export function OperationsRail({
  operations,
  payables,
  doneTasks,
  onToggleTask,
}: {
  operations?: DashboardOperationsData
  payables?: DashboardPayablesData
} & CompletionProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const residential = residentialPayItems(payables)
  const trials = operations?.trials || []
  const charges = operations?.manualCharges || []
  const oneOffs = (operations?.oneOffs || []).filter((job) => job.stage !== "DONE")
  const visible = <T,>(key: string, rows: T[], cap: number) => expanded[key] ? rows : rows.slice(0, cap)
  const incompleteResidential = residential.filter(({ person, account }) => !doneTasks[payableTaskId(person, account)]).length
  const incompleteCharges = charges.filter((charge) => !doneTasks[chargeTaskId(charge.id)]).length
  const toggleExpanded = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }))

  return (
    <aside className="space-y-4 min-[1180px]:sticky min-[1180px]:top-5 min-[1180px]:max-h-[calc(100dvh-40px)] min-[1180px]:overflow-y-auto min-[1180px]:pr-1">
      <RailCard icon={<Sparkles size={16} />} title="Trials & first cleans" count={trials.length}>
        {trials.length ? visible("trials", trials, 4).map((trial) => (
          <Link key={trial.id} href={`/clients/${trial.clientId}`} className="flex items-center gap-3 border-b border-[#eee8dd] py-2.5 last:border-b-0 hover:text-teal-700">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold">{trial.clientName}</div>
              <div className="truncate text-[12px] text-stone-500">{trial.detail}</div>
            </div>
            <span className={`rounded-md px-2 py-0.5 text-[9px] font-extrabold uppercase ${trial.kind === "TRIAL" ? "bg-orange-100 text-orange-700" : "bg-[#e6f4f2] text-teal-700"}`}>
              {trial.kind === "TRIAL" ? "Trial" : "First clean"}
            </span>
          </Link>
        )) : <RailEmpty text="No new starts this month" />}
        <RailShowAll total={trials.length} cap={4} expanded={Boolean(expanded.trials)} onToggle={() => toggleExpanded("trials")} />
      </RailCard>

      <RailCard icon={<WalletCards size={16} />} title="Pay cleaners - residential" count={incompleteResidential} subtitle="Due 7 days after the service date" countTone="orange">
        {residential.length ? visible("residential", residential, 3).map(({ person, account }) => {
          const due = dueLabel(dueDateForPayable(person, account))
          const cleanDate = account.cleans.at(-1)?.date
          const taskId = payableTaskId(person, account)
          const done = Boolean(doneTasks[taskId])
          return (
            <div key={`${person.id}:${account.id}`} className="flex items-center gap-3 border-b border-[#eee8dd] py-2.5 last:border-b-0">
              <TaskCheckbox checked={done} onToggle={() => onToggleTask(taskId)} label={`${done ? "Undo" : "Mark"} payment task for ${person.name}`} />
              <Link href="/payables" className="min-w-0 flex-1 hover:text-teal-700">
                <div className={`truncate text-[13px] font-extrabold ${done ? "text-stone-400 line-through" : ""}`}>Pay {person.name} {money.format(account.safeOwed)}</div>
                <div className="truncate text-[11px] text-stone-500">{account.clientName}{cleanDate ? ` / cleaned ${format(new Date(cleanDate), "MMM d")}` : ""}</div>
              </Link>
              {done ? (
                <>
                  <span className="whitespace-nowrap text-[10px] font-extrabold text-[#15803d]">Paid</span>
                  <UndoButton onClick={() => onToggleTask(taskId)} />
                </>
              ) : <span className={`whitespace-nowrap text-[10px] font-extrabold ${due.tone}`}>{due.label}</span>}
            </div>
          )
        }) : <RailEmpty text="No residential payments due" />}
        <RailShowAll total={residential.length} cap={3} expanded={Boolean(expanded.residential)} onToggle={() => toggleExpanded("residential")} />
      </RailCard>

      <RailCard icon={<CreditCard size={16} />} title="Manual charges" count={incompleteCharges} subtitle="Stays until you mark it charged" countTone="orange">
        {charges.length ? visible("charges", charges, 3).map((charge) => {
          const taskId = chargeTaskId(charge.id)
          const done = Boolean(doneTasks[taskId])
          return (
          <div key={charge.id} className="flex items-center gap-3 border-b border-[#eee8dd] py-2.5 last:border-b-0">
            <TaskCheckbox checked={done} onToggle={() => onToggleTask(taskId)} label={`${done ? "Undo" : "Mark"} charge task for ${charge.clientName}`} />
            <Link href="/invoices" className="min-w-0 flex-1 hover:text-teal-700">
              <div className={`truncate text-[13px] font-extrabold ${done ? "text-stone-400 line-through" : ""}`}>Charge {charge.clientName} {money.format(charge.amount)}</div>
              <div className="truncate text-[11px] capitalize text-stone-500">{charge.detail.toLowerCase()}</div>
            </Link>
            {done && (
              <>
                <span className="whitespace-nowrap text-[10px] font-extrabold text-[#15803d]">Charged</span>
                <UndoButton onClick={() => onToggleTask(taskId)} />
              </>
            )}
          </div>
        )}) : <RailEmpty text="No manual charges waiting" />}
        <RailShowAll total={charges.length} cap={3} expanded={Boolean(expanded.charges)} onToggle={() => toggleExpanded("charges")} />
      </RailCard>

      <RailCard icon={<ClipboardCheck size={16} />} title="One-off cleans" count={oneOffs.length} subtitle="Invoice client -> get worker invoice -> pay worker">
        {oneOffs.length ? visible("oneOffs", oneOffs, 4).map((job) => <OneOffRailItem key={job.id} job={job} />) : <RailEmpty text="No one-off clean actions waiting" />}
        <RailShowAll total={oneOffs.length} cap={4} expanded={Boolean(expanded.oneOffs)} onToggle={() => toggleExpanded("oneOffs")} />
      </RailCard>
    </aside>
  )
}

function RailEmpty({ text }: { text: string }) {
  return <div className="py-4 text-center text-[12px] text-stone-400">{text}</div>
}

function RailShowAll({ total, cap, expanded, onToggle }: { total: number; cap: number; expanded: boolean; onToggle: () => void }) {
  if (total <= cap) return null
  return (
    <button type="button" onClick={onToggle} className="mt-2 text-[11px] font-extrabold text-teal-700 hover:text-teal-900">
      {expanded ? "Show less" : `Show all (${total})`}
    </button>
  )
}

function TaskCheckbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border text-white ${checked ? "border-[#15803d] bg-[#15803d]" : "border-stone-300 bg-white hover:border-teal-600"}`}
    >
      {checked && <Check size={13} strokeWidth={3} />}
    </button>
  )
}

function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-7 rounded-md border border-[#e2dccf] bg-white px-2.5 text-[10px] font-bold text-stone-500 hover:bg-stone-50 hover:text-stone-800">
      Undo
    </button>
  )
}

function Step({ done, active, children }: { done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${done ? "text-teal-700" : active ? "text-teal-800" : "text-stone-300"}`}>
      {done ? <Check size={12} /> : <Circle size={8} fill={active ? "currentColor" : "none"} />}
      {children}
    </div>
  )
}

function OneOffRailItem({ job }: { job: DashboardOperationsData["oneOffs"][number] }) {
  const action = job.stage === "INVOICE_CLIENT"
    ? { label: "Invoice client", href: "/invoices" }
    : job.stage === "GET_WORKER_INVOICE"
      ? { label: "Mark invoice received", href: "/payables" }
      : { label: "Pay worker", href: "/payables" }
  return (
    <div className="border-b border-[#eee8dd] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-extrabold">{job.clientName}</div>
          <div className="truncate text-[11px] text-stone-500">Cleaned {format(new Date(job.date), "MMM d")} / Client {money.format(job.clientAmount)} / Pay {money.format(job.workerAmount)}</div>
        </div>
        <span className="whitespace-nowrap text-[10px] font-semibold text-stone-500">{job.workerName}</span>
      </div>
      <div className="mt-2 space-y-1">
        <Step done={job.invoiced} active={job.stage === "INVOICE_CLIENT"}>Invoice client</Step>
        <Step done={job.hasWorkerInvoice} active={job.stage === "GET_WORKER_INVOICE"}>Get {job.workerType} invoice</Step>
        <Step done={job.workerPaid} active={job.stage === "PAY_WORKER"}>Pay {job.workerType}</Step>
      </div>
      <Link href={action.href} className="mt-2 inline-flex h-8 items-center rounded-md bg-[#10998c] px-3 text-[11px] font-extrabold text-white hover:bg-[#087d72]">
        {action.label} <span aria-hidden="true" className="ml-1">-&gt;</span>
      </Link>
    </div>
  )
}

type TaskGroup = "OVERDUE" | "TODAY" | "COMING" | "STARTING"

interface DashboardTask {
  id: string
  title: string
  subtitle: string
  dueAt: Date
  group: TaskGroup
  href: string
  action?: string
  completionLabel?: "Paid" | "Charged"
  amountToPay: number
  amountToCharge: number
}

function taskGroup(date: Date, forceStarting = false): TaskGroup {
  if (forceStarting) return "STARTING"
  const days = differenceInCalendarDays(startOfDay(date), startOfDay(new Date()))
  if (days < 0) return "OVERDUE"
  if (days === 0) return "TODAY"
  return days <= 14 ? "COMING" : "STARTING"
}

function buildTasks(operations?: DashboardOperationsData, payables?: DashboardPayablesData): DashboardTask[] {
  const payTasks = (payables?.cleaners || []).flatMap((person) => person.accounts
    .filter((account) => account.payableItemIds.length > 0 && account.safeOwed > 0)
    .map((account) => {
      const dueAt = account.reason.toLowerCase().includes("residential") || person.fastPay
        ? dueDateForPayable(person, account)
        : new Date()
      return {
        id: `pay:${person.id}:${account.id}`,
        title: `Pay ${person.name} ${money.format(account.safeOwed)}`,
        subtitle: `${account.clientName}${account.cleans.at(-1)?.date ? ` / cleaned ${format(new Date(account.cleans.at(-1)!.date), "MMM d")}` : ""}`,
        dueAt,
        group: taskGroup(dueAt),
        href: "/payables",
        completionLabel: "Paid",
        amountToPay: account.safeOwed,
        amountToCharge: 0,
      } satisfies DashboardTask
    }))

  const chargeTasks = (operations?.manualCharges || []).map((charge) => {
    const dueAt = new Date(charge.date)
    return {
      id: `charge:${charge.id}`,
      title: `Charge ${charge.clientName} ${money.format(charge.amount)}`,
      subtitle: charge.detail,
      dueAt,
      group: taskGroup(dueAt),
      href: "/invoices",
      completionLabel: "Charged",
      amountToPay: 0,
      amountToCharge: charge.amount,
    } satisfies DashboardTask
  })

  const oneOffTasks = (operations?.oneOffs || []).filter((job) => job.stage !== "DONE").map((job) => {
    const dueAt = addDays(new Date(job.date), 1)
    const title = job.stage === "INVOICE_CLIENT"
      ? `Invoice client - ${job.clientName}`
      : job.stage === "GET_WORKER_INVOICE"
        ? `Get ${job.workerType} invoice - ${job.clientName}`
        : `Pay ${job.workerName} ${money.format(job.workerAmount)}`
    const action = job.stage === "INVOICE_CLIENT" ? "Invoice client" : job.stage === "GET_WORKER_INVOICE" ? "Open payables" : "Pay worker"
    return {
      id: `oneoff:${job.id}`,
      title,
      subtitle: `${job.workerName} / cleaned ${format(new Date(job.date), "MMM d")} / Client ${money.format(job.clientAmount)} / Pay ${money.format(job.workerAmount)}`,
      dueAt,
      group: taskGroup(dueAt),
      href: job.stage === "INVOICE_CLIENT" ? "/invoices" : "/payables",
      action,
      amountToPay: job.stage === "PAY_WORKER" ? job.workerAmount : 0,
      amountToCharge: job.stage === "INVOICE_CLIENT" ? job.clientAmount : 0,
    } satisfies DashboardTask
  })

  const startTasks = (operations?.trials || []).map((trial) => ({
    id: `start:${trial.id}`,
    title: `${trial.kind === "TRIAL" ? "Trial" : "First clean"} - ${trial.clientName}`,
    subtitle: trial.detail,
    dueAt: new Date(trial.date),
    group: "STARTING" as const,
    href: `/clients/${trial.clientId}`,
    amountToPay: 0,
    amountToCharge: 0,
  }))

  return [...payTasks, ...chargeTasks, ...oneOffTasks, ...startTasks].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

const groupMeta: Array<{ key: TaskGroup; label: string; dot: string }> = [
  { key: "OVERDUE", label: "Overdue", dot: "bg-[#c94a0a]" },
  { key: "TODAY", label: "Due today", dot: "bg-[#c55b0a]" },
  { key: "COMING", label: "Coming up", dot: "bg-[#10998c]" },
  { key: "STARTING", label: "Starting soon", dot: "bg-[#10998c]" },
]

export function TodoView({
  operations,
  payables,
  doneTasks,
  onToggleTask,
}: {
  operations?: DashboardOperationsData
  payables?: DashboardPayablesData
} & CompletionProps) {
  const tasks = buildTasks(operations, payables)
  const activeTasks = tasks.filter((task) => !doneTasks[task.id])
  const completedTasks = tasks.filter((task) => doneTasks[task.id] && task.completionLabel)
  const totalPay = activeTasks.reduce((sum, task) => sum + task.amountToPay, 0)
  const totalCharge = activeTasks.reduce((sum, task) => sum + task.amountToCharge, 0)

  return (
    <div className="mx-auto w-full max-w-[800px] pb-12 pt-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-8 rounded-lg bg-[#07101f] px-6 py-5 text-white max-sm:grid-cols-2 max-sm:gap-y-4">
        <div className="min-w-0 max-sm:col-span-2">
          <div className="text-[19px] font-extrabold">You have {activeTasks.length} {activeTasks.length === 1 ? "thing" : "things"} to do</div>
          <div className="mt-0.5 text-[12px] text-slate-400">{format(new Date(), "EEEE, MMMM d")} / payments, charges & one-off jobs</div>
        </div>
        <div>
          <div className="text-[23px] font-extrabold tabular-nums">{money.format(totalPay)}</div>
          <div className="text-[10px] text-slate-400">to pay cleaners</div>
        </div>
        <div>
          <div className="text-[23px] font-extrabold tabular-nums">{money.format(totalCharge)}</div>
          <div className="text-[10px] text-slate-400">to charge clients</div>
        </div>
      </div>

      {activeTasks.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#e6dfd4] bg-white py-14 text-center text-[13px] text-stone-400">Nothing needs attention right now.</div>
      ) : groupMeta.map((group) => {
        const rows = activeTasks.filter((task) => task.group === group.key)
        if (!rows.length) return null
        return (
          <section key={group.key} className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase text-stone-500">
              <span className={`h-2 w-2 rounded-full ${group.dot}`} /> {group.label} <span className="text-stone-400">{rows.length}</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#e6dfd4] bg-white">
              {rows.map((task) => {
                const due = dueLabel(task.dueAt)
                return (
                  <div key={task.id} className="flex min-h-[64px] items-center gap-3 border-b border-[#eee8dd] px-4 py-2.5 last:border-b-0 hover:bg-[#fffdf8]">
                    {task.completionLabel ? (
                      <TaskCheckbox checked={false} onToggle={() => onToggleTask(task.id)} label={`Mark ${task.title} done`} />
                    ) : <Circle size={9} className="flex-none text-stone-400" />}
                    <Link href={task.href} className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-extrabold text-stone-900">{task.title}</div>
                      <div className="truncate text-[11px] text-stone-500">{task.subtitle}</div>
                    </Link>
                    {task.action ? (
                      <Link href={task.href} className="inline-flex h-9 min-w-[150px] items-center justify-center rounded-md bg-[#10998c] px-3 text-[11px] font-extrabold text-white max-sm:hidden">{task.action} -&gt;</Link>
                    ) : (
                      <span className={`whitespace-nowrap text-[10px] font-extrabold ${due.tone}`}>{due.label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {completedTasks.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase text-stone-500">
            <span className="h-2 w-2 rounded-full bg-[#15803d]" /> Done today <span className="text-stone-400">{completedTasks.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-[#e6dfd4] bg-white">
            {completedTasks.map((task) => (
              <div key={task.id} className="flex min-h-[62px] items-center gap-3 border-b border-[#eee8dd] bg-[#f7fcf8] px-4 py-2.5 last:border-b-0">
                <TaskCheckbox checked onToggle={() => onToggleTask(task.id)} label={`Undo ${task.title}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-stone-400 line-through">{task.title}</div>
                  <div className="truncate text-[11px] text-stone-400">{task.subtitle}</div>
                </div>
                <span className="text-[10px] font-extrabold text-[#15803d]">{task.completionLabel}</span>
                <UndoButton onClick={() => onToggleTask(task.id)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function todoCount(operations?: DashboardOperationsData, payables?: DashboardPayablesData, doneTasks: DashboardCompletionState = {}) {
  return buildTasks(operations, payables).filter((task) => !doneTasks[task.id]).length
}
