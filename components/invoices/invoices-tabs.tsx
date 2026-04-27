"use client"

import { useState } from "react"
import { FileText, Clock, CheckCircle2, Plus, Receipt, Send, DollarSign, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { format } from "date-fns"
import { ClientWithJobs } from "@/types"
import { InvoiceStatusBadge } from "./invoice-status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { showSuccess, showError } from "@/lib/toast"

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: number
  dateCreated: Date
  client: {
    name: string
  }
}

interface InvoicesTabsProps {
  drafts: Invoice[]
  waitingForPayment: Invoice[]
  paid: Invoice[]
  readyToBill: ClientWithJobs[]
  totalReadyToBill: number
}

export function InvoicesTabs({ drafts, waitingForPayment, paid, readyToBill, totalReadyToBill }: InvoicesTabsProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'ready' | 'drafts' | 'waiting' | 'paid'>('ready')
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)
  const [confirmMarkPaid, setConfirmMarkPaid] = useState<Invoice | null>(null)
  
  const handleMarkAsPaid = async (invoice: Invoice) => {
    setMarkingPaidId(invoice.id)
    setConfirmMarkPaid(null)
    
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAID' }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to mark as paid')
      }
      
      showSuccess(`Invoice ${invoice.invoiceNumber} marked as paid!`)
      router.refresh()
    } catch (error) {
      showError('Failed to mark invoice as paid')
    } finally {
      setMarkingPaidId(null)
    }
  }

  const getEmptyStateForTab = (tab: typeof activeTab) => {
    switch (tab) {
      case 'ready':
        return {
          icon: Receipt,
          title: "All caught up!",
          description: "You don't have any unbilled jobs right now. New jobs will appear here when they're ready to be invoiced.",
          actionLabel: "View Calendar",
          actionHref: "/calendar",
          helpTooltip: "empty-jobs",
        }
      case 'drafts':
        return {
          icon: FileText,
          title: "No draft invoices",
          description: "You haven't created any draft invoices yet. Create your first invoice from completed jobs.",
          actionLabel: "Create Invoice",
          actionHref: "/invoices/new",
          secondaryActionLabel: "Batch Invoice",
          secondaryActionHref: "/invoices/batch",
          helpTooltip: "empty-invoices",
        }
      case 'waiting':
        return {
          icon: Send,
          title: "No pending payments",
          description: "All your sent invoices have been paid! You don't have any invoices waiting for payment.",
          helpTooltip: "empty-invoices",
        }
      case 'paid':
        return {
          icon: DollarSign,
          title: "No paid invoices yet",
          description: "Once you send invoices and clients pay them, they'll appear here. Start by creating your first invoice!",
          actionLabel: "Create Invoice",
          actionHref: "/invoices/new",
          helpTooltip: "empty-invoices",
        }
    }
  }

  const renderInvoiceTable = (invoices: Invoice[], showMarkPaidButton: boolean = false) => {
    if (invoices.length === 0) {
      const emptyState = getEmptyStateForTab(activeTab)
      return <EmptyState {...emptyState} />
    }

    return (
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {/* Mobile card list */}
        <div className="sm:hidden divide-y divide-gray-100">
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              className="p-4 active:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => window.location.href = `/invoices/${invoice.id}`}
            >
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-sm font-medium text-gray-900">{invoice.client.name}</p>
                  <p className="text-xs text-gray-500">#{invoice.invoiceNumber} &middot; {format(new Date(invoice.dateCreated), "MMM d, yyyy")}</p>
                </div>
                <span className="text-sm font-semibold text-gray-900 ml-3">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <InvoiceStatusBadge status={invoice.status as 'DRAFT' | 'SENT' | 'PAID'} size="sm" />
                {showMarkPaidButton && invoice.status === 'SENT' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); setConfirmMarkPaid(invoice) }}
                    disabled={markingPaidId === invoice.id}
                    className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    {markingPaidId === invoice.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3 mr-1" />Mark Paid</>}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* Desktop table */}
        <table className="w-full hidden sm:table">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
              <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className="hover:bg-teal-50 transition-all hover:shadow-sm"
              >
                <td 
                  className="px-5 py-4 text-sm font-medium text-gray-900 cursor-pointer"
                  onClick={() => window.location.href = `/invoices/${invoice.id}`}
                >
                  #{invoice.invoiceNumber}
                </td>
                <td 
                  className="px-5 py-4 text-sm text-gray-600 cursor-pointer"
                  onClick={() => window.location.href = `/invoices/${invoice.id}`}
                >
                  {invoice.client.name}
                </td>
                <td 
                  className="px-5 py-4 text-sm text-gray-600 cursor-pointer"
                  onClick={() => window.location.href = `/invoices/${invoice.id}`}
                >
                  {format(new Date(invoice.dateCreated), "MMM d, yyyy")}
                </td>
                <td 
                  className="px-5 py-4 text-sm text-right font-medium text-gray-900 cursor-pointer"
                  onClick={() => window.location.href = `/invoices/${invoice.id}`}
                >
                  {formatCurrency(invoice.totalAmount)}
                </td>
                <td className="px-5 py-4 text-sm text-center">
                  <InvoiceStatusBadge
                    status={invoice.status as 'DRAFT' | 'SENT' | 'PAID'}
                    size="sm"
                  />
                </td>
                <td className="px-5 py-4 text-sm text-right">
                  <div className="flex items-center justify-end gap-2">
                    {showMarkPaidButton && invoice.status === 'SENT' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmMarkPaid(invoice)
                        }}
                        disabled={markingPaidId === invoice.id}
                        className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        {markingPaidId === invoice.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Mark Paid
                          </>
                        )}
                      </Button>
                    )}
                    <span 
                      className="text-teal-600 font-medium hover:text-teal-700 cursor-pointer"
                      onClick={() => window.location.href = `/invoices/${invoice.id}`}
                    >
                      View →
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('ready')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
            activeTab === 'ready'
              ? 'bg-emerald-50 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <Plus className="w-4 h-4" />
          Ready to Invoice ({readyToBill.length})
          {activeTab === 'ready' && (
            <span className="ml-1 px-2 py-0.5 bg-emerald-600 text-white text-xs rounded-full">
              {formatCurrency(totalReadyToBill)}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('drafts')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
            activeTab === 'drafts'
              ? 'bg-emerald-50 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          Drafts ({drafts.length})
        </button>
        <button
          onClick={() => setActiveTab('waiting')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
            activeTab === 'waiting'
              ? 'bg-emerald-50 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          Waiting for Payment ({waitingForPayment.length})
        </button>
        <button
          onClick={() => setActiveTab('paid')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
            activeTab === 'paid'
              ? 'bg-emerald-50 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          Paid ({paid.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'drafts' && renderInvoiceTable(drafts)}
        {activeTab === 'waiting' && renderInvoiceTable(waitingForPayment, true)}
        {activeTab === 'paid' && renderInvoiceTable(paid)}
      </div>

      {/* Mark as Paid Confirmation Modal */}
      {confirmMarkPaid && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Mark as Paid?</h3>
                <p className="text-sm text-gray-500">Confirm payment received</p>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Invoice</span>
                <span className="font-semibold text-gray-900">{confirmMarkPaid.invoiceNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Client</span>
                <span className="font-semibold text-gray-900">{confirmMarkPaid.client.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Amount</span>
                <span className="font-bold text-emerald-600">{formatCurrency(confirmMarkPaid.totalAmount)}</span>
              </div>
            </div>
            
            <p className="text-sm text-gray-600 mb-6">
              This will mark the invoice as paid. Use this for payments received via Zelle, check, or bank transfer.
            </p>
            
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setConfirmMarkPaid(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleMarkAsPaid(confirmMarkPaid)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Mark as Paid
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
