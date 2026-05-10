"use client"

import { useState, useMemo, useEffect } from "react"
import { X, Search, Check } from "lucide-react"
import { Subcontractor, ClientWithLocations } from "@/types"
import { getCleanerColorInfo, CLEANER_HEX_COLORS } from "@/lib/calendar-design-tokens"

interface CalendarFilterDrawerProps {
  isOpen: boolean
  onClose: () => void
  subcontractors: Subcontractor[]
  clients: ClientWithLocations[]
  selectedCleanerIds: Set<string>
  setSelectedCleanerIds: (ids: Set<string>) => void
  filterBarClientIds: Set<string>
  setFilterBarClientIds: (ids: Set<string>) => void
  showUnassigned: boolean
  setShowUnassigned: (show: boolean) => void
}

export function CalendarFilterDrawer({
  isOpen,
  onClose,
  subcontractors,
  clients,
  selectedCleanerIds,
  setSelectedCleanerIds,
  filterBarClientIds,
  setFilterBarClientIds,
  showUnassigned,
  setShowUnassigned,
}: CalendarFilterDrawerProps) {
  const [clientSearchQuery, setClientSearchQuery] = useState("")

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const isAllCleanersSelected = selectedCleanerIds.size === subcontractors.length && showUnassigned
  const isAllClientsSelected = filterBarClientIds.size === 0

  const handleAllCleanersClick = () => {
    setSelectedCleanerIds(new Set(subcontractors.map(s => s.id)))
    setShowUnassigned(true)
  }

  const handleCleanerClick = (cleanerId: string) => {
    if (isAllCleanersSelected) {
      setSelectedCleanerIds(new Set([cleanerId]))
      setShowUnassigned(false)
    } else {
      const next = new Set(selectedCleanerIds)
      if (next.has(cleanerId)) {
        next.delete(cleanerId)
        if (next.size === 0 && !showUnassigned) {
          handleAllCleanersClick()
          return
        }
      } else {
        next.add(cleanerId)
      }
      setSelectedCleanerIds(next)
    }
  }

  const handleUnassignedClick = () => {
    if (isAllCleanersSelected) {
      setSelectedCleanerIds(new Set())
      setShowUnassigned(true)
    } else {
      const nextShow = !showUnassigned
      setShowUnassigned(nextShow)
      if (!nextShow && selectedCleanerIds.size === 0) {
        handleAllCleanersClick()
      }
    }
  }

  const handleAllClientsClick = () => {
    setFilterBarClientIds(new Set())
  }

  const handleClientClick = (clientId: string) => {
    const next = new Set(filterBarClientIds)
    if (next.has(clientId)) {
      next.delete(clientId)
    } else {
      next.add(clientId)
    }
    setFilterBarClientIds(next)
  }

  const filteredClients = useMemo(() => {
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name))
    if (!clientSearchQuery.trim()) return sorted
    const q = clientSearchQuery.toLowerCase()
    return sorted.filter(c => c.name.toLowerCase().includes(q))
  }, [clients, clientSearchQuery])

  const clearAllFilters = () => {
    handleAllCleanersClick()
    handleAllClientsClick()
  }

  // Prevent background scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[340px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Filters</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-8">
          
          {/* Team Filters */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Team</h3>
            
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <input 
                  type="checkbox" 
                  checked={isAllCleanersSelected}
                  onChange={handleAllCleanersClick}
                  className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-600"
                />
                <span className="text-sm font-medium text-gray-900">All Team Members</span>
              </label>

              {subcontractors.map(sub => {
                const { hex } = getCleanerColorInfo(sub.name)
                const isChecked = selectedCleanerIds.has(sub.id) && !isAllCleanersSelected
                return (
                  <label key={sub.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <input 
                      type="checkbox" 
                      checked={isChecked}
                      onChange={() => handleCleanerClick(sub.id)}
                      className="w-4 h-4 rounded border-gray-300 focus:ring-teal-600"
                      style={{ accentColor: hex }}
                    />
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                      <span className="text-sm font-medium text-gray-700">{sub.name}</span>
                    </div>
                  </label>
                )
              })}

              <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <input 
                  type="checkbox" 
                  checked={showUnassigned && !isAllCleanersSelected}
                  onChange={handleUnassignedClick}
                  className="w-4 h-4 rounded border-gray-300 text-red-500 focus:ring-red-500"
                  style={{ accentColor: CLEANER_HEX_COLORS.red }}
                />
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CLEANER_HEX_COLORS.red }} />
                  <span className="text-sm font-medium text-gray-700">Unassigned</span>
                </div>
              </label>
            </div>
          </div>

          {/* Client Filters */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Clients</h3>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text"
                placeholder="Search clients..."
                value={clientSearchQuery}
                onChange={e => setClientSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>

            <div className="flex flex-col gap-1 mt-1">
              {!clientSearchQuery && (
                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    checked={isAllClientsSelected}
                    onChange={handleAllClientsClick}
                    className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-600"
                  />
                  <span className="text-sm font-medium text-gray-900">All Clients</span>
                </label>
              )}

              {filteredClients.map(client => (
                <label key={client.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    checked={filterBarClientIds.has(client.id)}
                    onChange={() => handleClientClick(client.id)}
                    className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-600"
                  />
                  <span className="text-sm font-medium text-gray-700 truncate">{client.name}</span>
                </label>
              ))}
              
              {filteredClients.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-gray-500 italic">
                  No clients found
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0">
          <button
            onClick={clearAllFilters}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-gray-700 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Clear All Filters
          </button>
        </div>

      </div>
    </>
  )
}
