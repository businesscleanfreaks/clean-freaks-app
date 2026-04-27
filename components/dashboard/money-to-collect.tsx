"use client"

import Link from "next/link"
import { DollarSign, FileText, ChevronRight, Zap } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

interface MoneyToCollectProps {
  pendingInvoices: number
  pendingInvoicesAmount: number
  sentInvoicesCount: number
  sentInvoicesAmount: number
}

export function MoneyToCollect({
  pendingInvoices,
  pendingInvoicesAmount,
  sentInvoicesCount,
  sentInvoicesAmount,
}: MoneyToCollectProps) {
  const totalAmount = pendingInvoicesAmount + sentInvoicesAmount
  const totalItems = pendingInvoices + sentInvoicesCount

  if (totalItems === 0) return null

  return (
    <div className="animate-slide-left" style={{ animationDelay: '0.2s' }}>
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-4 h-4 text-cf-primary" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Money to Collect
        </h2>
      </div>

      <div
        className="rounded-xl border border-cf-border-subtle bg-white overflow-hidden"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        {/* Total Banner */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid #F3F3F3', background: 'linear-gradient(135deg, #FAFCFB 0%, #F7FAF9 100%)' }}
        >
          <div>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#111111' }}>
              {formatCurrency(totalAmount)}
            </p>
            <p style={{ fontSize: '12px', color: '#888888', marginTop: '2px' }}>
              {totalItems} invoice{totalItems !== 1 ? 's' : ''} outstanding
            </p>
          </div>
          {pendingInvoices > 1 && (
            <Link
              href="/invoices"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.97]"
              style={{ backgroundColor: '#00A896' }}
            >
              <Zap className="w-3.5 h-3.5" />
              Batch Invoice
            </Link>
          )}
        </div>

        {/* Draft invoices ready to send */}
        {pendingInvoices > 0 && (
          <Link
            href="/invoices"
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#FAFAFA] active:bg-[#F5F5F5]"
            style={{ borderBottom: sentInvoicesCount > 0 ? '1px solid #F3F3F3' : 'none' }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(245,158,11,0.1)' }}
            >
              <FileText className="w-4 h-4" style={{ color: '#F59E0B' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-800">
                {pendingInvoices} draft{pendingInvoices !== 1 ? 's' : ''} ready to send
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatCurrency(pendingInvoicesAmount)}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
          </Link>
        )}

        {/* Sent invoices waiting for payment */}
        {sentInvoicesCount > 0 && (
          <Link
            href="/invoices"
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#FAFAFA] active:bg-[#F5F5F5]"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(59,130,246,0.1)' }}
            >
              <DollarSign className="w-4 h-4" style={{ color: '#3B82F6' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-800">
                {sentInvoicesCount} sent, awaiting payment
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatCurrency(sentInvoicesAmount)}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
          </Link>
        )}
      </div>
    </div>
  )
}
