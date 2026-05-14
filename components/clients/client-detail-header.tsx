"use client"

import { useState } from "react"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { format } from "date-fns"
import {
  Plus, Edit, Calendar, Receipt, ArrowLeft,
  PauseCircle, PlayCircle, MoreHorizontal, Archive, Trash2,
} from "lucide-react"
import { getInitials } from "./client-detail-helpers"
import type { ClientDetailState } from "./use-client-detail"

interface ClientDetailHeaderProps {
  state: ClientDetailState
}

export function ClientDetailHeader({ state }: ClientDetailHeaderProps) {
  const {
    router,
    client,
    stats,
    nextClean,
    isActive,
    locationCount,
    fadeIn,
    isTogglingPause,
    pauseResumeAction,
    handleTogglePause,
    handleGenerateInvoice,
    setShowAdditionalServiceChoice,
    setEditing,
    clientHasHistory,
    handleArchiveClient,
    handleDeleteClient,
    isArchivingClient,
    isDeletingClient,
  } = state

  const [showOverflow, setShowOverflow] = useState(false)
  const isPauseAction = isTogglingPause ? pauseResumeAction === 'pause' : isActive

  return (
    <>
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-4 sm:px-6 py-4">
          <button
            onClick={() => router.push('/clients')}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-2.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Clients
          </button>

          {/* Single-row header */}
          <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 transition-all duration-500 ${fadeIn}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold" style={{ background: '#00A896' }}>
                {getInitials(client.name)}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 leading-tight">{client.name}</h1>
                <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
                  <span>{locationCount} location{locationCount !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{client.billingType === 'FLAT_RATE' ? 'Monthly flat rate' : 'Per clean'}</span>
                  <span>·</span>
                  <span>Since {stats.clientSince ? format(stats.clientSince, 'MMM d, yyyy') : '—'}</span>
                  {nextClean && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,168,150,0.08)', color: '#00A896' }}>
                        <Calendar className="w-3 h-3" />
                        Next: {nextClean.date}{nextClean.time ? ` at ${nextClean.time}` : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
              <div className="text-right">
                <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stats.isEstimate ? 'Est. Revenue' : `${stats.monthLabel} Revenue`}</p>
                <p className="font-bold text-gray-900 text-sm sm:text-[17px]" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCurrency(stats.monthlyRevenue)}</p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="text-right">
                <p style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stats.isEstimate ? 'Est. Profit' : `${stats.monthLabel} Profit`}</p>
                <p className="font-bold text-sm sm:text-[17px]" style={{ color: '#00A896', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCurrency(stats.monthlyProfit)}</p>
              </div>
              <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                {isActive ? 'Active' : 'Paused'}
              </div>
            </div>
          </div>


        </div>
      </div>

      {/* Action Buttons */}
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleGenerateInvoice}
            disabled={creatingInvoice}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
            style={{ background: '#00A896', color: '#FFFFFF' }}
          >
            <Receipt className="w-4 h-4" />
            {creatingInvoice ? 'Generating...' : 'Generate Invoice'}
          </button>
          <button
            onClick={() => setShowAdditionalServiceChoice(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={{ border: '1px solid #E0E0E0', color: '#374151' }}
          >
            <Plus className="w-4 h-4" />
            Add Add-on
          </button>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white hover:bg-gray-50 transition-colors"
            style={{ border: '1px solid #E0E0E0', color: '#374151' }}
          >
            <Edit className="w-4 h-4" />
            <span className="hidden sm:inline">Edit</span>
          </button>
          <button
            onClick={handleTogglePause}
            disabled={isTogglingPause}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
            style={{ border: '1px solid #E0E0E0', color: isPauseAction ? '#6B7280' : '#00A896' }}
          >
            {isPauseAction ? (
              <>
                <PauseCircle className="w-4 h-4" />
                <span className="hidden sm:inline">{isTogglingPause ? 'Pausing…' : 'Pause Client'}</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                <span className="hidden sm:inline">{isTogglingPause ? 'Resuming…' : 'Resume Client'}</span>
              </>
            )}
          </button>

          {/* Overflow menu */}
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white hover:bg-gray-50 transition-colors"
              style={{ border: '1px solid #E0E0E0' }}
            >
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </button>
            {showOverflow && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[180px]">
                  {clientHasHistory ? (
                    <button
                      onClick={() => {
                        if (!isActive || isArchivingClient) return
                        setShowOverflow(false)
                        handleArchiveClient()
                      }}
                      disabled={!isActive || isArchivingClient}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        color: '#D97706',
                        backgroundColor: 'transparent',
                      }}
                    >
                      <Archive className="w-4 h-4" />
                      {isArchivingClient ? 'Archiving...' : 'Archive Client'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { setShowOverflow(false); handleDeleteClient() }}
                      disabled={isDeletingClient}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                      {isDeletingClient ? 'Deleting...' : 'Delete Permanently'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
