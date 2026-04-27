"use client"

import { CheckCircle2 } from "lucide-react"

interface NoOverdueInvoicesBannerProps {
  show: boolean
}

export function NoOverdueInvoicesBanner({ show }: NoOverdueInvoicesBannerProps) {
  if (!show) return null

  return (
    <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-cf-border-subtle animate-fade-in">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-cf-success" />
      <div>
        <p className="text-sm font-semibold text-cf-text-primary leading-tight">No Overdue Invoices</p>
        <p className="text-xs text-cf-text-muted">All your invoices are up to date.</p>
      </div>
    </div>
  )
}
