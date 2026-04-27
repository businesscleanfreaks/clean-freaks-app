"use client"

import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { X, Receipt, CheckCircle } from "lucide-react"
import type { ClientWithDetails, ClientJobSummary } from "@/lib/types"
import type { ClientLocation } from "./client-detail-types"

interface ClientInvoiceModalProps {
  client: ClientWithDetails
  onClose: () => void
  onCreateInvoice: () => void
  creatingInvoice: boolean
}

export function ClientInvoiceModal({ client, onClose, onCreateInvoice, creatingInvoice }: ClientInvoiceModalProps) {
  // Collect uninvoiced jobs with details - only jobs that have already happened
  const today = new Date()
  today.setHours(23, 59, 59, 999) // End of today
  const uninvoicedJobs: { id: string; date: Date; locationName: string; rate: number; scheduleId: string | null }[] = []
  client.locations?.forEach((loc: ClientLocation) => {
    loc.jobs?.forEach((job: ClientJobSummary) => {
      const jobDate = new Date(job.date)
      // Only include completed jobs that are in the past (not future jobs)
      if (job.status === 'COMPLETED' && !job.invoiced && jobDate <= today) {
        uninvoicedJobs.push({
          id: job.id,
          date: jobDate,
          locationName: loc.name || 'Unknown Location',
          rate: job.clientRate || 0,
          scheduleId: job.scheduleId || null
        })
      }
    })
  })
  // Sort by date
  uninvoicedJobs.sort((a, b) => a.date.getTime() - b.date.getTime())
  const uninvoicedCount = uninvoicedJobs.length
  
  // For FLAT_RATE billing, group by schedule and calculate monthly rate
  let lineItems: { key: string; label: string; description: string; amount: number }[] = []
  let invoiceTotal = 0
  
  if (client.billingType === 'FLAT_RATE') {
    // Group jobs by scheduleId to get one flat rate per schedule
    const scheduleGroups = new Map<string, typeof uninvoicedJobs>()
    const oneOffJobs: typeof uninvoicedJobs = []
    
    uninvoicedJobs.forEach(job => {
      if (job.scheduleId) {
        if (!scheduleGroups.has(job.scheduleId)) {
          scheduleGroups.set(job.scheduleId, [])
        }
        scheduleGroups.get(job.scheduleId)!.push(job)
      } else {
        oneOffJobs.push(job)
      }
    })
    
    // Create one line item per schedule (monthly flat rate)
    scheduleGroups.forEach((jobs, scheduleId) => {
      if (jobs.length > 0) {
        const firstJob = jobs[0]
        const monthName = firstJob.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        // Use the rate from the first job (which is the schedule's flat rate)
        lineItems.push({
          key: scheduleId,
          label: `Monthly Janitorial Services - ${firstJob.locationName}`,
          description: `${monthName} (${jobs.length} clean${jobs.length > 1 ? 's' : ''} included)`,
          amount: firstJob.rate
        })
        invoiceTotal += firstJob.rate
      }
    })
    
    // Add one-off jobs separately (these are additional charges)
    oneOffJobs.forEach((job, idx) => {
      const dateStr = job.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      lineItems.push({
        key: `oneoff-${idx}`,
        label: `Additional Service - ${job.locationName}`,
        description: dateStr,
        amount: job.rate
      })
      invoiceTotal += job.rate
    })
  } else {
    // PER_CLEAN billing: one line per job
    uninvoicedJobs.forEach((job, idx) => {
      const dateStr = job.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      lineItems.push({
        key: job.id,
        label: job.locationName,
        description: dateStr,
        amount: job.rate
      })
      invoiceTotal += job.rate
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-6 py-5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Receipt className="w-6 h-6" style={{ color: '#FFFFFF' }} />
              </div>
              <div>
                <h2 className="text-xl font-bold" style={{ color: '#FFFFFF' }}>Generate Invoice</h2>
                {/* v2 - flat rate fix */}
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>{client.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/20 transition-colors duration-150" aria-label="Close">
              <X className="w-5 h-5 text-white/80" />
            </button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          {uninvoicedCount > 0 ? (
            <>
              {/* Line Items */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-stone-500 uppercase tracking-wider font-semibold mb-3">Line Items</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {lineItems.map((item) => (
                    <div key={item.key} className="flex justify-between items-start text-sm bg-white rounded-lg p-3 border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{item.label}</p>
                        <p className="text-xs text-stone-500">{item.description}</p>
                      </div>
                      <span className="font-semibold text-gray-900 ml-3">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-stone-500 uppercase tracking-wider font-semibold mb-3">Invoice Summary</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Billing Type</span>
                    <span className="font-medium text-gray-900">{client.billingType === 'FLAT_RATE' ? 'Monthly Flat Rate' : 'Per Clean'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Jobs Included</span>
                    <span className="font-medium text-gray-900">{uninvoicedCount}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                    <span className="text-gray-700 font-medium">Total Amount</span>
                    <span className="font-bold text-teal-700 text-lg">{formatCurrency(invoiceTotal)}</span>
                  </div>
                </div>
              </div>
  
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                <p className="text-sm text-amber-800">
                  <strong>Invoice will be sent to:</strong><br />
                  {client.invoicingEmail || client.communicationEmail || 'No email set'}
                </p>
              </div>
              
              <div className="flex gap-3">
                <Button variant="outline" onClick={onClose} className="flex-1" disabled={creatingInvoice}>
                  Cancel
                </Button>
                <Button onClick={onCreateInvoice} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white shadow-sm" disabled={creatingInvoice}>
                  {creatingInvoice ? (
                    <>
                      <div className="w-4 h-4 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4 mr-2" />
                      Create Invoice
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center py-6">
                <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-stone-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Jobs to Invoice</h3>
                <p className="text-sm text-stone-500 mb-4">
                  All completed jobs have already been invoiced, or there are no completed jobs yet.
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="w-full">
                Close
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
