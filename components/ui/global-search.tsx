"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, X, Building2, Users, MapPin, FileText, Loader2 } from "lucide-react"

interface SearchResult {
  clients: Array<{ id: string; name: string; phone?: string | null; isActive?: boolean }>
  subcontractors: Array<{ id: string; name: string; phone?: string | null }>
  invoices: Array<{ id: string; invoiceNumber: string; status: string; totalAmount: number; client: { name: string } }>
  locations: Array<{ id: string; name: string; address: string; client: { id: string; name: string } }>
}

export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // ⌘K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("")
      setResults(null)
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults(null)
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data)
        setSelectedIndex(0)
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  // Build flat list of results for keyboard navigation
  const allItems: Array<{ type: string; id: string; label: string; sub: string; href: string }> = []
  if (results) {
    results.clients.forEach(c => {
      allItems.push({ type: "client", id: c.id, label: c.name, sub: c.isActive === false ? "Paused" : "Client", href: `/clients/${c.id}` })
    })
    results.subcontractors.forEach(s => {
      allItems.push({ type: "subcontractor", id: s.id, label: s.name, sub: s.phone || "Cleaner", href: `/subcontractors/${s.id}` })
    })
    results.locations.forEach(l => {
      allItems.push({ type: "location", id: l.id, label: l.name, sub: `${l.client.name} · ${l.address}`, href: `/clients/${l.client.id}` })
    })
    results.invoices.forEach(inv => {
      allItems.push({ type: "invoice", id: inv.id, label: inv.invoiceNumber, sub: `${inv.client.name} · $${inv.totalAmount.toFixed(2)} · ${inv.status}`, href: `/invoices/${inv.id}` })
    })
  }

  const navigate = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && allItems[selectedIndex]) {
      e.preventDefault()
      navigate(allItems[selectedIndex].href)
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "client": return <Building2 className="w-4 h-4 text-teal-600" />
      case "subcontractor": return <Users className="w-4 h-4 text-purple-600" />
      case "location": return <MapPin className="w-4 h-4 text-amber-600" />
      case "invoice": return <FileText className="w-4 h-4 text-blue-600" />
      default: return <Search className="w-4 h-4 text-gray-400" />
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div
        className="absolute left-1/2 top-[15%] -translate-x-1/2 w-full max-w-xl"
        style={{ animation: "commandK 0.15s ease-out" }}
      >
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search clients, cleaners, locations, invoices…"
              className="flex-1 text-base text-gray-900 placeholder-gray-400 outline-none bg-transparent"
            />
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-teal-600" />}
            <button
              onClick={() => setOpen(false)}
              className="flex items-center justify-center w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {query.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                Type to search across clients, cleaners, locations & invoices
              </div>
            )}
            {query.length > 0 && allItems.length === 0 && !isLoading && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No results found for &ldquo;{query}&rdquo;
              </div>
            )}
            {allItems.length > 0 && (
              <div className="py-2">
                {/* Group headers */}
                {results?.clients && results.clients.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Clients</div>
                    {results.clients.map((c, i) => {
                      const idx = allItems.findIndex(item => item.type === "client" && item.id === c.id)
                      return (
                        <button
                          key={c.id}
                          onClick={() => navigate(`/clients/${c.id}`)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIndex === idx ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                        >
                          <Building2 className="w-4 h-4 text-teal-600 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                            {c.isActive === false && <span className="text-xs text-gray-400">Paused</span>}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {results?.subcontractors && results.subcontractors.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Cleaners</div>
                    {results.subcontractors.map((s) => {
                      const idx = allItems.findIndex(item => item.type === "subcontractor" && item.id === s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => navigate(`/subcontractors/${s.id}`)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIndex === idx ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                        >
                          <Users className="w-4 h-4 text-purple-600 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                            {s.phone && <p className="text-xs text-gray-400">{s.phone}</p>}
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {results?.locations && results.locations.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Locations</div>
                    {results.locations.map((l) => {
                      const idx = allItems.findIndex(item => item.type === "location" && item.id === l.id)
                      return (
                        <button
                          key={l.id}
                          onClick={() => navigate(`/clients/${l.client.id}`)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIndex === idx ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                        >
                          <MapPin className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{l.name}</p>
                            <p className="text-xs text-gray-400 truncate">{l.client.name} · {l.address}</p>
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}

                {results?.invoices && results.invoices.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Invoices</div>
                    {results.invoices.map((inv) => {
                      const idx = allItems.findIndex(item => item.type === "invoice" && item.id === inv.id)
                      return (
                        <button
                          key={inv.id}
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIndex === idx ? 'bg-teal-50' : 'hover:bg-gray-50'}`}
                        >
                          <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{inv.invoiceNumber}</p>
                            <p className="text-xs text-gray-400 truncate">{inv.client.name} · ${inv.totalAmount.toFixed(2)} · {inv.status}</p>
                          </div>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">↵</kbd> open</span>
              <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes commandK {
          from { opacity: 0; transform: translate(-50%, -10px) scale(0.98); }
          to { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
      `}</style>
    </div>
  )
}
