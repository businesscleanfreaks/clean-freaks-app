"use client"

import { formatCurrency } from "@/lib/utils"
import { format } from "date-fns"

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

interface RecentInvoicesTableProps {
  invoices: Invoice[]
}

export function RecentInvoicesTable({ invoices }: RecentInvoicesTableProps) {
  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Invoices</h3>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full">
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
            {invoices.slice(0, 10).map((invoice) => (
              <tr
                key={invoice.id}
                onClick={() => window.location.href = `/invoices/${invoice.id}`}
                className="hover:bg-teal-50 cursor-pointer transition-all hover:shadow-sm"
              >
                <td className="px-5 py-4 text-sm font-medium text-gray-900">#{invoice.invoiceNumber}</td>
                <td className="px-5 py-4 text-sm text-gray-600">{invoice.client.name}</td>
                <td className="px-5 py-4 text-sm text-gray-600">{format(new Date(invoice.dateCreated), "MMM d, yyyy")}</td>
                <td className="px-5 py-4 text-sm text-right font-medium text-gray-900">{formatCurrency(invoice.totalAmount)}</td>
                <td className="px-5 py-4 text-sm text-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    invoice.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                    invoice.status === 'SENT' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {invoice.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-right">
                  <span className="text-teal-600 font-medium">
                    View →
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
