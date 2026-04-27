"use client"

import { useState } from "react"
import { formatCurrency } from "@/lib/utils"
import { format } from "date-fns"
import Link from "next/link"
import { Plus, FileText, Clock, CheckCircle2, Send } from "lucide-react"

interface Client {
  id: string
  name: string
  billingType: string
}

interface Job {
  id: string
  clientRate: number
  location: {
    client: Client
  }
}

interface ReadyToBillEntry {
  client: Client
  jobs: Job[]
  totalAmount: number
}

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: number
  dateCreated: Date
  dueDate: Date | null
  client: Client
}

interface InvoicesViewProps {
  invoices: Invoice[]
  readyToBill: ReadyToBillEntry[]
  drafts: Invoice[]
  waitingForPayment: Invoice[]
  paid: Invoice[]
}

export function InvoicesView({ invoices, readyToBill, drafts, waitingForPayment, paid }: InvoicesViewProps) {
  const [activeTab, setActiveTab] = useState<'ready' | 'drafts' | 'waiting' | 'paid'>('ready')
  
  const totalReadyAmount = readyToBill.reduce((sum, entry) => sum + entry.totalAmount, 0)
  
  const tabs = [
    { 
      id: 'ready' as const, 
      label: 'Ready to Invoice', 
      count: readyToBill.length,
      amount: totalReadyAmount,
      icon: Plus,
      color: 'text-emerald-600 bg-emerald-50'
    },
    { 
      id: 'drafts' as const, 
      label: 'Drafts', 
      count: drafts.length,
      icon: FileText,
      color: 'text-gray-600 bg-gray-100'
    },
    { 
      id: 'waiting' as const, 
      label: 'Waiting for Payment', 
      count: waitingForPayment.length,
      icon: Clock,
      color: 'text-amber-600 bg-amber-50'
    },
    { 
      id: 'paid' as const, 
      label: 'Paid', 
      count: paid.length,
      icon: CheckCircle2,
      color: 'text-gray-500 bg-gray-100'
    },
  ]
  
  return (
    <div className="px-8 pb-8">
      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? `${tab.color} shadow-sm`
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label} ({tab.count})
            {tab.amount !== undefined && activeTab === tab.id && (
              <span className="ml-1 px-2 py-0.5 bg-emerald-600 text-white text-xs rounded-full">
                {formatCurrency(tab.amount)}
              </span>
            )}
          </button>
        ))}
      </div>
      
      {/* Content */}
      <div className="space-y-3">
        {activeTab === 'ready' && (
          <>
            {readyToBill.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">All caught up!</p>
                <p className="text-gray-500">No completed jobs waiting to be invoiced.</p>
              </div>
            ) : (
              readyToBill.map((entry) => (
                <div key={entry.client.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-shadow">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-lg">{entry.client.name}</h3>
                    <p className="text-sm text-gray-500">
                      {entry.jobs.length} completed job{entry.jobs.length !== 1 ? 's' : ''} ready to bill
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-2xl font-bold text-teal-600">{formatCurrency(entry.totalAmount)}</p>
                      <p className="text-xs text-gray-400">to invoice</p>
                    </div>
                    <Link
                      href={`/invoices/new?clientId=${entry.client.id}`}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg font-medium hover:bg-teal-600 transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      Create Invoice
                    </Link>
                  </div>
                </div>
              ))
            )}
          </>
        )}
        
        {activeTab === 'drafts' && (
          <>
            {drafts.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">No draft invoices</p>
                <p className="text-gray-500">Draft invoices will appear here before you send them.</p>
              </div>
            ) : (
              drafts.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
                  <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-gray-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{invoice.client.name}</h3>
                        <p className="text-sm text-gray-500">
                          #{invoice.invoiceNumber} • Created {format(new Date(invoice.dateCreated), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-xl font-bold text-gray-900">{formatCurrency(invoice.totalAmount)}</p>
                      <button className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100">
                        <Send className="w-4 h-4" />
                        Send
                      </button>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </>
        )}
        
        {activeTab === 'waiting' && (
          <>
            {waitingForPayment.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">No pending invoices</p>
                <p className="text-gray-500">Invoices waiting for payment will appear here.</p>
              </div>
            ) : (
              waitingForPayment.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
                  <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{invoice.client.name}</h3>
                        <p className="text-sm text-gray-500">
                          #{invoice.invoiceNumber} • Due {invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d, yyyy") : 'On Receipt'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-xl font-bold text-amber-600">{formatCurrency(invoice.totalAmount)}</p>
                      <button className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium hover:bg-emerald-100">
                        <CheckCircle2 className="w-4 h-4" />
                        Mark Paid
                      </button>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </>
        )}
        
        {activeTab === 'paid' && (
          <>
            {paid.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">No paid invoices yet</p>
                <p className="text-gray-500">Paid invoices will appear here for your records.</p>
              </div>
            ) : (
              paid.map((invoice) => (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
                  <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer opacity-75">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{invoice.client.name}</h3>
                        <p className="text-sm text-gray-500">
                          #{invoice.invoiceNumber} • Paid {format(new Date(invoice.dateCreated), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-xl font-bold text-gray-600">{formatCurrency(invoice.totalAmount)}</p>
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                        Paid
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}




