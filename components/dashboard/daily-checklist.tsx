"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { CheckCircle2, Check, ChevronRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

interface DailyChecklistProps {
  jobsToday: number
  jobsCompletedToday: number
  pendingInvoices: number
  pendingInvoicesAmount: number
  unassignedJobs: number
  overdueInvoices: number
}

export function DailyChecklist({
  jobsToday,
  jobsCompletedToday,
  pendingInvoices,
  pendingInvoicesAmount,
}: DailyChecklistProps) {
  const tasks = [
    { done: jobsCompletedToday >= jobsToday && jobsToday > 0, hasItems: jobsToday > 0 },
    { done: pendingInvoices === 0, hasItems: pendingInvoices > 0 },
  ]
  
  const totalTasks = tasks.filter(t => t.hasItems || t.done).length || 2
  const completedTasks = tasks.filter(t => t.done).length

  return (
    <Card className="border border-cf-border-subtle shadow-sm h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4 text-teal-600" />
            </div>
            <span className="text-base font-semibold text-cf-text-primary">
              Today&apos;s Checklist
            </span>
          </div>
          <span className="text-[13px] text-cf-text-muted whitespace-nowrap">
            {completedTasks}/{totalTasks} tasks done
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobsToday > 0 && (
          <ChecklistItem
            href="/calendar"
            done={jobsCompletedToday >= jobsToday}
            title={`${jobsToday} job${jobsToday !== 1 ? 's' : ''} today`}
            subtitle={`${jobsCompletedToday}/${jobsToday} done`}
          />
        )}

        <ChecklistItem
          href="/invoices"
          done={pendingInvoices === 0}
          title={pendingInvoices > 0 ? `${pendingInvoices} invoice${pendingInvoices !== 1 ? 's' : ''} to send` : 'All invoices sent'}
          subtitle={pendingInvoices > 0 ? `${formatCurrency(pendingInvoicesAmount)} ready` : 'Up to date'}
        />

        {jobsToday === 0 && pendingInvoices === 0 && (
          <p className="text-sm text-cf-text-muted py-2">
            Nothing urgent today. You&apos;re all caught up.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ChecklistItem({ href, done, title, subtitle }: {
  href: string
  done: boolean
  title: string
  subtitle: string
}) {
  return (
    <Link href={href} className="block">
      <div className="flex items-center justify-between p-3 rounded-lg bg-cf-bg-subtle border border-cf-border-subtle/60 hover:bg-cf-border-subtle/40 active:scale-[0.98] transition-all cursor-pointer min-h-[56px]">
        <div className="flex items-center gap-3">
          <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
            done
              ? 'bg-teal-500 border-teal-500'
              : 'border-cf-border-subtle'
          }`}>
            {done && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </div>
          <div>
            <p className="font-medium text-sm text-foreground">{title}</p>
            <p className="text-xs text-cf-text-muted">{subtitle}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-cf-text-disabled" />
      </div>
    </Link>
  )
}
