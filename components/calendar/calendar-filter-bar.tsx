"use client"

import { useState, useMemo } from "react"
import { ChevronDown, Check, X } from "lucide-react"
import { getCleanerColorInfo, CLEANER_HEX_COLORS } from "@/lib/calendar-design-tokens"

interface Subcontractor {
  id: string
  name: string
}

interface Client {
  id: string
  name: string
}

interface CalendarFilterBarProps {
  subcontractors: Subcontractor[]
  clients: Client[]
  selectedCleanerIds: Set<string>
  selectedClientId: string | null  // Changed to single-select
  onCleanerFilterChange: (cleanerIds: Set<string>) => void
  onClientFilterChange: (clientId: string | null) => void  // Changed to single-select
  showUnassigned: boolean
  onUnassignedChange: (show: boolean) => void
}

export function CalendarFilterBar({
  subcontractors,
  clients,
  selectedCleanerIds,
  selectedClientId,
  onCleanerFilterChange,
  onClientFilterChange,
  showUnassigned,
  onUnassignedChange,
}: CalendarFilterBarProps) {
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const [clientSearch, setClientSearch] = useState("")

  // Get cleaners with their colors
  const cleanersWithColors = useMemo(() => {
    return subcontractors.map(sub => ({
      ...sub,
      ...getCleanerColorInfo(sub.name),
    }))
  }, [subcontractors])

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients
    const search = clientSearch.toLowerCase()
    return clients.filter(c => c.name.toLowerCase().includes(search))
  }, [clients, clientSearch])

  // Toggle cleaner selection
  const toggleCleaner = (cleanerId: string) => {
    const newSet = new Set(selectedCleanerIds)
    if (newSet.has(cleanerId)) {
      newSet.delete(cleanerId)
    } else {
      newSet.add(cleanerId)
    }
    onCleanerFilterChange(newSet)
  }

  // Select a single client (or null for all)
  const selectClient = (clientId: string | null) => {
    onClientFilterChange(clientId)
    setClientDropdownOpen(false)
    setClientSearch("")
  }

  // Select all cleaners
  const selectAllCleaners = () => {
    onCleanerFilterChange(new Set(subcontractors.map(s => s.id)))
    onUnassignedChange(true)
  }

  // Deselect all cleaners
  const deselectAllCleaners = () => {
    onCleanerFilterChange(new Set())
    onUnassignedChange(false)
  }

  // Check if all cleaners are selected
  const allCleanersSelected = selectedCleanerIds.size === subcontractors.length && showUnassigned

  // Get selected client name
  const selectedClientName = selectedClientId 
    ? clients.find(c => c.id === selectedClientId)?.name || 'Unknown'
    : null

  return (
    <div className="flex flex-wrap items-center gap-3 px-2 py-2 bg-gray-50 rounded-lg border border-gray-200">
      {/* Cleaners Section */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Cleaners:</span>
        
        {/* Cleaner Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {cleanersWithColors.map(cleaner => {
            const isSelected = selectedCleanerIds.has(cleaner.id)
            return (
              <button
                key={cleaner.id}
                onClick={() => toggleCleaner(cleaner.id)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                  transition-all duration-150 ease-out
                  ${isSelected 
                    ? 'bg-white shadow-sm border border-gray-200 text-gray-800' 
                    : 'bg-gray-200/50 text-gray-400 border border-transparent'
                  }
                  hover:shadow-md hover:scale-105
                `}
                title={isSelected ? `Hide ${cleaner.name}'s jobs` : `Show ${cleaner.name}'s jobs`}
              >
                <span 
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ 
                    backgroundColor: cleaner.hex,
                    opacity: isSelected ? 1 : 0.4,
                  }}
                />
                <span className="truncate max-w-[80px]">{cleaner.name.split(' ')[0]}</span>
                {isSelected && <Check className="w-3 h-3 text-gray-500" />}
              </button>
            )
          })}
          
          {/* Unassigned Pill */}
          <button
            onClick={() => onUnassignedChange(!showUnassigned)}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
              transition-all duration-150 ease-out
              ${showUnassigned 
                ? 'bg-white shadow-sm border border-gray-200 text-gray-800' 
                : 'bg-gray-200/50 text-gray-400 border border-transparent'
              }
              hover:shadow-md hover:scale-105
            `}
            title={showUnassigned ? 'Hide unassigned jobs' : 'Show unassigned jobs'}
          >
            <span 
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ 
                backgroundColor: CLEANER_HEX_COLORS.red,
                opacity: showUnassigned ? 1 : 0.4,
              }}
            />
            <span>Unassigned</span>
            {showUnassigned && <Check className="w-3 h-3 text-gray-500" />}
          </button>
        </div>

        {/* Show/Hide All */}
        <button
          onClick={allCleanersSelected ? deselectAllCleaners : selectAllCleaners}
          className="text-xs text-teal-600 hover:text-teal-700 font-medium whitespace-nowrap"
        >
          {allCleanersSelected ? 'Hide All' : 'Show All'}
        </button>
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-gray-300" />

      {/* Clients Section - Single Select */}
      <div className="flex items-center gap-2 relative">
        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Client:</span>
        
        {/* Client Dropdown - Single Select */}
        <div className="relative">
          <button
            onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
              bg-white border shadow-sm
              hover:shadow-md transition-all duration-150
              ${selectedClientId 
                ? 'border-teal-500 ring-2 ring-teal-500/20 text-teal-700' 
                : 'border-gray-200 text-gray-700'
              }
            `}
          >
            <span className="truncate max-w-[150px]">
              {selectedClientName || 'All Clients'}
            </span>
            {selectedClientId ? (
              <X 
                className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" 
                onClick={(e) => {
                  e.stopPropagation()
                  selectClient(null)
                }}
              />
            ) : (
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${clientDropdownOpen ? 'rotate-180' : ''}`} />
            )}
          </button>

          {/* Dropdown Menu - Single Select */}
          {clientDropdownOpen && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => {
                  setClientDropdownOpen(false)
                  setClientSearch("")
                }}
              />
              
              {/* Menu */}
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
                {/* Search */}
                <div className="p-2 border-b border-gray-100">
                  <input
                    type="text"
                    placeholder="Search clients..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                    autoFocus
                  />
                </div>

                {/* Client List */}
                <div className="max-h-64 overflow-y-auto">
                  {/* All Clients Option */}
                  <button
                    onClick={() => selectClient(null)}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left font-medium
                      hover:bg-gray-50 transition-colors border-b border-gray-100
                      ${!selectedClientId ? 'bg-teal-50 text-teal-700' : 'text-gray-700'}
                    `}
                  >
                    {!selectedClientId && <Check className="w-4 h-4 text-teal-600" />}
                    <span className={!selectedClientId ? '' : 'ml-6'}>All Clients</span>
                  </button>

                  {/* Individual Clients */}
                  {filteredClients.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500 text-center">
                      No clients found
                    </div>
                  ) : (
                    filteredClients.map(client => {
                      const isSelected = selectedClientId === client.id
                      return (
                        <button
                          key={client.id}
                          onClick={() => selectClient(client.id)}
                          className={`
                            w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                            hover:bg-gray-50 transition-colors
                            ${isSelected ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700'}
                          `}
                        >
                          {isSelected && <Check className="w-4 h-4 text-teal-600" />}
                          <span className={isSelected ? '' : 'ml-6'}>{client.name}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
