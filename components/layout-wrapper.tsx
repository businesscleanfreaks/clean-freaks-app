"use client"

import { useState, useEffect, createContext, useContext, useCallback } from "react"
import { usePathname } from "next/navigation"
import { NavSidebar } from "@/components/nav-sidebar"
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs"
import { CalendarFilterProvider } from "@/lib/calendar-filter-context"
import { Menu, X } from "lucide-react"
import { GlobalSearch } from "@/components/ui/global-search"

// Context for pages to inject actions into the mobile header
const MobileHeaderContext = createContext<{
  setActions: (node: React.ReactNode) => void
}>({ setActions: () => {} })

export function useMobileHeaderActions() {
  return useContext(MobileHeaderContext)
}

function getPageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard'
  if (pathname.startsWith('/clients')) return 'Clients'
  if (pathname.startsWith('/calendar')) return 'Calendar'
  if (pathname.startsWith('/invoices')) return 'Invoices'
  if (pathname.startsWith('/payables')) return 'Payables'
  return 'Clean Freaks'
}

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'
  const isPublicInvoicePage = pathname.startsWith('/view-invoice')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null)

  const pageTitle = getPageTitle(pathname)

  const setActions = useCallback((node: React.ReactNode) => {
    setHeaderActions(node)
  }, [])



  // Clear header actions and close menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false)
    setHeaderActions(null)
  }, [pathname])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen])

  // Skip layout for login and public invoice pages
  if (isLoginPage || isPublicInvoicePage) {
    return <>{children}</>
  }

  return (
    <CalendarFilterProvider>
    <div className="layout-root">
      
      {/* Mobile Header Bar - Fixed at top */}
      <header className="mobile-header">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="mobile-menu-btn"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <h1 style={{ color: '#171717', fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>{pageTitle}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {headerActions}
        </div>
      </header>

      {/* Mobile Overlay — CSS transition via .visible class */}
      <div
        className={`mobile-overlay ${isMobileMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMobileMenuOpen(false)}
      />

      {/* Mobile Sidebar Drawer — CSS transition via .open class */}
      <div className={`mobile-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <button
          onClick={() => setIsMobileMenuOpen(false)}
          className="mobile-close-btn"
          aria-label="Close menu"
        >
          <X className="w-6 h-6" />
        </button>
        <NavSidebar variant="mobile" onNavigate={() => setIsMobileMenuOpen(false)} />
      </div>

      {/* Desktop Sidebar - Always visible */}
      <aside className="desktop-sidebar">
        <NavSidebar variant="desktop" />
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <MobileHeaderContext.Provider value={{ setActions }}>
          <div
            key={pathname}
            className="animate-in"
            style={{ flex: 1 }}
          >
            {children}
          </div>
        </MobileHeaderContext.Provider>
      </main>

      {/* Mobile Bottom Tab Navigation */}
      {!isMobileMenuOpen && <MobileBottomTabs />}

      {/* Global Search Command Palette (⌘K) */}
      <GlobalSearch />

      {/* Layout CSS lives in globals.css for SSR-guaranteed availability */}
    </div>
    </CalendarFilterProvider>
  )
}
