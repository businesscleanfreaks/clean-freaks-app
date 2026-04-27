"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

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
  const [initialized, setInitialized] = useState(false)

  const initCleaners = useCallback((ids: string[]) => {
    if (!initialized) {
      setSelectedCleanerIds(new Set(ids))
      setInitialized(true)
    }
  }, [initialized])

  return (
    <CalendarFilterContext.Provider value={{
      selectedCleanerIds,
      showUnassigned,
      filterBarClientIds,
      setSelectedCleanerIds,
      setShowUnassigned,
      setFilterBarClientIds,
      toggleFilterBarClient,
      initCleaners,
    }}>
      {children}
    </CalendarFilterContext.Provider>
  )
}

export function useCalendarFilters() {
  return useContext(CalendarFilterContext)
}
