"use client"

import { CheckCircle, Clock } from "lucide-react"
import { InvoiceWithRelations } from "@/types"

interface InvoicePaymentSectionProps {
  invoice: InvoiceWithRelations
  onPaymentSuccess: () => void
  compact?: boolean
}

export function InvoicePaymentSection({ invoice, onPaymentSuccess, compact = false }: InvoicePaymentSectionProps) {
  // Show paid status
  if (invoice.status === 'PAID') {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-white">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 mb-3">
          <CheckCircle className="w-6 h-6" />
        </div>
        <h3 className="text-xl font-bold mb-1">Payment Complete</h3>
        <p className="text-slate-300 text-sm">Thank you for your payment!</p>
      </div>
    )
  }

  // Payment pending
  return (
    <div className="bg-slate-800 rounded-xl p-6 text-center text-white">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 mb-3">
        <Clock className="w-6 h-6" />
      </div>
      <h3 className="text-xl font-bold mb-1">Payment Pending</h3>
      <p className="text-slate-300 text-sm">Please contact us for payment arrangements.</p>
    </div>
  )
}
