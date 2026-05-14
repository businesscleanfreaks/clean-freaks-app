"use client"

import { useClientDetail } from "./use-client-detail"
import { ClientDetailHeader } from "./client-detail-header"
import { ClientDetailLocations } from "./client-detail-locations"
import { ClientDetailSidebar, ClientDetailJobFeed } from "./client-detail-sidebar"
import { ClientDetailModals } from "./client-detail-modals"
import type { ClientWithDetails } from "@/lib/types"

interface ClientDetailViewProps {
  client: ClientWithDetails
  onDataChange?: () => void
}

export function ClientDetailView({ client: initialClient, onDataChange }: ClientDetailViewProps) {
  const state = useClientDetail({ client: initialClient, onDataChange })
  const { mounted, ConfirmDialog } = state

  if (!mounted) {
    return (
      <>
        <ConfirmDialog />
        <div style={{ minHeight: '100vh', background: '#F9FAFB' }}>
          <div className="bg-white border-b border-gray-200">
            <div className="px-4 sm:px-6 py-4">
              <div className="h-5 w-28 rounded bg-gray-100 mb-4" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
                  <div className="space-y-2 min-w-0">
                    <div className="h-6 w-48 rounded bg-gray-100" />
                    <div className="h-4 w-64 rounded bg-gray-100" />
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-gray-100" />
                    <div className="h-5 w-24 rounded bg-gray-100" />
                  </div>
                  <div className="w-px h-8 bg-gray-200" />
                  <div className="space-y-2 text-right">
                    <div className="h-3 w-20 rounded bg-gray-100" />
                    <div className="h-5 w-24 rounded bg-gray-100" />
                  </div>
                  <div className="h-8 w-20 rounded-full bg-gray-100" />
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-6 py-6 space-y-4">
            <div className="h-24 rounded-2xl bg-white border border-gray-200/60" />
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="h-72 rounded-2xl bg-white border border-gray-200/60" />
              <div className="h-72 rounded-2xl bg-white border border-gray-200/60" />
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <ClientDetailModals state={state} />

      <div style={{ minHeight: '100vh', background: '#F9FAFB', overscrollBehavior: 'none' }}>
        <ClientDetailHeader state={state} />

        {/* Main Body */}
        <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
            {/* LEFT COLUMN: Locations → Contact → Delete */}
            <div className="space-y-5 order-2 lg:order-1">
              <ClientDetailLocations state={state} />
              <ClientDetailSidebar state={state} />
            </div>

            {/* RIGHT COLUMN: Job Feed (sticky on desktop) */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start">
              <ClientDetailJobFeed state={state} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
