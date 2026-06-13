"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  Wallet,
  Settings,
  LogOut,
  Sparkles,
  ChevronUp,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react"
import { useState, useEffect, useLayoutEffect, useRef } from "react"

// useLayoutEffect fires before the browser paints — prevents flash of wrong state.
// Falls back to useEffect on the server (where useLayoutEffect warns).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect
import useSWR from "swr"
import { useRouter } from "next/navigation"
import { getTooltipContent } from "@/lib/tooltip-content"
import { showError, showSuccess } from "@/lib/toast"

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  tooltip?: string
}

interface NavSection {
  label: string | null
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    label: null,
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { name: "Calendar",  href: "/calendar",       icon: Calendar  },
      { name: "Clients",   href: "/clients",        icon: Users     },
      { name: "Invoices",  href: "/invoices",       icon: FileText  },
      // Cleaners + Vendors retired into Payables (single home for payment tracking +
      // profiles + history). Pages still reachable by URL as a temporary safety net.
      { name: "Payables",  href: "/payables",       icon: Wallet },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

const LS_COLLAPSED_KEY = "sidebar-collapsed"

interface NavSidebarProps {
  onNavigate?: () => void
}

const swrFetcher = (url: string) => fetch(url).then(r => r.json())

// ── Main NavSidebar ────────────────────────────────────────────────────────────
export function NavSidebar({ onNavigate }: NavSidebarProps) {
  const pathname   = usePathname()
  const router     = useRouter()


  const [isLoggingOut,   setIsLoggingOut]   = useState(false)
  const [userEmail,      setUserEmail]      = useState<string | null>(null)
  const [isLoadingUser,  setIsLoadingUser]  = useState(true)
  const [profileOpen,    setProfileOpen]    = useState(false)
  // Start with false to match SSR, then read localStorage before first paint
  const [collapsed, setCollapsed] = useState(false)

  useIsomorphicLayoutEffect(() => {
    try {
      if (localStorage.getItem(LS_COLLAPSED_KEY) === "true") setCollapsed(true)
    } catch { /* ignore */ }
  }, [])

  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/session')
        if (response.ok) {
          const data = await response.json()
          if (data.authenticated && data.user) setUserEmail(data.user.email)
        }
      } catch { /* silent fail */ }
      finally { setIsLoadingUser(false) }
    }
    fetchUser()
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem(LS_COLLAPSED_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [profileOpen])

  const handleLogout = async () => {
    setIsLoggingOut(true)
    setProfileOpen(false)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (response.ok) {
        showSuccess('Logged out successfully')
        router.push('/login')
        router.refresh()
      } else {
        showError('Failed to logout')
      }
    } catch {
      showError('Failed to logout')
    } finally {
      setIsLoggingOut(false)
    }
  }

  const initials = userEmail ? userEmail.split('@')[0].charAt(0).toUpperCase() : 'A'

  return (
    <div
      className="nav-sidebar flex h-full flex-col text-white relative min-h-0"
      style={{
        width: collapsed ? '64px' : '240px',
        transition: 'width 200ms ease',
        background: 'linear-gradient(180deg, #091214 0%, #0C1518 38%, #10181C 100%)',
        borderRight: '1px solid rgba(148, 163, 184, 0.18)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.03)',
        overflow: 'hidden',
      }}
    >

      {/* ── Header ── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{
          borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
          padding: collapsed ? '16px 0' : '16px 16px',
          justifyContent: collapsed ? 'center' : 'space-between',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
        }}
      >
        {collapsed ? (
          <Sparkles size={18} strokeWidth={1.75} style={{ color: '#00A896' }} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Sparkles size={16} strokeWidth={1.75} style={{ color: '#00A896', flexShrink: 0 }} />
              <span className="text-lg font-bold leading-none whitespace-nowrap">
                <span className="text-white">Clean</span>
                <span style={{ color: '#00A896' }}>Freaks</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-[6px] w-[6px]">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-emerald-400" />
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3" style={{ paddingLeft: collapsed ? '8px' : '12px', paddingRight: collapsed ? '8px' : '12px' }}>
        <div className="flex flex-col gap-5">
          {sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="flex flex-col gap-0.5">
              {section.label && !collapsed && (
                <p
                  className="px-3 pb-1.5 text-[10px] uppercase tracking-widest font-medium"
                  style={{ color: 'rgba(203,213,225,0.40)' }}
                >
                  {section.label}
                </p>
              )}

              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href))

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.name : (item.tooltip ? getTooltipContent(item.tooltip) : undefined)}
                    className="flex items-center rounded-lg transition-all duration-150"
                    style={{
                      gap: collapsed ? '0' : '12px',
                      paddingTop: '9px',
                      paddingBottom: '9px',
                      paddingRight: collapsed ? '0' : '12px',
                      paddingLeft: collapsed ? '0' : isActive ? '10px' : '12px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderLeft: collapsed ? 'none' : isActive ? '2px solid #14B8A6' : '2px solid transparent',
                      border: isActive ? '1px solid rgba(45,212,191,0.18)' : '1px solid transparent',
                      backgroundColor: isActive ? 'rgba(20,184,166,0.12)' : 'transparent',
                      boxShadow: isActive ? '0 10px 20px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.03)' : 'none',
                      textDecoration: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.04)'
                        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(148,163,184,0.10)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent'
                        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'transparent'
                      }
                    }}
                  >
                    <item.icon
                      size={16}
                      strokeWidth={1.75}
                      style={{
                        flexShrink: 0,
                        color: isActive ? '#5EEAD4' : 'rgba(226,232,240,0.52)',
                      }}
                    />
                    {!collapsed && (
                      <span
                        className="text-sm whitespace-nowrap"
                        style={{
                          fontWeight: isActive ? 600 : 500,
                          color: isActive ? '#F8FAFC' : 'rgba(226,232,240,0.72)',
                        }}
                      >
                        {item.name}
                      </span>
                    )}

                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* ── Collapse toggle ── */}
      <div
        className="flex-shrink-0 flex items-center"
        style={{
          borderTop: '1px solid rgba(148, 163, 184, 0.16)',
          padding: collapsed ? '8px 0' : '8px 12px',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <button
          onClick={toggleCollapsed}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={15} className="text-slate-300/50" /> : <PanelLeftClose size={15} className="text-slate-300/50" />}
        </button>
      </div>

      {/* ── Bottom profile block ── */}
      <div
        className="flex-shrink-0"
        style={{
          borderTop: '1px solid rgba(148, 163, 184, 0.16)',
          padding: collapsed ? '8px' : '8px 12px',
        }}
        ref={profileRef}
      >
        {profileOpen && !collapsed && (
          <div
            className="mb-1 rounded-lg overflow-hidden"
            style={{ backgroundColor: 'rgba(15,23,42,0.45)', border: '1px solid rgba(148,163,184,0.16)', backdropFilter: 'blur(8px)' }}
          >
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 disabled:opacity-50"
              style={{ color: 'rgba(226,232,240,0.78)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              }}
            >
              <LogOut size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              {isLoggingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        )}

        <button
          onClick={() => collapsed ? toggleCollapsed() : setProfileOpen(v => !v)}
          className="w-full flex items-center rounded-lg transition-all duration-150"
          style={{
            gap: collapsed ? '0' : '12px',
            padding: collapsed ? '4px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            backgroundColor: profileOpen && !collapsed ? 'rgba(255,255,255,0.05)' : 'transparent',
            border: !collapsed ? '1px solid rgba(148,163,184,0.10)' : '1px solid transparent',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.05)'
          }}
          onMouseLeave={(e) => {
            if (!profileOpen || collapsed) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }
          }}
        >
          <div
            className="flex items-center justify-center rounded-full flex-shrink-0 text-sm font-semibold"
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: 'rgba(45,212,191,0.16)',
              color: '#99F6E4',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            {isLoadingUser ? '·' : initials}
          </div>

          {!collapsed && (
            <>
              <span
                className="flex-1 min-w-0 text-xs text-left truncate"
                style={{ color: 'rgba(226,232,240,0.58)' }}
              >
                {isLoadingUser ? '…' : (userEmail ?? 'Admin')}
              </span>
              <ChevronUp
                size={13}
                strokeWidth={1.75}
                className="flex-shrink-0 transition-transform duration-150"
                style={{
                  color: 'rgba(226,232,240,0.34)',
                  transform: profileOpen ? 'rotate(0deg)' : 'rotate(180deg)',
                }}
              />
            </>
          )}
        </button>
      </div>

    </div>
  )
}
