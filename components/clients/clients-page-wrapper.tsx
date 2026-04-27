"use client"

import { useState, useMemo, useEffect } from "react"
import { mutate } from "swr"
import { useIsMobile } from "@/lib/hooks/use-media-query"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddClientWizard } from "./add-client-wizard"
import Link from "next/link"
import {
  Plus, Search, Phone, Mail,
  UserPlus, Building2, ChevronRight
} from "lucide-react"



import { EmptyState } from "@/components/ui/empty-state"

interface Location {
  id: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
}

interface Client {
  id: string
  name: string
  phone: string | null
  communicationEmail: string | null
  invoicingEmail: string | null
  billingType: string
  cleanerPayType?: string
  notes: string | null
  isActive: boolean
  createdAt: string
  locations: Location[]
}

interface ClientsPageWrapperProps {
  clients: Client[]
  prefillProspect?: {
    id: string
    businessName: string
    contactName: string | null
    phone: string | null
    email: string | null
    notes: string | null
  } | null
}

function SegmentedFilter({
  stats,
  onFilterChange,
  activeFilter
}: {
  stats: { total: number; active: number; inactive: number }
  onFilterChange: (filter: 'all' | 'active' | 'inactive') => void
  activeFilter: string
}) {
  const segments: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'active', label: 'Active', count: stats.active },
    { key: 'inactive', label: 'Inactive', count: stats.inactive },
  ]

  return (
    <div
      role="tablist"
      className="inline-flex items-center bg-gray-100 rounded-lg p-0.5"
    >
      {segments.map((seg) => (
        <button
          key={seg.key}
          role="tab"
          aria-selected={activeFilter === seg.key}
          onClick={() => onFilterChange(seg.key as 'all' | 'active' | 'inactive')}
          className={`
            flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-md text-sm font-medium
            transition-all duration-150 whitespace-nowrap
            ${activeFilter === seg.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
            }
          `}
        >
          {seg.label}
          <span className={`
            text-xs tabular-nums
            ${activeFilter === seg.key ? 'text-teal-600 font-semibold' : 'text-gray-400'}
          `}>
            {seg.count}
          </span>
        </button>
      ))}
    </div>
  )
}

function ClientCard({
  client,
  isHovered,
  onHover
}: {
  client: Client
  isHovered?: boolean
  onHover?: (clientId: string | null) => void
}) {
  const email = client.communicationEmail || client.invoicingEmail
  const status = !client.isActive ? 'inactive' : 'active'

  const getInitials = (name: string) =>
    name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const badgeLabel = status === 'inactive' ? 'Inactive' : 'Active'
  const badgeStyles = {
    active: { bg: 'rgba(0,168,150,0.1)', color: '#00A896' },
    inactive: { bg: 'rgba(0,0,0,0.06)', color: '#6B7280' },
  }[status]

  return (
    <Link
      href={`/clients/${client.id}`}
      onMouseEnter={() => onHover?.(client.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`
        block bg-white rounded-xl p-4 relative no-underline
        border transition-all duration-200 ease-out
        hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]
        active:scale-[0.98] active:shadow-sm
        ${isHovered
          ? 'border-teal-500 -translate-y-0.5 shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
          : 'border-gray-200'}
      `}
    >
      <ChevronRight
        className={`
          absolute top-4 right-4 w-[18px] h-[18px] flex-shrink-0
          text-gray-400 transition-transform duration-200
          ${isHovered ? 'translate-x-0.5' : ''}
        `}
      />

      <div className="flex items-start gap-3 mb-3 pr-6">
        <div
          className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[15px] font-semibold"
          style={{ backgroundColor: client.isActive ? '#00A896' : '#9CA3AF' }}
        >
          {getInitials(client.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold text-gray-900 leading-snug mb-1 break-words">
            {client.name}
          </p>
          <span
            className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: badgeStyles.color, backgroundColor: badgeStyles.bg }}
          >
            {badgeLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-gray-500">Billing</span>
          <span className="text-[13px] font-medium text-gray-700">
            {client.billingType === 'FLAT_RATE' ? 'Monthly' : 'Per Clean'}
          </span>
        </div>

        {client.locations.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Building2 className="w-[13px] h-[13px] text-gray-400 flex-shrink-0" />
            <span className="text-[13px] font-medium text-gray-900">
              {client.locations.length === 1
                ? client.locations[0].name || client.locations[0].address.split(',')[0]
                : `${client.locations.length} locations`}
            </span>
          </div>
        )}

        {client.phone && (
          <div className="flex items-center gap-1.5">
            <Phone className="w-[13px] h-[13px] text-gray-400 flex-shrink-0" />
            <span className="text-[13px] text-gray-500">{client.phone}</span>
          </div>
        )}

        {email && (
          <div className="flex items-center gap-1.5 overflow-hidden">
            <Mail className="w-[13px] h-[13px] text-gray-400 flex-shrink-0" />
            <span className="text-[13px] text-gray-500 truncate">
              {email}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}

export function ClientsPageWrapper({ clients, prefillProspect }: ClientsPageWrapperProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [showWizard, setShowWizard] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const isMobile = useIsMobile()

  // On mobile, always force card/grid view
  const [hoveredClientId, setHoveredClientId] = useState<string | null>(null)



  useEffect(() => {
    if (prefillProspect) {
      setShowWizard(true)
    }
  }, [prefillProspect])

  // Calculate stats
  const stats = useMemo(() => {
    return {
      total: clients.length,
      active: clients.filter(c => c.isActive).length,
      inactive: clients.filter(c => !c.isActive).length,
    }
  }, [clients])

  // Filter clients
  const filteredClients = useMemo(() => {
    let result = clients

    // Status filter
    if (statusFilter === 'active') {
      result = result.filter(c => c.isActive)
    } else if (statusFilter === 'inactive') {
      result = result.filter(c => !c.isActive)
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.communicationEmail?.toLowerCase().includes(query) ||
        c.phone?.includes(query)
      )
    }

    return result
  }, [clients, statusFilter, searchQuery])



  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="w-full px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="hidden sm:block text-xl font-semibold text-gray-900">Clients</h1>



            <Button
              onClick={() => setShowWizard(true)}
              size="sm"
              className="hidden sm:flex bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white px-4 h-10 shadow-md shadow-teal-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-teal-500/30 active:scale-95 ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Client
            </Button>
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-4">
        {/* Toolbar — card view only */}
        {
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <SegmentedFilter
              stats={stats}
              onFilterChange={setStatusFilter}
              activeFilter={statusFilter}
            />



            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clients..."
                className="pl-10 bg-white h-10"
              />
            </div>
          </div>
        }



        {filteredClients.length === 0 ? (
          searchQuery ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No results found</h3>
              <p className="text-gray-500 mb-4">
                No clients match &ldquo;{searchQuery}&rdquo;. Try a different search term.
              </p>
              <Button onClick={() => setSearchQuery('')} variant="outline">
                Clear Search
              </Button>
            </div>
          ) : statusFilter !== 'all' ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-10 h-10 text-gray-300" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                No {statusFilter} clients
              </h3>
              <p className="text-gray-500 mb-4">
                There are no clients matching this filter.
              </p>
              <Button onClick={() => setStatusFilter('all')} variant="outline">
                Show All Clients
              </Button>
            </div>
          ) : (
            <div onClick={() => setShowWizard(true)} className="cursor-pointer">
              <EmptyState
                icon={UserPlus}
                title="Welcome to Clean Freaks!"
                description="You haven't added any clients yet. Start by adding your first client with their location details to begin scheduling jobs and sending invoices."
                actionLabel="Add Your First Client"
                actionHref="#"
                secondaryActionLabel="Learn More"
                secondaryActionHref="/help"
              />
            </div>
          )
        ) : (
          <div
            key="cards"
            className="animate-fadeIn"
            style={{ animation: 'fadeIn 150ms ease-in-out' }}
          >
            <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  isHovered={hoveredClientId === client.id}
                  onHover={setHoveredClientId}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile FAB — fixed bottom right above bottom nav */}
      <button
        onClick={() => setShowWizard(true)}
        className="sm:hidden"
        style={{
          position: 'fixed',
          bottom: '90px',
          right: '20px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          backgroundColor: '#00A896',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,168,150,0.35)',
          border: 'none',
          cursor: 'pointer',
          zIndex: 40,
        }}
        aria-label="Add client"
      >
        <Plus style={{ width: '24px', height: '24px' }} />
      </button>

      {/* Add Client Wizard */}
      <AddClientWizard
        isOpen={showWizard}
        initialData={prefillProspect ? {
          sourceProspectId: prefillProspect.id,
          clientName: prefillProspect.businessName,
          phone: prefillProspect.phone,
          email: prefillProspect.email,
          communicationContactName: prefillProspect.contactName,
          notes: prefillProspect.notes,
        } : null}
        onClose={() => {
          setShowWizard(false)
          if (prefillProspect) router.replace('/clients')
        }}
        onSuccess={(clientId: string) => {
          mutate('/api/clients/data')
          mutate('/api/dashboard-stats')
          mutate('/api/calendar/data')

          // Navigate to the new client's profile for confirmation
          router.push(`/clients/${clientId}`)
        }}
      />
    </div>
  )
}
