"use client"

import { useState } from "react"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { formatDateOnly } from "@/lib/date-only"
import {
  Calendar, ArrowLeft,
  PauseCircle, PlayCircle, MoreHorizontal, Archive, Trash2,
} from "lucide-react"
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
    setShowAdditionalServiceChoice,
    setEditing,
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
      <div className="bg-white">
        <div className="px-4 sm:px-7 pt-3 pb-2">
          <button
            onClick={() => router.push('/clients')}
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-zinc-600 mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Clients
            <span className="text-zinc-300">/</span>
            <span className="text-zinc-600 font-medium truncate max-w-[50vw]">{client.name}</span>
          </button>

          {/* Single-row header */}
          <div className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 transition-all duration-500 ${fadeIn}`}>
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight" style={{ color: '#18181B' }}>{client.name}</h1>
              <div className="flex items-center gap-2 text-[13px] flex-wrap mt-1" style={{ color: '#52525B' }}>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                  {isActive ? 'Active' : 'Paused'}
                </span>
                <span>{client.billingType === 'FLAT_RATE' ? 'Monthly flat rate' : 'Per clean'}</span>
                <span className="text-zinc-300">·</span>
                <span>{locationCount} location{locationCount !== 1 ? 's' : ''}</span>
                <span className="text-zinc-300">·</span>
                <span>Since {formatDateOnly(stats.clientSince) || '—'}</span>
                {nextClean && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(13,148,136,0.08)', color: '#0D9488' }}>
                    <Calendar className="w-3 h-3" />
                    Next: {nextClean.date}{nextClean.time ? ` at ${nextClean.time}` : ''}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
              <div className="text-right">
                <p style={{ fontSize: 11, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stats.isEstimate ? 'Est. Revenue' : `${stats.monthLabel} Revenue`}</p>
                <p className="font-bold text-sm sm:text-[17px]" style={{ color: '#18181B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCurrency(stats.monthlyRevenue)}</p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="text-right">
                <p style={{ fontSize: 11, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stats.isEstimate ? 'Est. Profit' : `${stats.monthLabel} Profit`}</p>
                <p className="font-bold text-sm sm:text-[17px]" style={{ color: stats.monthlyProfit >= 0 ? '#16A34A' : '#DC2626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatCurrency(stats.monthlyProfit)}</p>
              </div>
            </div>
          </div>


        </div>
      </div>

      {/* Action bar — merged into the header (single bottom border) */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-7 pt-1 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAdditionalServiceChoice(true)}
            className="px-4 py-1.5 text-[12px] font-semibold rounded-md text-white transition-opacity hover:opacity-90"
            style={{ background: '#0D9488' }}
          >
            Add Add-on
          </button>
          <button
            onClick={() => setEditing(true)}
            className="px-4 py-1.5 text-[12px] font-semibold rounded-md bg-white hover:bg-gray-50 transition-colors"
            style={{ border: '1px solid #E4E4E7', color: '#52525B' }}
          >
            Edit
          </button>

          {/* Overflow menu */}
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-white hover:bg-gray-50 transition-colors"
              style={{ border: '1px solid #E4E4E7' }}
            >
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </button>
            {showOverflow && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[200px]">
                  <button
                    onClick={() => { setShowOverflow(false); handleTogglePause() }}
                    disabled={isTogglingPause}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    {isPauseAction ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                    {isPauseAction ? (isTogglingPause ? 'Pausing…' : 'Pause service') : (isTogglingPause ? 'Resuming…' : 'Resume service')}
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => {
                      if (!isActive || isArchivingClient) return
                      setShowOverflow(false)
                      handleArchiveClient()
                    }}
                    disabled={!isActive || isArchivingClient}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: '#D97706' }}
                  >
                    <Archive className="w-4 h-4" />
                    {isArchivingClient ? 'Archiving…' : 'Archive client'}
                  </button>
                  <button
                    onClick={() => { setShowOverflow(false); handleDeleteClient() }}
                    disabled={isDeletingClient}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isDeletingClient ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
