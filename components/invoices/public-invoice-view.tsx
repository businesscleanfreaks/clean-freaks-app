"use client"

import { useState } from "react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Download, Shield, Lock, CheckCircle, ChevronDown, ChevronUp, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InvoiceWithRelations } from "@/types"
import { InvoicePaymentSection } from "./invoice-payment-section"
import { groupInvoiceLineItems } from "@/lib/invoice-grouping"

interface PublicInvoiceViewProps {
  invoice: InvoiceWithRelations
}

export function PublicInvoiceView({ invoice }: PublicInvoiceViewProps) {
  const [showAllDetails, setShowAllDetails] = useState(false)

  const handleDownloadPDF = () => {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, '_blank')
    }
  }

  const isPaid = invoice.status === 'PAID'

  // Group per-clean visits into summary lines (matches the PDF + emailed copy).
  const groupedRows = groupInvoiceLineItems(invoice.lineItems, { billingType: invoice.client.billingType })
  const previewRows = groupedRows.slice(0, 2)
  const hasMoreItems = groupedRows.length > 2

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Premium Header */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo */}
            <div className="w-11 h-11 bg-gradient-to-br from-teal-600 to-teal-700 rounded-xl flex items-center justify-center shadow-md shadow-teal-500/20">
              <span className="text-white font-bold text-base">CF</span>
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900 tracking-tight">The Clean Freaks</h1>
              <p className="text-xs text-slate-400 tracking-wide uppercase">Janitorial Services</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full">
            <Lock className="w-3.5 h-3.5 text-green-500" />
            <span className="font-medium">Secure Payment</span>
          </div>
        </div>
      </header>

      {/* Two-Column Layout */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 min-h-[calc(100vh-200px)]">
          
          {/* Left Column - Invoice Summary (3/5 width on desktop) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Invoice Summary Card */}
            <div className="bg-white shadow-xl shadow-slate-200/50 border border-slate-200/80 rounded-xl overflow-hidden">
              
              {/* Invoice Header */}
              <div className="px-8 py-6 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Invoice</p>
                    <p className="font-bold text-slate-900 text-xl">{invoice.invoiceNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Date</p>
                    <p className="font-bold text-slate-900 text-xl">{formatDate(invoice.dateCreated)}</p>
                  </div>
                </div>
              </div>

              {/* Invoice Body */}
              <div className="p-8">
                {/* Bill To */}
                <div className="bg-slate-50/80 rounded-lg p-5 mb-6 border border-slate-100">
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Bill To</p>
                  <p className="font-bold text-slate-900 text-lg">{invoice.client.name}</p>
                </div>

                {/* Line Items */}
                <div className="mb-6">
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-4">Services</p>
                  <div className="space-y-3">
                    {previewRows.map((row) => (
                      <div key={row.key} className="flex justify-between items-start py-3 border-b border-slate-100 last:border-b-0">
                        <div className="flex-1 pr-6">
                          <p className="font-medium text-slate-900">{row.description}</p>
                          {row.grouped && (
                            <p className="text-sm text-slate-500 mt-0.5">{row.quantity} visits × {formatCurrency(row.unitPrice)}</p>
                          )}
                        </div>
                        <p className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatCurrency(row.amount)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Expandable Full Details */}
                  {showAllDetails && hasMoreItems && (
                    <div className="space-y-3 mt-3 pt-3 border-t border-slate-100">
                      {groupedRows.slice(2).map((row) => (
                        <div key={row.key} className="flex justify-between items-start py-3 border-b border-slate-100 last:border-b-0">
                          <div className="flex-1 pr-6">
                            <p className="font-medium text-slate-900">{row.description}</p>
                            {row.grouped && (
                              <p className="text-sm text-slate-500 mt-0.5">{row.quantity} visits × {formatCurrency(row.unitPrice)}</p>
                            )}
                          </div>
                          <p className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatCurrency(row.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* View More Button */}
                  {hasMoreItems && (
                    <button
                      onClick={() => setShowAllDetails(!showAllDetails)}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 mt-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 transition-all"
                    >
                      {showAllDetails ? (
                        <>
                          <ChevronUp className="w-4 h-4" />
                          Hide Additional Items
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          View All {groupedRows.length} Items
                        </>
                      )}
                    </button>
                  )}

                  {/* Total Row */}
                  <div className="flex justify-between items-center pt-5 mt-4 border-t-2 border-slate-200">
                    <p className="font-bold text-slate-900 text-lg">Total</p>
                    <p className="font-bold text-2xl text-teal-700">{formatCurrency(invoice.totalAmount)}</p>
                  </div>
                </div>

                {/* Download PDF */}
                {invoice.pdfUrl && (
                  <Button
                    onClick={handleDownloadPDF}
                    variant="outline"
                    className="w-full text-slate-600 border-slate-300 hover:bg-slate-50 hover:border-slate-400 transition-all"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF Invoice
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Payment Section (2/5 width on desktop, sticky) */}
          <div className="lg:col-span-2 lg:sticky lg:top-24 lg:self-start space-y-6">
            {/* Payment Card */}
            <div className="bg-white shadow-xl shadow-slate-200/50 border border-slate-200/80 rounded-xl overflow-hidden">
              {/* Amount Due Header - Compact with high contrast */}
              {isPaid ? (
                <div style={{ backgroundColor: '#0f172a' }} className="px-5 py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle className="w-5 h-5" style={{ color: '#ffffff' }} />
                    <p className="font-bold text-base" style={{ color: '#ffffff' }}>Payment Complete</p>
                  </div>
                </div>
              ) : (
                <div style={{ backgroundColor: '#0f172a' }} className="px-5 py-5 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#ffffff' }}>Amount Due</p>
                  <p className="text-3xl font-bold tracking-tight" style={{ color: '#ffffff' }}>{formatCurrency(invoice.totalAmount)}</p>
                </div>
              )}

              {/* Payment Section */}
              {!isPaid && invoice.showPaymentOptions !== false && (
                <div className="p-6">
                  <InvoicePaymentSection 
                    invoice={invoice} 
                    onPaymentSuccess={() => {
                      window.location.reload()
                    }}
                    compact={true}
                  />
                </div>
              )}

              {/* Payment Instructions (when payment options disabled) */}
              {!isPaid && invoice.showPaymentOptions === false && (
                <div className="p-6 text-center">
                  <p className="text-slate-700 font-medium">
                    Please pay using your usual payment method.
                  </p>
                </div>
              )}

              {/* Trust Badges - Subtle gray */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-center gap-6">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Shield className="w-4 h-4 text-slate-400" />
                    <span className="font-medium">Secure & Encrypted</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Lock className="w-4 h-4 text-slate-400" />
                    <span className="font-medium">SSL Protected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Spans full width */}
        <footer className="text-center py-8 mt-8 border-t border-slate-200">
          <p className="text-sm text-slate-600 font-medium mb-3">
            Questions about this invoice?
          </p>
          <a 
            href="mailto:invoices@thecleanfreaks.co" 
            className="inline-flex items-center gap-2 text-teal-600 hover:text-teal-700 font-medium transition-colors text-sm"
          >
            <Mail className="w-4 h-4" />
            invoices@thecleanfreaks.co
          </a>
          <p className="text-xs text-slate-400 mt-6">
            © {new Date().getFullYear()} The Clean Freaks • Professional Janitorial Services
          </p>
        </footer>
      </main>
    </div>
  )
}
