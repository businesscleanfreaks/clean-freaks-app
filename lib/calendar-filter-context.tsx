"use client"

import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react"

interface CalendarFilterState {
  selectedCleanerIds: Set<string>
  showUnassigned: boolean
  filterBarClientIds: Set<string>
  setSelectedCleanerIds: (ids: Set<string>) => void
  setShowUnassigned: (show: boolean) => void
  setFilterBarClientIds: (ids: Set<string>) => void
  toggleFilterBarClient: (id: string) => void
  initCleaners: (ids: string[]) => void
}

const CalendarFilterContext = createContext<CalendarFilterState | null>(null)

export function CalendarFilterProvider({ children }: { children: ReactNode }) {
  const [selectedCleanerIds, setSelectedCleanerIds] = useState<Set<string>>(new Set())
  const [showUnassigned, setShowUnassigned] = useState(true)
  const [filterBarClientIds, setFilterBarClientIds] = useState<Set<string>>(new Set())

  const toggleFilterBarClient = useCallback((id: string) => {
    setFilterBarClientIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])
  const knownCleanerIdsRef = useRef<Set<string>>(new Set())

  const initCleaners = useCallback((ids: string[]) => {
    setSelectedCleanerIds(previous => {
      const next = new Set(previous)
      let changed = false
      for (const id of ids) {
        if (!knownCleanerIdsRef.current.has(id)) {
          next.add(id)
          changed = true
        }
      }
      knownCleanerIdsRef.current = new Set(ids)
      return changed ? next : previous
    })
  }, [])

  const value = useMemo<CalendarFilterState>(() => ({
    selectedCleanerIds,
    showUnassigned,
    filterBarClientIds,
    setSelectedCleanerIds,
    setShowUnassigned,
    setFilterBarClientIds,
    toggleFilterBarClient,
    initCleaners,
  }), [filterBarClientIds, initCleaners, selectedCleanerIds, showUnassigned, toggleFilterBarClient])

  return (
    <CalendarFilterContext.Provider value={value}>
      {children}
    </CalendarFilterContext.Provider>
  )
}

export function useCalendarFilters() {
  return useContext(CalendarFilterContext)
}
